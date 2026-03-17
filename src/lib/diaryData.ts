import {
  AppLanguage,
  DiaryEntry,
  DiaryScheduleSettings,
  InteractionTextRecord,
  InteractionTextSource,
} from "../types";

const DB_NAME = "meowlingo-diary-db";
const DB_VERSION = 2;
const INTERACTION_STORE = "interaction_texts";
const LEGACY_DIARY_STORE = "diaries";
const DIARY_STORE = "diaries_v2";
const SETTINGS_STORE = "settings";

const DEFAULT_SCHEDULE: DiaryScheduleSettings = {
  enabled: false,
  timeOfDay: "21:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
  lastGeneratedDate: "",
};

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(INTERACTION_STORE)) {
        const store = db.createObjectStore(INTERACTION_STORE, { keyPath: "id" });
        store.createIndex("occurredAtMs", "occurredAtMs", { unique: false });
        store.createIndex("consumedByDiaryDate", "consumedByDiaryDate", { unique: false });
      }
      if (!db.objectStoreNames.contains(DIARY_STORE)) {
        const store = db.createObjectStore(DIARY_STORE, { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("dateLanguage", "dateLanguage", { unique: true });
        store.createIndex("createdAtMs", "createdAtMs", { unique: false });
      }
      const upgradeTx = req.transaction;
      if (upgradeTx && db.objectStoreNames.contains(LEGACY_DIARY_STORE)) {
        const oldStore = upgradeTx.objectStore(LEGACY_DIARY_STORE);
        const newStore = upgradeTx.objectStore(DIARY_STORE);
        oldStore.openCursor().onsuccess = (evt) => {
          const cursor = (evt.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) {
            return;
          }
          const value = cursor.value as DiaryEntry;
          const language = value.language === "en" ? "en" : "zh";
          newStore.put({
            ...value,
            language,
            dateLanguage: `${value.date}::${language}`,
          });
          cursor.continue();
        };
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("diary_db_open_failed"));
  });
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 600);
}

export async function addInteractionTextMaterial(params: {
  sessionId: string;
  text: string;
  source: InteractionTextSource;
  occurredAtMs?: number;
}) {
  const normalized = normalizeText(params.text);
  if (!normalized) {
    return null;
  }
  const occurredAtMs = params.occurredAtMs ?? Date.now();
  const db = await openDb();
  try {
    const duplicated = await new Promise<boolean>((resolve) => {
      const tx = db.transaction(INTERACTION_STORE, "readonly");
      const index = tx.objectStore(INTERACTION_STORE).index("occurredAtMs");
      const req = index.openCursor(null, "prev");
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(false);
          return;
        }
        const row = cursor.value as InteractionTextRecord;
        const isDup =
          row.text === normalized &&
          row.source === params.source &&
          Math.abs(occurredAtMs - row.occurredAtMs) <= 2000;
        resolve(isDup);
      };
      req.onerror = () => resolve(false);
    });
    if (duplicated) {
      return null;
    }
    const record: InteractionTextRecord = {
      id: `${occurredAtMs}-${Math.random().toString(16).slice(2)}`,
      sessionId: params.sessionId,
      occurredAtMs,
      text: normalized,
      source: params.source,
      consumedByDiaryDate: null,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(INTERACTION_STORE, "readwrite");
      tx.objectStore(INTERACTION_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("interaction_text_write_failed"));
    });
    return record;
  } finally {
    db.close();
  }
}

export async function getUnconsumedInteractionTexts(untilMs: number) {
  const db = await openDb();
  try {
    const rows = await new Promise<InteractionTextRecord[]>((resolve, reject) => {
      const tx = db.transaction(INTERACTION_STORE, "readonly");
      const req = tx.objectStore(INTERACTION_STORE).getAll();
      req.onsuccess = () => resolve((req.result as InteractionTextRecord[]) || []);
      req.onerror = () => reject(req.error || new Error("interaction_text_load_failed"));
    });
    return rows
      .filter((item) => !item.consumedByDiaryDate && item.occurredAtMs <= untilMs)
      .sort((a, b) => a.occurredAtMs - b.occurredAtMs);
  } finally {
    db.close();
  }
}

export async function markTextsConsumedAndCleanup(textIds: string[], diaryDate: string) {
  if (!textIds.length) {
    return;
  }
  const idSet = new Set(textIds);
  const db = await openDb();
  try {
    const all = await new Promise<InteractionTextRecord[]>((resolve, reject) => {
      const tx = db.transaction(INTERACTION_STORE, "readonly");
      const req = tx.objectStore(INTERACTION_STORE).getAll();
      req.onsuccess = () => resolve((req.result as InteractionTextRecord[]) || []);
      req.onerror = () => reject(req.error || new Error("interaction_text_read_all_failed"));
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(INTERACTION_STORE, "readwrite");
      const store = tx.objectStore(INTERACTION_STORE);
      all.forEach((item) => {
        if (idSet.has(item.id)) {
          store.put({ ...item, consumedByDiaryDate: diaryDate });
        }
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("interaction_text_mark_failed"));
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(INTERACTION_STORE, "readwrite");
      const store = tx.objectStore(INTERACTION_STORE);
      all.forEach((item) => {
        const consumedDate = idSet.has(item.id) ? diaryDate : item.consumedByDiaryDate;
        if (consumedDate) {
          store.delete(item.id);
        }
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("interaction_text_cleanup_failed"));
    });
  } finally {
    db.close();
  }
}

export async function saveDiaryEntry(entry: DiaryEntry) {
  const db = await openDb();
  try {
    const language: AppLanguage = entry.language === "en" ? "en" : "zh";
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DIARY_STORE, "readwrite");
      tx.objectStore(DIARY_STORE).put({
        ...entry,
        language,
        dateLanguage: `${entry.date}::${language}`,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("diary_write_failed"));
    });
  } finally {
    db.close();
  }
}

export async function loadDiaryEntries(language?: AppLanguage) {
  const db = await openDb();
  try {
    const list = await new Promise<DiaryEntry[]>((resolve, reject) => {
      const tx = db.transaction(DIARY_STORE, "readonly");
      const req = tx.objectStore(DIARY_STORE).getAll();
      req.onsuccess = () => resolve((req.result as DiaryEntry[]) || []);
      req.onerror = () => reject(req.error || new Error("diary_read_failed"));
    });
    const normalized = list.map((item) => ({
      ...item,
      language: item.language === "en" ? "en" : "zh",
    }));
    const filtered = language ? normalized.filter((item) => item.language === language) : normalized;
    return filtered.sort((a, b) => (a.date < b.date ? 1 : -1));
  } finally {
    db.close();
  }
}

export async function loadDiaryByDate(date: string, language?: AppLanguage) {
  const db = await openDb();
  try {
    if (language) {
      const row = await new Promise<DiaryEntry | null>((resolve, reject) => {
        const tx = db.transaction(DIARY_STORE, "readonly");
        const index = tx.objectStore(DIARY_STORE).index("dateLanguage");
        const req = index.get(`${date}::${language}`);
        req.onsuccess = () => resolve((req.result as DiaryEntry) || null);
        req.onerror = () => reject(req.error || new Error("diary_by_date_lang_read_failed"));
      });
      if (!row) {
        return null;
      }
      return { ...row, language: row.language === "en" ? "en" : "zh" };
    }
    const list = await new Promise<DiaryEntry[]>((resolve, reject) => {
      const tx = db.transaction(DIARY_STORE, "readonly");
      const index = tx.objectStore(DIARY_STORE).index("date");
      const req = index.getAll(IDBKeyRange.only(date));
      req.onsuccess = () => resolve((req.result as DiaryEntry[]) || []);
      req.onerror = () => reject(req.error || new Error("diary_by_date_read_failed"));
    });
    const first = list[0] || null;
    if (!first) {
      return null;
    }
    return { ...first, language: first.language === "en" ? "en" : "zh" };
  } finally {
    db.close();
  }
}

export async function loadDiaryScheduleSettings() {
  const db = await openDb();
  try {
    const row = await new Promise<{ key: string; value: DiaryScheduleSettings } | undefined>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, "readonly");
      const req = tx.objectStore(SETTINGS_STORE).get("diary_schedule");
      req.onsuccess = () => resolve(req.result as { key: string; value: DiaryScheduleSettings } | undefined);
      req.onerror = () => reject(req.error || new Error("diary_schedule_read_failed"));
    });
    return row?.value || DEFAULT_SCHEDULE;
  } finally {
    db.close();
  }
}

export async function saveDiaryScheduleSettings(settings: DiaryScheduleSettings) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, "readwrite");
      tx.objectStore(SETTINGS_STORE).put({ key: "diary_schedule", value: settings });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("diary_schedule_write_failed"));
    });
  } finally {
    db.close();
  }
}
