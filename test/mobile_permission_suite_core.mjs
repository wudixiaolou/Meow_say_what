import { chromium, webkit, devices } from "playwright";

export const CASES = [
  {
    id: "MP-001",
    title: "权限被拒绝时给出可执行引导",
    preconditions:
      "站点可访问；进入实时翻译页；模拟系统拒绝摄像头权限（NotAllowedError）",
    steps: [
      "打开站点并完成封面/引导页",
      "点击摄像头启动按钮触发授权",
      "观察错误弹窗文案",
    ],
    expected:
      "弹窗出现明确引导文案（Camera permission is blocked / 摄像头权限被拦截），且不出现泛化 Initialization failed",
    setupScript: () => {
      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: {},
        });
      }
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("Permission denied", "NotAllowedError");
      };
    },
    assert(actual) {
      const passed =
        actual.blockedVisible &&
        !actual.initFailedVisible &&
        /Camera permission is blocked|摄像头权限被拦截/i.test(actual.errorBody);
      return {
        passed,
        actualResult: passed ? "文案命中并避免泛化错误" : `blocked=${actual.blockedVisible}, initFailed=${actual.initFailedVisible}, body=${actual.errorBody}`,
      };
    },
  },
  {
    id: "MP-002",
    title: "拒绝后重试仍保持同一错误语义",
    preconditions: "已触发一次权限拒绝并出现错误弹窗",
    steps: [
      "点击 Retry Now / 立即重试",
      "再次触发授权失败",
      "检查错误文案是否一致",
    ],
    expected:
      "重试后仍为权限引导文案，不回退成 Initialization failed: Permission denied",
    setupScript: () => {
      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: {},
        });
      }
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("Permission denied", "NotAllowedError");
      };
    },
    run: async (page) => {
      await bootstrapToLive(page);
      await page.waitForTimeout(700);
      const retryBtn = page.getByRole("button", { name: /Retry Now|立即重试/ }).first();
      if (await retryBtn.isVisible().catch(() => false)) {
        await retryBtn.click();
      }
      await page.waitForTimeout(900);
      return collectUiState(page);
    },
    assert(actual) {
      const passed =
        actual.blockedVisible &&
        !actual.initFailedVisible &&
        /Camera permission is blocked|摄像头权限被拦截/i.test(actual.errorBody);
      return {
        passed,
        actualResult: passed ? "重试后文案一致且未退化" : `blocked=${actual.blockedVisible}, initFailed=${actual.initFailedVisible}, body=${actual.errorBody}`,
      };
    },
  },
  {
    id: "MP-003",
    title: "授权通过路径不出现权限阻断文案",
    preconditions: "浏览器已允许摄像头；模拟可用媒体流",
    steps: [
      "打开站点并进入实时翻译页",
      "点击摄像头启动按钮",
      "等待连接流程进入下一阶段",
    ],
    expected:
      "不出现 Camera permission is blocked / 摄像头权限被拦截 文案；不出现 Initialization failed: Permission denied",
    setupScript: () => {
      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: {},
        });
      }
      navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    },
    assert(actual) {
      const passed = !actual.blockedVisible && !/Permission denied/i.test(actual.errorBody);
      return {
        passed,
        actualResult: passed ? "未出现权限阻断文案" : `blocked=${actual.blockedVisible}, body=${actual.errorBody}`,
      };
    },
  },
];

export const PROJECTS = [
  {
    id: "local_android_chrome",
    label: "Chrome Android (Local Emulation)",
    mode: "local",
    browser: "chromium",
    device: devices["Pixel 7"],
    launchArgs: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
  {
    id: "local_ios_safari",
    label: "iOS Safari (Local Emulation)",
    mode: "local",
    browser: "webkit",
    device: devices["iPhone 13"],
    launchArgs: [],
  },
  {
    id: "real_android_chrome",
    label: "Chrome Android (Real Device Cloud)",
    mode: "remote",
    wsEnv: "REAL_ANDROID_WS_ENDPOINT",
  },
  {
    id: "real_ios_safari",
    label: "iOS Safari (Real Device Cloud)",
    mode: "remote",
    wsEnv: "REAL_IOS_WS_ENDPOINT",
  },
];

export function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

export async function bootstrapToLive(page) {
  const clickIfVisible = async (locator) => {
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      return true;
    }
    return false;
  };
  await clickIfVisible(page.getByRole("button", { name: /Start|开始/ }).first());
  await clickIfVisible(page.getByRole("button", { name: /Dad|Mom|爸爸|妈妈/ }).first());
  const nameInput = page.locator("input").first();
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill("Mimi");
  }
  await clickIfVisible(page.getByRole("button", { name: /Next|下一步/ }).first());
  await clickIfVisible(page.getByRole("button", { name: /Live|实时翻译/ }).first());
  const camBtn = page.locator("button:has(svg.lucide-camera)").first();
  await camBtn.waitFor({ state: "visible", timeout: 10000 });
  await camBtn.click();
}

export async function collectUiState(page) {
  const blockedVisible = await page
    .getByText(/Camera permission is blocked|摄像头权限被拦截/)
    .first()
    .isVisible()
    .catch(() => false);
  const initFailedVisible = await page
    .getByText(/Initialization failed|初始化连接失败/)
    .first()
    .isVisible()
    .catch(() => false);
  const connectionFailedVisible = await page
    .getByText(/Connection Failed|连接失败/)
    .first()
    .isVisible()
    .catch(() => false);
  const liveBadgeVisible = await page.locator("text=LIVE").first().isVisible().catch(() => false);
  const errorBody = normalizeText(
    await page.locator("div.fixed p").first().textContent().catch(() => ""),
  );
  return {
    blockedVisible,
    initFailedVisible,
    connectionFailedVisible,
    liveBadgeVisible,
    errorBody,
  };
}

export async function createSession(project) {
  if (project.mode === "remote") {
    const wsEndpoint = process.env[project.wsEnv] || "";
    if (!wsEndpoint) {
      throw new Error(`missing_ws_endpoint:${project.wsEnv}`);
    }
    const browser = await chromium.connect(wsEndpoint);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    return { browser, context };
  }
  const browserType = project.browser === "webkit" ? webkit : chromium;
  const browser = await browserType.launch({
    headless: true,
    args: project.launchArgs,
  });
  const context = await browser.newContext({
    ...project.device,
    ignoreHTTPSErrors: true,
  });
  return { browser, context };
}
