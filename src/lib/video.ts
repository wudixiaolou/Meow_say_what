import { pickSupportedHighlightMimeType } from "./highlightMime";
import {
  chooseCaptureChunks,
  expandSelectionToContinuousPrefix,
  pickTimedChunksForCaptureWindow,
} from "./highlightBufferCompose";

export class VideoRecorder {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private intervalId: number | null = null;
  public onFrame: (base64: string) => void;

  constructor(video: HTMLVideoElement, onFrame: (base64: string) => void) {
    this.video = video;
    this.onFrame = onFrame;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
  }

  start(fps: number = 1) {
    this.intervalId = window.setInterval(() => {
      if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
        let width = this.video.videoWidth;
        let height = this.video.videoHeight;
        const maxDim = 768;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.floor((height / width) * maxDim);
            width = maxDim;
          } else {
            width = Math.floor((width / height) * maxDim);
            height = maxDim;
          }
        }
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx.drawImage(this.video, 0, 0, width, height);
        const dataUrl = this.canvas.toDataURL("image/jpeg", 0.8);
        const base64 = dataUrl.split(",")[1];
        this.onFrame(base64);
      }
    }, 1000 / fps);
  }

  stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

type ClipChunk = {
  blob: Blob;
  startedAt: number;
  endedAt: number;
};

export type HighlightTriggerType = "audio" | "vision" | "manual";

export interface HighlightCaptureResult {
  blob: Blob;
  mimeType: string;
  startedAt: number;
  endedAt: number;
}

export class VideoHighlightBuffer {
  private recorder: MediaRecorder | null = null;
  private chunks: ClipChunk[] = [];
  private readonly stream: MediaStream;
  private readonly maxBufferMs: number;
  private readonly chunkMs: number;
  private currentChunkStartedAt = 0;
  private mimeType: string;
  private initChunk: Blob | null = null;
  private active = false;

  constructor(stream: MediaStream, options?: { maxBufferMs?: number; chunkMs?: number }) {
    this.stream = stream;
    this.maxBufferMs = options?.maxBufferMs ?? 5000;
    this.chunkMs = options?.chunkMs ?? 500;
    this.mimeType = this.pickMimeType();
  }

  start() {
    if (this.recorder) {
      return;
    }
    const options = this.buildRecorderOptions();
    try {
      this.recorder = options ? new MediaRecorder(this.stream, options) : new MediaRecorder(this.stream);
    } catch {
      this.recorder = new MediaRecorder(this.stream);
    }
    this.mimeType = this.recorder.mimeType || this.mimeType;
    this.currentChunkStartedAt = Date.now();
    this.recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size <= 0) {
        return;
      }
      if (!this.initChunk) {
        this.initChunk = event.data;
      }
      const now = Date.now();
      this.chunks.push({
        blob: event.data,
        startedAt: this.currentChunkStartedAt,
        endedAt: now,
      });
      this.currentChunkStartedAt = now;
      this.prune();
    };
    try {
      this.recorder.start(this.chunkMs);
      this.active = true;
    } catch {
      this.active = false;
      this.recorder = null;
      this.chunks = [];
      this.initChunk = null;
    }
  }

  stop() {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
    this.recorder = null;
    this.chunks = [];
    this.initChunk = null;
    this.active = false;
  }

  async captureWindow(options?: {
    triggerAt?: number;
    preMs?: number;
    postMs?: number;
  }): Promise<HighlightCaptureResult> {
    if (!this.active || !this.recorder || this.recorder.state === "inactive") {
      throw new Error("highlight_buffer_inactive");
    }
    const triggerAt = options?.triggerAt ?? Date.now();
    const preMs = options?.preMs ?? 3000;
    const postMs = options?.postMs ?? 2000;
    if (postMs > 0) {
      await wait(postMs);
    }
    const windowStart = triggerAt - preMs;
    const windowEnd = triggerAt + postMs;
    const pickedWindow = pickTimedChunksForCaptureWindow(this.chunks, windowStart, windowEnd, 1);
    const picked = expandSelectionToContinuousPrefix(this.chunks, pickedWindow);
    if (!picked.length) {
      throw new Error("highlight_no_chunks");
    }
    const pickedBlobs = picked.map((chunk) => chunk.blob);
    const composeParts = chooseCaptureChunks(pickedBlobs, this.initChunk);
    const blob = new Blob(composeParts, { type: this.mimeType || this.recorder.mimeType || "" });
    return {
      blob,
      mimeType: this.mimeType || this.recorder.mimeType || "",
      startedAt: picked[0].startedAt,
      endedAt: picked[picked.length - 1].endedAt,
    };
  }

  private prune() {
    const threshold = Date.now() - this.maxBufferMs;
    while (this.chunks.length && this.chunks[0].endedAt < threshold) {
      this.chunks.shift();
    }
  }

  private pickMimeType() {
    const ua = navigator.userAgent || "";
    const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Chromium|Edg|Android/i.test(ua);
    return pickSupportedHighlightMimeType((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
      isSafari,
    );
  }

  private buildRecorderOptions(): MediaRecorderOptions | undefined {
    const base: MediaRecorderOptions = this.mimeType ? { mimeType: this.mimeType } : {};
    const ua = navigator.userAgent || "";
    const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Chromium|Edg|Android/i.test(ua);
    if (isSafari) {
      return Object.keys(base).length > 0 ? base : undefined;
    }
    const withKeyframe = {
      ...base,
      videoKeyFrameIntervalDuration: 1000,
    } as MediaRecorderOptions;
    return withKeyframe;
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
