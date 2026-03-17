import { chromium } from "playwright";

const TARGET_URL = process.env.E2E_URL || "https://localhost:3000/";

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: "chrome" });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

async function caseLegacyLanguageMigration(browser) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("meowlingo_lang", "zh");
  });
  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

  const startsWithChinese = await page.getByRole("button", { name: "开始" }).isVisible();
  const toggle = page.locator("button:has(svg)").first();
  await toggle.click();
  await page.waitForTimeout(250);
  const startsWithEnglishAfterToggle = await page.getByRole("button", { name: "Start" }).isVisible();

  const storage = await page.evaluate(() => ({
    newKey: localStorage.getItem("meowlingo_language"),
    legacyKey: localStorage.getItem("meowlingo_lang"),
  }));

  await context.close();
  return {
    startsWithChinese,
    startsWithEnglishAfterToggle,
    storageMigrated: storage.newKey === "en" && storage.legacyKey === null,
  };
}

async function caseDefaultEnglish(browser) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addInitScript(() => {
    localStorage.clear();
  });
  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  const hasEnglishStart = await page.getByRole("button", { name: "Start" }).isVisible();
  const hasChineseStart = await page.getByRole("button", { name: "开始" }).isVisible().catch(() => false);
  await context.close();
  return { hasEnglishStart, hasChineseStart };
}

async function run() {
  const browser = await launchBrowser();
  const migration = await caseLegacyLanguageMigration(browser);
  const defaults = await caseDefaultEnglish(browser);
  await browser.close();

  const pass =
    migration.startsWithChinese &&
    migration.startsWithEnglishAfterToggle &&
    migration.storageMigrated &&
    defaults.hasEnglishStart &&
    !defaults.hasChineseStart;

  const result = {
    target: TARGET_URL,
    migration,
    defaults,
    pass,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(pass ? 0 : 1);
}

void run();
