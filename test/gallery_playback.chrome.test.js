import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT_DIR = path.resolve(process.cwd());
const SOURCE_VIDEO_PATH = process.env.TEST_VIDEO_PATH
  ? path.resolve(process.env.TEST_VIDEO_PATH)
  : path.resolve(
      ROOT_DIR,
      "test",
      "test_Vocalization_Movement_Videos",
      "01e6b09b5a7f0e980103700197fa2caf5a_130.mp4",
    );
const OUTPUT_FILE = path.resolve(ROOT_DIR, "test", "gallery_playback_result.json");
const BROWSER_HEADLESS = process.env.PLAYWRIGHT_HEADLESS === "1";

async function seedRandomCapturedClips(page, count) {
  return await page.evaluate(async (clipCount) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const request = indexedDB.open("meowlingo-highlights-db", 1);
    const db = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        const nextDb = request.result;
        if (!nextDb.objectStoreNames.contains("highlights")) {
          const store = nextDb.createObjectStore("highlights", { keyPath: "id" });
          store.createIndex("createdAtMs", "createdAtMs", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise((resolve, reject) => {
      const tx = db.transaction("highlights", "readwrite");
      tx.objectStore("highlights").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const mimeType =
      [
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=vp8",
        "video/webm",
      ].find((item) => MediaRecorder.isTypeSupported(item)) || "";
    const insertedSizes = [];
    const now = Date.now();

    for (let i = 0; i < clipCount; i += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const context = canvas.getContext("2d");
      const stream = canvas.captureStream(24);
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      let frame = 0;
      const seed = Math.floor(Math.random() * 360);
      const timer = window.setInterval(() => {
        frame += 1;
        context.fillStyle = `hsl(${(seed + frame * 21) % 360},80%,50%)`;
        context.fillRect(0, 0, 320, 240);
        context.fillStyle = "white";
        context.font = "bold 28px sans-serif";
        context.fillText(`C${i}-${frame}`, 20 + (frame % 100), 120 + ((frame * 3) % 40));
      }, 40);

      recorder.start(240);
      await wait(900 + Math.floor(Math.random() * 300));
      recorder.stop();
      await new Promise((resolve) => {
        recorder.onstop = () => resolve();
      });
      window.clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      const clipBlob = new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" });
      insertedSizes.push(clipBlob.size);

      await new Promise((resolve, reject) => {
        const tx = db.transaction("highlights", "readwrite");
        tx.objectStore("highlights").put({
          id: `chrome-random-${now}-${i}`,
          createdAtMs: now - i * 1000,
          triggerType: "manual",
          triggerText: "chrome-random-capture",
          caption: `随机抓拍-${i + 1}`,
          clipBlob,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    db.close();
    return { inserted: clipCount, insertedSizes };
  }, count);
}

async function seedVideoClipFromFile(page, filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const base64 = fileBuffer.toString("base64");
  const mimeType = filePath.toLowerCase().endsWith(".mp4") ? "video/mp4" : "video/webm";
  return await page.evaluate(async ({ base64Data, type, fileName }) => {
    const bin = atob(base64Data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    const clipBlob = new Blob([bytes], { type });
    const request = indexedDB.open("meowlingo-highlights-db", 1);
    const db = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        const nextDb = request.result;
        if (!nextDb.objectStoreNames.contains("highlights")) {
          const store = nextDb.createObjectStore("highlights", { keyPath: "id" });
          store.createIndex("createdAtMs", "createdAtMs", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("highlights", "readwrite");
      tx.objectStore("highlights").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const now = Date.now();
    const clipId = `chrome-source-video-${now}`;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("highlights", "readwrite");
      tx.objectStore("highlights").put({
        id: clipId,
        createdAtMs: now,
        triggerType: "manual",
        triggerText: fileName,
        caption: fileName,
        clipBlob,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { inserted: 1, clipId, fileName, byteLength: bytes.length, type };
  }, { base64Data: base64, type: mimeType, fileName: path.basename(filePath) });
}

async function runGalleryPlaybackCases(page) {
  const actionLog = [];
  actionLog.push("open_gallery_tab");
  await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll("button")).find(
      (button) => (button.textContent || "").trim() === "精彩瞬间",
    );
    if (tab) {
      tab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }
  });
  await page.waitForTimeout(250);

  return await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const getThumbButtons = () =>
      Array.from(document.querySelectorAll("button")).filter((button) => !!button.querySelector("video"));
    const clickGalleryTab = () => {
      const tab = Array.from(document.querySelectorAll("button")).find(
        (button) => (button.textContent || "").trim() === "精彩瞬间",
      );
      if (!tab) return false;
      tab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    };
    const clickBack = () => {
      const backButton = Array.from(document.querySelectorAll("button")).find(
        (button) => (button.className || "").includes("w-10 h-10") && button.querySelector("svg"),
      );
      if (!backButton) return false;
      backButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    };
    const playAndAssert = async () => {
      const video = Array.from(document.querySelectorAll("video")).find((node) => node.controls);
      if (!video) {
        return { opened: false, pass: false, reason: "no-detail-video" };
      }
      try {
        video.playbackRate = 8;
        await video.play();
      } catch {}
      const from = video.currentTime;
      let ended = false;
      const waitEnded = new Promise((resolve) => {
        const done = () => {
          ended = true;
          video.removeEventListener("ended", done);
          resolve();
        };
        video.addEventListener("ended", done);
      });
      await Promise.race([waitEnded, wait(45000)]);
      const to = video.currentTime;
      return {
        opened: true,
        pass: ended && to > from + 0.25 && !video.error,
        ended,
        dt: Number((to - from).toFixed(3)),
        readyState: video.readyState,
        error: video.error ? video.error.code : null,
        duration: Number.isFinite(video.duration) ? Number(video.duration.toFixed(3)) : null,
      };
    };

    const cases = [];
    let thumbs = getThumbButtons();
    if (!thumbs.length) {
      for (let i = 0; i < 6 && !thumbs.length; i += 1) {
        clickGalleryTab();
        await wait(130);
        thumbs = getThumbButtons();
      }
    }

    cases.push({
      id: "TC-01",
      name: "精彩瞬间列表展示指定视频素材",
      pass: thumbs.length >= 1,
      detail: { thumbCount: thumbs.length },
    });

    const each = [];
    let eachPass = true;
    for (let i = 0; i < thumbs.length; i += 1) {
      thumbs = getThumbButtons();
      const thumb = thumbs[i];
      if (!thumb) {
        eachPass = false;
        each.push({ index: i, pass: false, reason: "thumb-missing" });
        continue;
      }
      thumb.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      await wait(260);
      const playback = await playAndAssert();
      each.push({ index: i, ...playback });
      if (!playback.pass) eachPass = false;
      clickBack();
      await wait(220);
    }
    cases.push({
      id: "TC-02",
      name: "指定素材从精彩瞬间进入后可完整播放",
      pass: eachPass && each.length > 0,
      detail: each,
    });

    let replayPass = false;
    let replayDetail = { reason: "no-thumb" };
    thumbs = getThumbButtons();
    if (thumbs.length > 0) {
      thumbs[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      await wait(260);
      const first = await playAndAssert();
      clickBack();
      await wait(220);
      thumbs = getThumbButtons();
      if (thumbs.length > 0) {
        thumbs[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        await wait(260);
        const second = await playAndAssert();
        replayPass = first.pass && second.pass;
        replayDetail = { first, second };
      }
    }
    cases.push({
      id: "TC-03",
      name: "同一素材二次进入详情仍可完整播放",
      pass: replayPass,
      detail: replayDetail,
    });

    return {
      actionLog: ["open_gallery_tab", "enter_detail_and_play", "repeat_playback"],
      summary: {
        total: cases.length,
        passed: cases.filter((item) => item.pass).length,
        failed: cases.filter((item) => !item.pass).length,
      },
      cases,
    };
  });
}

async function main() {
  if (!fs.existsSync(SOURCE_VIDEO_PATH)) {
    throw new Error(`source_video_not_found:${SOURCE_VIDEO_PATH}`);
  }
  const viteServer = await createServer({
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 3001,
      strictPort: true,
    },
  });
  await viteServer.listen();
  const localUrl = viteServer.resolvedUrls?.local?.[0] || "http://127.0.0.1:3001/";
  let browser;
  try {
    browser = await chromium.launch({ headless: BROWSER_HEADLESS, channel: "chrome" });
  } catch {
    browser = await chromium.launch({ headless: BROWSER_HEADLESS });
  }
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    ...{
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
    },
    recordVideo: { dir: path.resolve(ROOT_DIR, "test", "artifacts", "playback_video") },
  });
  const page = await context.newPage();
  const browserConsole = [];
  page.on("console", (msg) => {
    browserConsole.push({ type: msg.type(), text: msg.text(), ts: Date.now() });
  });
  await page.goto(localUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(600);

  const seedResult = await seedVideoClipFromFile(page, SOURCE_VIDEO_PATH);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(600);
  const testResult = await runGalleryPlaybackCases(page);
  const playbackCapturePath = await page.video()?.path();
  await browser.close();
  await viteServer.close();

  const output = {
    sourceVideoPath: SOURCE_VIDEO_PATH,
    localUrl,
    seedResult,
    testResult,
    browserConsole,
    playbackCapturePath,
  };
  console.log(JSON.stringify(output, null, 2));
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf-8");
  if (testResult.summary.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ error: String(error?.stack || error) }, null, 2), "utf-8");
  process.exit(1);
});
