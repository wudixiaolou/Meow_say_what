import { acquireAudioFocus } from "./audioFocus";

export class AudioStreamer {
  private static activeInstance: AudioStreamer | null = null;
  private audioCtx: AudioContext;
  private nextStartTime: number;
  private readonly maxBufferedSeconds: number;
  private activeSources: Set<AudioBufferSourceNode>;
  private releaseFocus: (() => void) | null;

  constructor() {
    this.audioCtx = new (
      window.AudioContext || (window as any).webkitAudioContext
    )({ sampleRate: 24000 });
    this.nextStartTime = this.audioCtx.currentTime;
    this.maxBufferedSeconds = 2.4;
    this.activeSources = new Set();
    this.releaseFocus = null;
    if (AudioStreamer.activeInstance && AudioStreamer.activeInstance !== this) {
      AudioStreamer.activeInstance.stop();
    }
    AudioStreamer.activeInstance = this;
  }

  async resume() {
    if (AudioStreamer.activeInstance !== this) {
      return;
    }
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }
  }

  interrupt() {
    if (AudioStreamer.activeInstance !== this) {
      return;
    }
    this.nextStartTime = this.audioCtx.currentTime;
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {
      }
    });
    this.activeSources.clear();
    if (this.releaseFocus) {
      this.releaseFocus();
      this.releaseFocus = null;
    }
  }

  addPCM16(base64: string) {
    if (AudioStreamer.activeInstance !== this) {
      return 0;
    }
    if (!this.releaseFocus) {
      this.releaseFocus = acquireAudioFocus("live-stream", () => {
        this.interrupt();
      });
    }
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    const audioBuffer = this.audioCtx.createBuffer(
      1,
      float32Array.length,
      24000,
    );
    audioBuffer.getChannelData(0).set(float32Array);

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioCtx.destination);
    source.onended = () => {
      this.activeSources.delete(source);
    };

    const now = this.audioCtx.currentTime;
    const buffered = this.nextStartTime - now;
    if (buffered > this.maxBufferedSeconds) {
      this.nextStartTime = now;
      return this.getBufferedMs();
    }
    const startTime = Math.max(this.nextStartTime, now);
    this.activeSources.add(source);
    source.start(startTime);
    this.nextStartTime = startTime + audioBuffer.duration;
    return this.getBufferedMs();
  }

  getBufferedMs() {
    if (AudioStreamer.activeInstance !== this) {
      return 0;
    }
    return Math.max(0, (this.nextStartTime - this.audioCtx.currentTime) * 1000);
  }

  stop() {
    this.interrupt();
    if (this.releaseFocus) {
      this.releaseFocus();
      this.releaseFocus = null;
    }
    if (AudioStreamer.activeInstance === this) {
      AudioStreamer.activeInstance = null;
    }
    if (this.audioCtx.state !== "closed") {
      this.audioCtx.close();
    }
  }
}

export class AudioRecorder {
  private audioCtx: AudioContext;
  private stream: MediaStream;
  private processor: ScriptProcessorNode;
  private silentGain: GainNode;
  public onData: (base64: string) => void;

  constructor(stream: MediaStream, onData: (base64: string) => void) {
    this.stream = stream;
    this.onData = onData;
    this.audioCtx = new (
      window.AudioContext || (window as any).webkitAudioContext
    )({ sampleRate: 16000 });
    const source = this.audioCtx.createMediaStreamSource(stream);
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.silentGain = this.audioCtx.createGain();
    this.silentGain.gain.value = 0;

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        let s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      const buffer = new Uint8Array(pcm16.buffer);
      let binary = "";
      for (let i = 0; i < buffer.byteLength; i++) {
        binary += String.fromCharCode(buffer[i]);
      }
      this.onData(btoa(binary));
    };

    source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.audioCtx.destination);
  }

  stop() {
    this.processor.disconnect();
    this.silentGain.disconnect();
    if (this.audioCtx.state !== "closed") {
      this.audioCtx.close();
    }
  }
}
