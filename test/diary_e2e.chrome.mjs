import { chromium } from "playwright";

const TARGET_URL = process.env.E2E_URL || "http://localhost:3000/";

async function clickText(page, text, timeout = 3000) {
  const nodes = page.locator("button", { hasText: text });
  const count = await nodes.count();
  for (let i = 0; i < count; i += 1) {
    const node = nodes.nth(i);
    const visible = await node.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    try {
      await node.click({ timeout });
      return true;
    } catch {}
  }
  return false;
}

async function bootstrap(page) {
  await clickText(page, "开始", 3000);
  await clickText(page, "爸爸", 2000);
  const input = page.locator('input[placeholder*="例如"]').first();
  if (await input.count()) {
    await input.fill("咪咪");
  }
  await clickText(page, "下一步", 3000);
  await clickText(page, "实时翻译", 1000);
  await page.waitForTimeout(400);
}

async function seedDiaryData(page) {
  return page.evaluate(async () => {
    const openDiaryDb = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("meowlingo-diary-db", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
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
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

    const openHighlightDb = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("meowlingo-highlights-db", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("highlights")) {
            const store = db.createObjectStore("highlights", { keyPath: "id" });
            store.createIndex("createdAtMs", "createdAtMs", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

    const diaryDb = await openDiaryDb();
    await new Promise((resolve, reject) => {
      const tx = diaryDb.transaction(["interaction_texts", "diaries"], "readwrite");
      const textStore = tx.objectStore("interaction_texts");
      const diaryStore = tx.objectStore("diaries");
      textStore.clear();
      diaryStore.clear();
      const now = Date.now();
      const texts = [
        "今天铲屎官回家好晚，本喵饿得前胸贴后背了。",
        "他拿出了金枪鱼罐头，我决定先原谅他三分钟。",
        "吃完以后我在窗边巡视地盘，心情特别好。",
      ];
      texts.forEach((text, i) => {
        textStore.put({
          id: `e2e-text-${now}-${i}`,
          sessionId: `e2e-session-${now}`,
          occurredAtMs: now - (texts.length - i) * 10000,
          text,
          source: "transcript",
          consumedByDiaryDate: null,
        });
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    diaryDb.close();

    const highlightDb = await openHighlightDb();
    await new Promise((resolve, reject) => {
      const tx = highlightDb.transaction("highlights", "readwrite");
      const store = tx.objectStore("highlights");
      store.clear();
      const now = Date.now();
      const blob = new Blob(["fake-video-binary"], { type: "video/mp4" });
      store.put({
        id: `e2e-clip-${now}`,
        createdAtMs: now - 5000,
        triggerType: "manual",
        triggerText: "吃罐头",
        caption: "罐头时刻",
        clipBlob: blob,
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    highlightDb.close();
    return true;
  });
}

async function run() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  } catch {
    browser = await chromium.launch({ headless: true });
  }
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await bootstrap(page);
  await seedDiaryData(page);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await bootstrap(page);
  const diaryTabClicked = await clickText(page, "日记本", 3000);
  const generateClicked = await clickText(page, "立即生成", 3000);

  let generated = false;
  for (let i = 0; i < 25; i += 1) {
    const hasReadButton = await page.locator("text=听日记").first().isVisible().catch(() => false);
    const hasDiaryTitle = await page
      .evaluate(() => {
        const heading = document.querySelector("h2.text-xl.font-bold.text-slate-800");
        return !!heading && (heading.textContent || "").trim().length > 0;
      })
      .catch(() => false);
    if (hasReadButton || hasDiaryTitle) {
      generated = true;
      break;
    }
    await page.waitForTimeout(500);
  }

  const checks = await page.evaluate(() => {
    const allButtons = Array.from(document.querySelectorAll("button"));
    const tabTexts = ["实时翻译", "精彩瞬间", "日记本", "设置"];
    const tabs = tabTexts.map((t) => allButtons.find((b) => (b.textContent || "").includes(t))).filter(Boolean);
    const activeDiaryTab = allButtons.find((b) => {
      const text = (b.textContent || "").replace(/\s+/g, "");
      return text.includes("日记本");
    });
    const hasLiftedActiveTab =
      !!activeDiaryTab &&
      ((activeDiaryTab.className || "").includes("-translate-y-2") ||
        (activeDiaryTab.querySelector("div")?.className || "").includes("bg-amber-400/10"));
    const hasDatePicker = !!document.querySelector('input[type="date"]');
    const hasDots = document.querySelectorAll(".w-1\\.5.h-1\\.5.rounded-full").length >= 2;
    const hasPaper = !!document.querySelector(".bg-\\[\\#Fdfdfd\\]");
    const hasVideo = document.querySelectorAll("video").length > 0;
    const hasHomeCandidate =
      document.querySelectorAll(".sticky.top-0 button").length >= 3 ||
      document.querySelectorAll("button.p-2.rounded-full.bg-white\\/5").length > 0;
    const hasReadButton = allButtons.some((b) => (b.textContent || "").includes("听日记"));
    return {
      tabsCount: tabs.length,
      hasLiftedActiveTab,
      hasDatePicker,
      hasDots,
      hasPaper,
      hasVideo,
      hasHomeCandidate,
      hasReadButton,
    };
  });

  await page.screenshot({ path: "test/diary-ui-e2e.png", fullPage: true });
  const result = {
    target: TARGET_URL,
    diaryTabClicked,
    generateClicked,
    generated,
    checks,
    pass:
      generated &&
      checks.tabsCount === 4 &&
      checks.hasLiftedActiveTab &&
      checks.hasDatePicker &&
      checks.hasDots &&
      checks.hasPaper &&
      checks.hasHomeCandidate,
  };
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(result.pass ? 0 : 1);
}

void run();
