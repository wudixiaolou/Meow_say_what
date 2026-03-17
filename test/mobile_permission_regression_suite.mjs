import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CASES,
  PROJECTS,
  bootstrapToLive,
  collectUiState,
  createSession,
} from "./mobile_permission_suite_core.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const TARGET_URL = process.env.E2E_URL || "https://127.0.0.1:3000/";
const MAX_RETRIES = Number(process.env.MOBILE_CASE_RETRIES || 2);
const PROJECT_FILTER = (process.env.MOBILE_PROJECTS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ARTIFACT_ROOT = path.resolve(
  ROOT_DIR,
  "test",
  "artifacts",
  "mobile_permission_regression",
  new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14),
);

function now() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function slug(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function toMarkdown(rows) {
  const header =
    "| 用例ID | 平台 | 前置条件 | 操作步骤 | 预期结果 | 实际结果 | 断言逻辑 | 结论 |\n|---|---|---|---|---|---|---|---|";
  const lines = rows.map((row) =>
    `| ${row.caseId} | ${row.platform} | ${row.preconditions} | ${row.steps} | ${row.expected} | ${row.actualResult} | ${row.assertionLogic} | ${row.status} |`,
  );
  return [header, ...lines].join("\n");
}

async function runCase(project, testCase, caseDir) {
  const attempts = [];
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const attemptTag = `attempt-${attempt}`;
    const attemptDir = path.join(caseDir, attemptTag);
    ensureDir(attemptDir);
    let browser;
    let context;
    let page;
    const consoleLogs = [];
    try {
      const session = await createSession(project);
      browser = session.browser;
      context = session.context;
      page = await context.newPage();
      page.on("console", (msg) => {
        consoleLogs.push({ ts: now(), type: msg.type(), text: msg.text() });
      });
      page.on("pageerror", (err) => {
        consoleLogs.push({ ts: now(), type: "pageerror", text: String(err) });
      });
      if (testCase.setupScript) {
        await page.addInitScript(testCase.setupScript);
      }
      await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
      if (!testCase.run) {
        await bootstrapToLive(page);
        await page.waitForTimeout(1000);
      }
      const actual = testCase.run ? await testCase.run(page) : await collectUiState(page);
      const assertion = testCase.assert(actual);
      const screenshotPath = path.join(attemptDir, `${slug(testCase.id)}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const logPath = path.join(attemptDir, `${slug(testCase.id)}.console.json`);
      fs.writeFileSync(logPath, JSON.stringify(consoleLogs, null, 2), "utf8");
      const record = {
        attempt,
        passed: assertion.passed,
        actual,
        assertion,
        screenshotPath,
        logPath,
      };
      attempts.push(record);
      await context.close();
      await browser.close();
      if (assertion.passed) {
        return { passed: true, attempts };
      }
    } catch (error) {
      attempts.push({
        attempt,
        passed: false,
        actual: {},
        assertion: {
          passed: false,
          actualResult: String(error),
        },
      });
      if (page) {
        const screenshotPath = path.join(attemptDir, `${slug(testCase.id)}-error.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      }
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
  return { passed: false, attempts };
}

async function main() {
  ensureDir(ARTIFACT_ROOT);
  const selectedProjects = PROJECT_FILTER.length
    ? PROJECTS.filter((project) => PROJECT_FILTER.includes(project.id))
    : PROJECTS;
  const rows = [];
  let failedCount = 0;
  for (const project of selectedProjects) {
    const projectDir = path.join(ARTIFACT_ROOT, project.id);
    ensureDir(projectDir);
    for (const testCase of CASES) {
      const caseDir = path.join(projectDir, testCase.id);
      ensureDir(caseDir);
      const outcome = await runCase(project, testCase, caseDir);
      const finalAttempt = outcome.attempts[outcome.attempts.length - 1];
      if (!outcome.passed) {
        failedCount += 1;
      }
      rows.push({
        caseId: testCase.id,
        platform: project.label,
        preconditions: testCase.preconditions,
        steps: testCase.steps.join(" -> "),
        expected: testCase.expected,
        actualResult: finalAttempt?.assertion?.actualResult || "无结果",
        assertionLogic: "passed === true",
        status: outcome.passed ? "PASS" : "FAIL",
        attempts: outcome.attempts,
      });
    }
  }
  const summary = {
    executedAt: now(),
    targetUrl: TARGET_URL,
    retriesPerCase: MAX_RETRIES,
    failedCount,
    totalCount: rows.length,
    rows,
    artifactRoot: ARTIFACT_ROOT,
  };
  fs.writeFileSync(path.join(ARTIFACT_ROOT, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(path.join(ARTIFACT_ROOT, "summary.md"), toMarkdown(rows), "utf8");
  const csvLines = [
    "case_id,platform,status,expected,actual_result",
    ...rows.map(
      (row) =>
        `"${row.caseId}","${row.platform}","${row.status}","${row.expected.replace(/"/g, '""')}","${String(row.actualResult).replace(/"/g, '""')}"`,
    ),
  ];
  fs.writeFileSync(path.join(ARTIFACT_ROOT, "summary.csv"), csvLines.join("\n"), "utf8");
  console.log(JSON.stringify({ artifactRoot: ARTIFACT_ROOT, failedCount, totalCount: rows.length }, null, 2));
  if (failedCount > 0) {
    process.exit(2);
  }
}

void main();
