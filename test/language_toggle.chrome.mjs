import { chromium } from "playwright";

const TARGET_URL = process.env.E2E_URL || "https://localhost:3000/";

async function isVisibleButton(page, text) {
  const locator = page.locator("button", { hasText: text }).first();
  return locator.isVisible().catch(() => false);
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

  const defaultStartEnglish = await isVisibleButton(page, "Start");
  const defaultChineseStart = await isVisibleButton(page, "开始");

  const toggle = page.locator("button:has(svg)").first();
  const toggleBefore = ((await toggle.textContent()) || "").trim();
  await toggle.click();
  await page.waitForTimeout(250);
  const toggleAfter = ((await toggle.textContent()) || "").trim();

  const chineseStartAfterToggle = await isVisibleButton(page, "开始");
  const englishStartAfterToggle = await isVisibleButton(page, "Start");

  const result = {
    target: TARGET_URL,
    defaultStartEnglish,
    defaultChineseStart,
    toggleBefore,
    toggleAfter,
    chineseStartAfterToggle,
    englishStartAfterToggle,
    pass:
      defaultStartEnglish &&
      !defaultChineseStart &&
      chineseStartAfterToggle &&
      !englishStartAfterToggle &&
      toggleBefore !== toggleAfter,
  };

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(result.pass ? 0 : 1);
}

void run();
