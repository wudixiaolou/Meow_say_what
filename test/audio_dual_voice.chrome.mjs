import { chromium } from "playwright";

const TARGET_URL = process.env.E2E_URL || "https://localhost:3000/";

function nowTs() {
  return new Date().toISOString();
}

async function maybeClickByText(page, text, timeout = 1200) {
  const node = page.locator(`text=${text}`).first();
  try {
    await node.waitFor({ state: "visible", timeout });
    await node.click();
    return true;
  } catch {
    return false;
  }
}

async function bootstrapToLive(page) {
  const marks = {
    coverStartClicked: false,
    onboardingNextClicked: false,
    liveTabClicked: false,
    cameraStartClicked: false,
  };
  marks.coverStartClicked = await maybeClickByText(page, "开始", 1800);
  await maybeClickByText(page, "爸爸", 1200);
  const input = page.locator('input[placeholder*="例如"]').first();
  if (await input.count()) {
    await input.fill("咪咪");
  }
  marks.onboardingNextClicked = await maybeClickByText(page, "下一步", 1200);
  marks.liveTabClicked = await maybeClickByText(page, "实时翻译", 1200);
  marks.cameraStartClicked = await page.evaluate(() => {
    const startBtn = document.querySelector("button.w-24.h-24");
    if (startBtn instanceof HTMLButtonElement) {
      startBtn.click();
      return true;
    }
    return false;
  });
  await page.waitForTimeout(4500);
  const liveVisible =
    (await page.locator("text=LIVE").first().isVisible().catch(() => false)) ||
    (await page.locator("text=碎碎念").first().isVisible().catch(() => false)) ||
    (await page.locator("text=一问一答").first().isVisible().catch(() => false));
  return { ...marks, liveVisible };
}

async function getAudioMetrics(page) {
  return page.evaluate(() => {
    const d = (window).__audioDebug || {
      events: [],
      contexts: {},
      maxConcurrent: 0,
      speakCount: 0,
      cancelCount: 0,
    };
    const contexts = Object.entries(d.contexts || {}).map(([id, v]) => ({
      id: Number(id),
      state: v.state,
      activeSources: v.activeSources || 0,
    }));
    const activeSources = contexts.reduce((sum, c) => sum + (c.activeSources || 0), 0);
    const speaking = !!window.speechSynthesis?.speaking;
    const audibleAudio = Array.from(document.querySelectorAll("audio")).filter(
      (a) => !a.paused && !a.muted && a.volume > 0,
    ).length;
    const audibleVideo = Array.from(document.querySelectorAll("video")).filter(
      (v) => !v.paused && !v.muted && v.volume > 0,
    ).length;
    const concurrentNow = activeSources + (speaking ? 1 : 0) + audibleAudio + audibleVideo;
    return {
      maxConcurrent: d.maxConcurrent || 0,
      concurrentNow,
      speaking,
      speakCount: d.speakCount || 0,
      cancelCount: d.cancelCount || 0,
      recentEvents: (d.events || []).slice(-12),
      focusRecent: ((window).__audioFocusDebug || []).slice(-20),
    };
  });
}

async function main() {
  const launchBase = {
    headless: true,
    channel: "chrome",
    args: ["--autoplay-policy=no-user-gesture-required"],
  };
  let browser;
  try {
    browser = await chromium.launch(launchBase);
  } catch {
    browser = await chromium.launch({ ...launchBase, channel: undefined });
  }
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await page.addInitScript(() => {
    const g = window;
    g.__audioDebug = {
      events: [],
      contexts: {},
      nextCtxId: 1,
      speakCount: 0,
      cancelCount: 0,
      maxConcurrent: 0,
    };
    const push = (type, payload = {}) => {
      g.__audioDebug.events.push({ type, ts: Date.now(), ...payload });
      if (g.__audioDebug.events.length > 600) {
        g.__audioDebug.events.shift();
      }
    };

    const NativeAC = g.AudioContext || g.webkitAudioContext;
    if (NativeAC) {
      const PatchedAC = class extends NativeAC {
        constructor(...args) {
          super(...args);
          const id = g.__audioDebug.nextCtxId++;
          this.__debugId = id;
          g.__audioDebug.contexts[id] = { state: this.state, activeSources: 0 };
          push("ac_create", { id, state: this.state });
          this.addEventListener("statechange", () => {
            const c = g.__audioDebug.contexts[id];
            if (c) c.state = this.state;
            push("ac_state", { id, state: this.state });
          });
        }
        createBufferSource() {
          const source = super.createBufferSource();
          const id = this.__debugId;
          const originalStart = source.start.bind(source);
          source.start = (...args) => {
            const c = g.__audioDebug.contexts[id];
            if (c) c.activeSources += 1;
            push("ac_source_start", { id, activeSources: c?.activeSources ?? 0 });
            return originalStart(...args);
          };
          source.addEventListener("ended", () => {
            const c = g.__audioDebug.contexts[id];
            if (c) c.activeSources = Math.max(0, c.activeSources - 1);
            push("ac_source_end", { id, activeSources: c?.activeSources ?? 0 });
          });
          return source;
        }
      };
      g.AudioContext = PatchedAC;
      if (g.webkitAudioContext) g.webkitAudioContext = PatchedAC;
    }

    if (g.speechSynthesis) {
      const speak = g.speechSynthesis.speak.bind(g.speechSynthesis);
      const cancel = g.speechSynthesis.cancel.bind(g.speechSynthesis);
      g.speechSynthesis.speak = (u) => {
        g.__audioDebug.speakCount += 1;
        push("tts_speak", { text: String(u?.text || "").slice(0, 50) });
        return speak(u);
      };
      g.speechSynthesis.cancel = () => {
        g.__audioDebug.cancelCount += 1;
        push("tts_cancel");
        return cancel();
      };
    }

    setInterval(() => {
      const contexts = Object.values(g.__audioDebug.contexts || {});
      const activeSources = contexts.reduce((s, c) => s + (c.activeSources || 0), 0);
      const speaking = g.speechSynthesis?.speaking ? 1 : 0;
      const audibleAudio = Array.from(document.querySelectorAll("audio")).filter(
        (a) => !a.paused && !a.muted && a.volume > 0,
      ).length;
      const audibleVideo = Array.from(document.querySelectorAll("video")).filter(
        (v) => !v.paused && !v.muted && v.volume > 0,
      ).length;
      const concurrent = activeSources + speaking + audibleAudio + audibleVideo;
      g.__audioDebug.maxConcurrent = Math.max(g.__audioDebug.maxConcurrent || 0, concurrent);
    }, 120);
  });

  const results = [];
  try {
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    const boot = await bootstrapToLive(page);
    const case1 = await getAudioMetrics(page);
    results.push({ id: "TC-AUDIO-001", desc: "进入主界面后单音源", ...boot, ...case1 });

    await maybeClickByText(page, "日记本", 1200);
    const diaryReadClicked = await page.evaluate(() => {
      const u = new SpeechSynthesisUtterance("这是冲突测试日记朗读。".repeat(25));
      u.lang = "zh-CN";
      window.speechSynthesis.speak(u);
      return true;
    });
    await page.waitForTimeout(900);
    const preSwitchSpeaking = await page.evaluate(() => !!window.speechSynthesis?.speaking);
    await maybeClickByText(page, "实时翻译", 1200);
    await page.evaluate(() => {
      const startBtn = document.querySelector("button.w-24.h-24");
      if (startBtn instanceof HTMLButtonElement) {
        startBtn.click();
      }
    });
    await page.waitForTimeout(3500);
    const case2 = await getAudioMetrics(page);
    results.push({ id: "TC-AUDIO-002", desc: "日记朗读切回Live后不双声", diaryReadClicked, preSwitchSpeaking, ...case2 });

    const mediaGuardTriggered = await page.evaluate(() => {
      const audio = document.createElement("audio");
      const ctx = new AudioContext({ sampleRate: 48000 });
      const frames = 48000;
      const buffer = ctx.createBuffer(1, frames, 48000);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i += 1) {
        data[i] = Math.sin((2 * Math.PI * 880 * i) / 48000) * 0.3;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const dest = ctx.createMediaStreamDestination();
      source.connect(dest);
      audio.srcObject = dest.stream;
      audio.autoplay = true;
      audio.volume = 1;
      document.body.appendChild(audio);
      source.start();
      return true;
    });
    await page.waitForTimeout(1200);
    const case3 = await getAudioMetrics(page);
    results.push({ id: "TC-AUDIO-003", desc: "Live期间外部媒体播放应被拦截", mediaGuardTriggered, ...case3 });

    const inconclusive = results.filter((r) => !r.liveVisible || (!r.recentEvents?.length && !r.preSwitchSpeaking && !r.mediaGuardTriggered));
    const failed = results.filter((r) => {
      if (r.id === "TC-AUDIO-003") {
        return r.concurrentNow > 1;
      }
      return r.maxConcurrent > 1 || r.speaking || (r.preSwitchSpeaking && r.cancelCount < 1);
    });
    console.log(JSON.stringify({ at: nowTs(), target: TARGET_URL, results, failedCount: failed.length, inconclusiveCount: inconclusive.length }, null, 2));
    await browser.close();
    if (failed.length > 0) {
      process.exit(2);
    }
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ at: nowTs(), error: String(error) }, null, 2));
    await browser.close();
    process.exit(1);
  }
}

void main();
