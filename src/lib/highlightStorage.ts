import { HighlightClip } from "../types";

const DB_NAME = "meowlingo-highlights-db";
const STORE_NAME = "highlights";
const DB_VERSION = 1;
const MAX_PERSISTED = 120;

export interface PersistedHighlightClip {
  id: string;
  createdAtMs: number;
  triggerType: HighlightClip["triggerType"];
  triggerText: string;
  caption: string;
  clipBlob: Blob;
}

export function buildPersistedClip(clip: HighlightClip): PersistedHighlightClip {
  return {
    id: clip.id,
    createdAtMs: clip.createdAt.getTime(),
    triggerType: clip.triggerType,
    triggerText: clip.triggerText,
    caption: clip.caption,
    clipBlob: clip.clipBlob,
  };
}

export function restoreClipFromPersisted(
  persisted: PersistedHighlightClip,
  createUrl: (blob: Blob) => string,
): HighlightClip {
  return {
    id: persisted.id,
    createdAt: new Date(persisted.createdAtMs),
    triggerType: persisted.triggerType,
    triggerText: persisted.triggerText,
    caption: persisted.caption,
    clipBlob: persisted.clipBlob,
    clipUrl: createUrl(persisted.clipBlob),
  };
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAtMs", "createdAtMs", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("highlight_db_open_failed"));
  });
}

export async function saveHighlightClipToLocal(clip: HighlightClip) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(buildPersistedClip(clip));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("highlight_db_write_failed"));
    });
    await trimPersistedClips(db, MAX_PERSISTED);
  } finally {
    db.close();
  }
}

async function trimPersistedClips(db: IDBDatabase, maxKeep: number) {
  const all = await new Promise<PersistedHighlightClip[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as PersistedHighlightClip[]) || []);
    req.onerror = () => reject(req.error || new Error("highlight_db_get_all_failed"));
  });
  if (all.length <= maxKeep) {
    return;
  }
  const toDelete = [...all]
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(maxKeep)
    .map((item) => item.id);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    toDelete.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("highlight_db_trim_failed"));
  });
}

export async function loadHighlightClipsFromLocal(limit: number = 18) {
  const db = await openDb();
  try {
    const rows = await new Promise<PersistedHighlightClip[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as PersistedHighlightClip[]) || []);
      req.onerror = () => reject(req.error || new Error("highlight_db_load_failed"));
    });
    return rows
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, limit)
      .map((item) => restoreClipFromPersisted(item, (blob) => URL.createObjectURL(blob)));
  } finally {
    db.close();
  }
}

export async function deleteHighlightClipFromLocal(clipId: string) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(clipId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("highlight_db_delete_failed"));
    });
  } finally {
    db.close();
  }
}
