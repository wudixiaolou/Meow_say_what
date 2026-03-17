import { chromium } from "playwright";

const TARGET_URL = process.env.E2E_URL || "https://localhost:3000/";
const CJK_REGEX = /[\u4e00-\u9fff]/;

async function seedLegacyChineseDiary(context) {
  await context.addInitScript(() => {
    window.localStorage.setItem("meowlingo_language", "en");
    const request = indexedDB.open("meowlingo-diary-db", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("interaction_texts")) {
        const store = db.createObjectStore("interaction_texts", { keyPath: "id" });
        store.createIndex("occurredAtMs", "occurredAtMs", { unique: false });
        store.createIndex("consumedByDiaryDate", "consumedByDiaryDate", { unique: false });
      }
      if (!db.objectStoreNames.contains("diaries")) {
        const store = db.createObjectStore("diaries", { keyPath: "id" });
        store.createIndex("date", "date", { unique: true });
        store.createIndex("createdAtMs", "createdAtMs", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("diaries", "readwrite");
      tx.objectStore("diaries").put({
        id: "legacy-zh-entry",
        date: "2026-03-16",
        createdAtMs: Date.now(),
        title: "11的互动日记",
        content: "我是11。现在可以说话吗？[行为:观察环境][情绪:不耐烦]",
        summary: "今天我们有一些温柔的小互动，我会继续记住你。",
        mood: "mixed",
        sourceTextIds: [],
        linkedHighlightIds: [],
        readAloudScript: [{ type: "text", text: "我是11。现在可以说话吗？" }],
      });
    };
  });
}

async function setupToMain(page) {
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "👨 Dad" }).click();
  await page.getByPlaceholder("e.g. Mimi").fill("11");
  await page.getByRole("button", { name: "Next" }).click();
}

async function run() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  } catch {
    browser = await chromium.launch({ headless: true });
  }

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await seedLegacyChineseDiary(context);
  const page = await context.newPage();

  await setupToMain(page);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(300);
  const settingsText = await page.locator("body").innerText();
  const hasCjkInSettings = CJK_REGEX.test(settingsText);

  await page.getByRole("button", { name: "Diary" }).nth(1).click();
  await page.waitForTimeout(500);
  const diaryText = await page.locator("body").innerText();
  const hasCjkInDiary = CJK_REGEX.test(diaryText);

  const result = {
    target: TARGET_URL,
    hasCjkInSettings,
    hasCjkInDiary,
    pass: !hasCjkInSettings && !hasCjkInDiary,
  };

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(result.pass ? 0 : 1);
}

void run();
