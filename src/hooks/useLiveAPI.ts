import { useState, useRef, useCallback, RefObject, useEffect } from "react";
import { GoogleGenAI, LiveServerMessage, Modality, ActivityHandling } from "@google/genai";
import { AppLanguage, HighlightClip, InteractionMode, Persona, SessionLog } from "../types";
import { AudioStreamer, AudioRecorder } from "../lib/audio";
import { trackEvent } from "../lib/analytics";
import { VideoRecorder, VideoHighlightBuffer, HighlightTriggerType } from "../lib/video";
import { playCatSoundDeclaration } from "../constants";
import { playCatAudio, stopCatAudio } from "../lib/catSounds";
import { isCatAction } from "../lib/catActions";
import { appendClipWithLimit } from "../lib/highlightClip";
import {
  deleteHighlightClipFromLocal,
  loadHighlightClipsFromLocal,
  saveHighlightClipToLocal,
} from "../lib/highlightStorage";
import { addInteractionTextMaterial } from "../lib/diaryData";
import { buildObservationPrompt, shouldRelayObservation } from "../lib/observationRelay";
import { getSpeechLanguageCode } from "../lib/language";

export function useLiveAPI(
  persona: Persona,
  mode: InteractionMode,
  videoRef: RefObject<HTMLVideoElement | null>,
  userProfile: { role: "dad" | "mom" | null; catName: string },
  language: AppLanguage = "zh",
) {
  const isEn = language === "en";
  const SESSION_AUDIO_LOCK_KEY = "meowlingo_live_audio_lock_v1";
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [backendDegraded, setBackendDegraded] = useState(false);
  const [activeLiveModel, setActiveLiveModel] = useState("");
  const [highlightClip, setHighlightClip] = useState<HighlightClip | null>(null);
  const [highlightHistory, setHighlightHistory] = useState<HighlightClip[]>([]);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const autoCaptureEnabledRef = useRef(true);

  const isConnectedRef = useRef(false);
  const isConnectingRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const sessionEpochRef = useRef(0);
  const tabIdRef = useRef(
    (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`),
  );
  const lockHeartbeatRef = useRef<number | null>(null);

  const sessionRef = useRef<any>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const videoRecorderRef = useRef<VideoRecorder | null>(null);
  const highlightBufferRef = useRef<VideoHighlightBuffer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionBufferRef = useRef("");
  const outputAudioActiveUntilRef = useRef(0);
  const mobileFallbackEnabledRef = useRef(false);
  const forcedLiveModelRef = useRef("");
  const sessionHandleRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const backendHealthyRef = useRef(true);
  const recentSignalsRef = useRef<Array<{ ts: number; text: string }>>([]);
  const autoNarrationTimerRef = useRef<number | null>(null);
  const lastNarratedSignalTsRef = useRef(0);
  const lastFrameSizeRef = useRef(0);
  const lastVisionSignalTsRef = useRef(0);
  const pendingNarrationRef = useRef(false);
  const observationDirtyRef = useRef(false);
  const lastObservationTextRef = useRef("");
  const lastObservationAtRef = useRef(0);
  const lastAutoNarrationAtRef = useRef(0);
  const lastCaptureAtRef = useRef(0);
  const latestNarrationRef = useRef("");
  const narrationPendingStartedAtRef = useRef(0);
  const captureQueueRef = useRef<Array<{ triggerType: HighlightTriggerType; triggerText: string; triggerAt: number }>>([]);
  const captureBusyRef = useRef(false);
  const captureWorkerRef = useRef<number | null>(null);
  const manualCaptureInFlightRef = useRef(0);
  const audioHealthTimerRef = useRef<number | null>(null);
  const lastOutputAudioAtRef = useRef(0);
  const lastModelTextAtRef = useRef(0);
  const lastAudioRecoveryAttemptAtRef = useRef(0);
  const mediaPlayGuardRef = useRef<((event: Event) => void) | null>(null);
  const recentOutputAudioChunkRef = useRef<Map<string, number>>(new Map());
  const processedFunctionCallIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void loadHighlightClipsFromLocal(18)
      .then((clips) => {
        if (cancelled) {
          clips.forEach((item) => URL.revokeObjectURL(item.clipUrl));
          return;
        }
        setHighlightHistory(clips);
        setHighlightClip(clips[0] || null);
      })
      .catch((error) => {
        console.warn("highlight_local_load_failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearHighlight = useCallback(() => {
    setHighlightClip(null);
  }, []);

  const updateHighlightCaption = useCallback((nextCaption: string) => {
    const trimmed = nextCaption.slice(0, 50);
    setHighlightClip((prev) => {
      if (!prev) {
        return prev;
      }
      const next = { ...prev, caption: trimmed };
      void saveHighlightClipToLocal(next).catch(() => {});
      return next;
    });
    setHighlightHistory((old) => old.map((item) => (item.id === highlightClip?.id ? { ...item, caption: trimmed } : item)));
  }, [highlightClip?.id]);

  const toggleAutoCapture = useCallback(() => {
    setAutoCaptureEnabled((prev) => {
      autoCaptureEnabledRef.current = !prev;
      return !prev;
    });
  }, []);

  const shouldCaptureAudioEvent = useCallback((data: any) => {
    const confidence = Number(data?.confidence ?? 0);
    if (confidence < 0.62) {
      return false;
    }
    const topClass = String(data?.top_class ?? "").toLowerCase();
    const blocked = ["speech", "music", "noise", "silence", "engine", "typing", "vehicle"];
    if (blocked.some((token) => topClass.includes(token))) {
      return false;
    }
    const intentLabel = String(data?.intent_label ?? "").toLowerCase();
    const intentConfidence = Number(data?.intent_confidence ?? 0);
    const intentMeaningful =
      !!intentLabel &&
      !["unknown", "neutral_other", "noise", "silence"].includes(intentLabel) &&
      intentConfidence >= 0.45;
    const classMeaningful = /meow|cat|kitten|purr|hiss|mew/.test(topClass);
    return intentMeaningful || classMeaningful;
  }, []);

  const getVisionSemanticLabel = useCallback((motionRatio: number) => {
    if (isEn) {
      if (motionRatio >= 0.42) {
        return "Fast tail swishing detected, your cat may be alert or impatient";
      }
      if (motionRatio >= 0.28) {
        return "Sustained tail movement detected, your cat is scanning the environment";
      }
      if (motionRatio >= 0.2) {
        return "Tail-tip flicks and posture shifts detected, your cat may be focused or mildly irritated";
      }
      return "";
    }
    if (motionRatio >= 0.42) {
      return "检测到尾巴高速甩动，猫咪可能不耐烦或警觉";
    }
    if (motionRatio >= 0.28) {
      return "检测到尾巴持续摆动，猫咪正在巡逻观察环境";
    }
    if (motionRatio >= 0.2) {
      return "检测到尾尖轻弹与姿态微调，猫咪可能在专注或轻度烦躁";
    }
    return "";
  }, [isEn]);

  const getAudioUserFriendlyLabel = useCallback((topClass: string, intentLabel: string) => {
    const classStr = topClass.toLowerCase();
    let soundInterpretation = isEn
      ? "Cat vocalization detected, likely expressing a need"
      : "检测到猫咪叫声，可能在表达当前需求";
    if (classStr.includes("purr")) soundInterpretation = isEn ? "Purring detected, your cat is likely relaxed or secure" : "检测到打呼噜，猫咪通常较放松或有安全感";
    else if (classStr.includes("hiss") || classStr.includes("growl")) soundInterpretation = isEn ? "Hissing or growling detected, your cat may be defensive or tense" : "检测到哈气或低吼，猫咪可能在防御或紧张";
    else if (classStr.includes("mew") || classStr.includes("kitten")) soundInterpretation = isEn ? "Short light mews detected, your cat may be testing communication" : "检测到轻短叫声，猫咪可能在试探性沟通";
    else if (classStr.includes("meow")) soundInterpretation = isEn ? "Meowing detected, your cat may be seeking attention" : "检测到喵叫，猫咪可能在寻求关注";

    if (intentLabel === "request") return isEn ? `${soundInterpretation}, and it sounds like a request` : `${soundInterpretation}，并且更像在提出请求`;
    if (intentLabel === "protest") return isEn ? `${soundInterpretation}, with a protesting tone` : `${soundInterpretation}，并且带有抗议倾向`;
    if (intentLabel === "greeting") return isEn ? `${soundInterpretation}, and it feels like a greeting` : `${soundInterpretation}，并且更像在打招呼`;
    return soundInterpretation;
  }, [isEn]);

  const addDetectionLog = useCallback((text: string) => {
    const next = text.trim();
    if (!next) {
      return;
    }
    setLogs((old) => {
      const last = old[old.length - 1];
      if (last && last.text === next && Date.now() - last.timestamp.getTime() < 2200) {
        return old;
      }
      return [...old.slice(-5), { timestamp: new Date(), text: next }];
    });
  }, []);

  const relayObservationToLive = useCallback(
    (signalText: string) => {
      if (mode !== "narration") {
        return;
      }
      const now = Date.now();
      const minGapMs = mode === "narration" ? 2200 : 4200;
      const allowed = shouldRelayObservation({
        nowMs: now,
        lastRelayAtMs: lastAutoNarrationAtRef.current,
        minGapMs,
        signalText,
        lastSignalText: lastNarratedSignalTsRef.current === 0 ? "" : lastObservationTextRef.current,
      });
      if (!allowed) {
        return;
      }
      const session = sessionRef.current;
      if (!session || !isConnectedRef.current) {
        return;
      }
      const prompt = buildObservationPrompt(signalText, mode === "narration" ? "narration" : "qa", language);
      pendingNarrationRef.current = true;
      narrationPendingStartedAtRef.current = now;
      observationDirtyRef.current = false;
      lastAutoNarrationAtRef.current = now;
      lastNarratedSignalTsRef.current = now;
      addDetectionLog(isEn ? "Cat translation triggered" : "已触发猫语翻译");
      void trackEvent("audio_observation_relayed", {
        mode,
        signal: signalText.slice(0, 120),
      });
      try {
        session.sendRealtimeInput({
          text: prompt,
        });
      } catch (error: any) {
        pendingNarrationRef.current = false;
        narrationPendingStartedAtRef.current = 0;
        void trackEvent("audio_observation_relay_failed", {
          mode,
          reason: typeof error?.message === "string" ? error.message.slice(0, 120) : "unknown",
        });
      }
    },
    [addDetectionLog, isEn, language, mode],
  );

  const persistInteractionText = useCallback(
    (source: "model_output" | "output_transcript" | "input_transcript" | "system_observation", text: string) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      void addInteractionTextMaterial({
        sessionId: `${tabIdRef.current}-${sessionEpochRef.current}`,
        source,
        text: normalized,
      }).catch(() => {});
    },
    [],
  );

  const commitCapturedClip = useCallback(
    (task: { triggerType: HighlightTriggerType; triggerText: string }, clip: { blob: Blob; mimeType: string; startedAt: number; endedAt: number }) => {
      const nextUrl = URL.createObjectURL(clip.blob);
      const fallbackCaption = latestNarrationRef.current.trim() || (isEn ? "My spotlight moment" : "本喵高光时刻");
      const nextClip: HighlightClip = {
        id: `${clip.startedAt}-${clip.endedAt}`,
        createdAt: new Date(clip.endedAt),
        triggerType: task.triggerType,
        triggerText: task.triggerText,
        clipBlob: clip.blob,
        clipUrl: nextUrl,
        caption: fallbackCaption.slice(0, 50),
      };
      setHighlightClip(nextClip);
      setHighlightHistory((old) => {
        const { nextHistory, removed } = appendClipWithLimit(old, nextClip, 18);
        removed.forEach((item) => {
          URL.revokeObjectURL(item.clipUrl);
          void deleteHighlightClipFromLocal(item.id).catch(() => {});
        });
        return nextHistory;
      });
      void saveHighlightClipToLocal(nextClip).catch((error) => {
        console.warn("highlight_local_save_failed", error);
      });
      void trackEvent("highlight_capture_success", {
        trigger_type: task.triggerType,
        clip_ms: clip.endedAt - clip.startedAt,
        clip_bytes: clip.blob.size,
        clip_mime: clip.mimeType || "unknown",
        trigger_text: task.triggerText,
      });
    },
    [isEn],
  );

  const captureManualNow = useCallback(
    async (triggerText: string, triggerAt: number) => {
      const buffer = highlightBufferRef.current;
      if (!buffer) {
        return;
      }
      if (manualCaptureInFlightRef.current >= 2) {
        return;
      }
      manualCaptureInFlightRef.current += 1;
      const task = { triggerType: "manual" as HighlightTriggerType, triggerText, triggerAt };
      try {
        const clip = await buffer.captureWindow({
          triggerAt,
          preMs: 3000,
          postMs: 2000,
        });
        commitCapturedClip(task, clip);
      } catch (error: any) {
        const reason =
          typeof error?.message === "string" && error.message.trim()
            ? error.message
            : "unknown";
        console.warn("highlight_capture_failed", reason);
        void trackEvent("highlight_capture_failed", {
          trigger_type: task.triggerType,
          trigger_text: task.triggerText,
          reason,
        });
      } finally {
        manualCaptureInFlightRef.current = Math.max(0, manualCaptureInFlightRef.current - 1);
      }
    },
    [commitCapturedClip],
  );

  const captureHighlight = useCallback(
    (triggerType: HighlightTriggerType, triggerText: string) => {
      const now = Date.now();
      if (triggerType !== "manual" && !autoCaptureEnabledRef.current) {
        return;
      }
      const minGap = triggerType === "manual" ? 1200 : 8000;
      if (now - lastCaptureAtRef.current < minGap) {
        return;
      }
      const queue = captureQueueRef.current;
      const duplicate = queue.find(
        (task) => task.triggerType === triggerType && now - task.triggerAt < 5000,
      );
      if (duplicate) {
        return;
      }
      if (triggerType !== "manual" && queue.length >= 2) {
        return;
      }
      if (triggerType === "manual") {
        void captureManualNow(triggerText, now);
        lastCaptureAtRef.current = now;
        return;
      }
      queue.push({ triggerType, triggerText, triggerAt: now });
      lastCaptureAtRef.current = now;
    },
    [captureManualNow],
  );

  const processCaptureQueue = useCallback(async () => {
    if (captureBusyRef.current) {
      return;
    }
    if (pendingNarrationRef.current) {
      return;
    }
    if (Date.now() < outputAudioActiveUntilRef.current + 900) {
      return;
    }
    const buffer = highlightBufferRef.current;
    if (!buffer) {
      return;
    }
    const task = captureQueueRef.current.shift();
    if (!task) {
      return;
    }
    captureBusyRef.current = true;
    try {
      const clip = await buffer.captureWindow({
        triggerAt: task.triggerAt,
        preMs: 3000,
        postMs: 2000,
      });
      commitCapturedClip(task, clip);
    } catch (error: any) {
      const reason =
        typeof error?.message === "string" && error.message.trim()
          ? error.message
          : "unknown";
      console.warn("highlight_capture_failed", reason);
      void trackEvent("highlight_capture_failed", {
        trigger_type: task.triggerType,
        trigger_text: task.triggerText,
        reason,
      });
    } finally {
      captureBusyRef.current = false;
    }
  }, [commitCapturedClip]);

  const readSessionLock = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_AUDIO_LOCK_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      const tabId = String(parsed?.tabId || "");
      const updatedAt = Number(parsed?.updatedAt || 0);
      if (!tabId || !Number.isFinite(updatedAt)) {
        return null;
      }
      return { tabId, updatedAt };
    } catch {
      return null;
    }
  }, [SESSION_AUDIO_LOCK_KEY]);

  const claimSessionLock = useCallback(() => {
    const payload = JSON.stringify({ tabId: tabIdRef.current, updatedAt: Date.now() });
    window.localStorage.setItem(SESSION_AUDIO_LOCK_KEY, payload);
  }, [SESSION_AUDIO_LOCK_KEY]);

  const releaseSessionLock = useCallback(() => {
    const lock = readSessionLock();
    if (lock?.tabId === tabIdRef.current) {
      window.localStorage.removeItem(SESSION_AUDIO_LOCK_KEY);
    }
  }, [SESSION_AUDIO_LOCK_KEY, readSessionLock]);

  const hasForeignActiveLock = useCallback(() => {
    const lock = readSessionLock();
    if (!lock) {
      return false;
    }
    if (lock.tabId === tabIdRef.current) {
      return false;
    }
    return Date.now() - lock.updatedAt < 7000;
  }, [readSessionLock]);

  const refreshSessionLock = useCallback(() => {
    const lock = readSessionLock();
    if (lock && lock.tabId !== tabIdRef.current && Date.now() - lock.updatedAt < 7000) {
      return false;
    }
    claimSessionLock();
    return true;
  }, [claimSessionLock, readSessionLock]);

  const silenceCompetingAudio = useCallback(() => {
    try {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
    }
    stopCatAudio();
    const keepVideo = videoRef.current;
    document.querySelectorAll("audio").forEach((el) => {
      if (!el.paused) {
        el.pause();
      }
      if (el.currentTime > 0) {
        el.currentTime = 0;
      }
    });
    document.querySelectorAll("video").forEach((el) => {
      if (keepVideo && el === keepVideo) {
        return;
      }
      if (!el.paused) {
        el.pause();
      }
    });
  }, [videoRef]);

  const startMediaPlayGuard = useCallback(() => {
    if (mediaPlayGuardRef.current) {
      return;
    }
    const handler = (event: Event) => {
      if (!isConnectedRef.current) {
        return;
      }
      const target = event.target;
      if (!(target instanceof HTMLMediaElement)) {
        return;
      }
      if (videoRef.current && target === videoRef.current) {
        return;
      }
      if (!target.paused) {
        target.pause();
      }
      if (target.currentTime > 0) {
        target.currentTime = 0;
      }
      addDetectionLog(isEn ? "Blocked competing media playback during Live session" : "Live会话中已拦截冲突媒体播放");
    };
    document.addEventListener("play", handler, true);
    mediaPlayGuardRef.current = handler;
  }, [videoRef, addDetectionLog, isEn]);

  const stopMediaPlayGuard = useCallback(() => {
    if (!mediaPlayGuardRef.current) {
      return;
    }
    document.removeEventListener("play", mediaPlayGuardRef.current, true);
    mediaPlayGuardRef.current = null;
  }, []);

  const cleanupConnection = useCallback((options?: { preserveMediaStream?: boolean }) => {
    const preserveMediaStream = options?.preserveMediaStream === true;
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioRecorderRef.current) {
      audioRecorderRef.current.stop();
      audioRecorderRef.current = null;
    }
    if (videoRecorderRef.current) {
      videoRecorderRef.current.stop();
      videoRecorderRef.current = null;
    }
    if (highlightBufferRef.current) {
      highlightBufferRef.current.stop();
      highlightBufferRef.current = null;
    }
    if (audioStreamerRef.current) {
      audioStreamerRef.current.stop();
      audioStreamerRef.current = null;
    }
    if (streamRef.current && !preserveMediaStream) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (autoNarrationTimerRef.current) {
      window.clearInterval(autoNarrationTimerRef.current);
      autoNarrationTimerRef.current = null;
    }
    if (captureWorkerRef.current) {
      window.clearInterval(captureWorkerRef.current);
      captureWorkerRef.current = null;
    }
    if (audioHealthTimerRef.current) {
      window.clearInterval(audioHealthTimerRef.current);
      audioHealthTimerRef.current = null;
    }
    if (lockHeartbeatRef.current) {
      window.clearInterval(lockHeartbeatRef.current);
      lockHeartbeatRef.current = null;
    }
    stopMediaPlayGuard();
    captureQueueRef.current = [];
    captureBusyRef.current = false;
    manualCaptureInFlightRef.current = 0;
    releaseSessionLock();
    if (videoRef.current && !preserveMediaStream) {
      videoRef.current.srcObject = null;
    }
    setIsConnected(false);
    isConnectedRef.current = false;
    setIsConnecting(false);
    isConnectingRef.current = false;
  }, [videoRef, releaseSessionLock, stopMediaPlayGuard]);

  const disconnect = useCallback(() => {
    sessionEpochRef.current += 1;
    manualDisconnectRef.current = true;
    forcedLiveModelRef.current = "";
    sessionHandleRef.current = null;
    reconnectAttemptsRef.current = 0;
    void trackEvent("session_ended", { reason: "manual_disconnect" });
    cleanupConnection();
  }, [cleanupConnection]);

  const connect = useCallback(async () => {
    if (isConnectingRef.current || isConnectedRef.current) return;
    if (hasForeignActiveLock()) {
      setErrorMessage(isEn ? "Another page is currently playing audio. Close it or stop translation there first." : "检测到另一个页面正在播放语音，请先关闭其他页面或停止其翻译");
      return;
    }
    const sessionEpoch = sessionEpochRef.current + 1;
    sessionEpochRef.current = sessionEpoch;
    const isStaleSession = () => sessionEpoch !== sessionEpochRef.current;
    setIsConnecting(true);
    isConnectingRef.current = true;
    manualDisconnectRef.current = false;
    setErrorMessage("");
    setBackendDegraded(false);
    claimSessionLock();
    silenceCompetingAudio();
    if (!audioStreamerRef.current) {
      audioStreamerRef.current = new AudioStreamer();
    }
    try {
      await audioStreamerRef.current.resume();
    } catch {
      setErrorMessage(isEn ? "Audio output initialization failed. Please tap Start again." : "音频输出初始化失败，请再次点击开始");
      cleanupConnection();
      return;
    }
    if (lockHeartbeatRef.current) {
      window.clearInterval(lockHeartbeatRef.current);
      lockHeartbeatRef.current = null;
    }
    lockHeartbeatRef.current = window.setInterval(() => {
      if (!refreshSessionLock()) {
        setErrorMessage(isEn ? "Another page took over audio playback. This session has stopped." : "检测到另一个页面接管了语音播放，当前会话已停止");
        cleanupConnection();
      }
    }, 2000);

    try {
      const qaVideoOnly = new URLSearchParams(window.location.search).get("qaVideoOnly") === "1";
      console.log("Requesting media devices...");
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!window.isSecureContext) {
          const host = window.location.host;
          setErrorMessage(isEn ? `Non-secure connection detected. Camera/microphone are blocked. Retry with https://${host}.` : `当前为非安全连接，无法调用摄像头/麦克风。请改用 https://${host} 后重试`);
        } else {
          setErrorMessage(isEn ? "This browser does not support camera/microphone APIs. Please try another browser." : "当前浏览器不支持摄像头/麦克风接口，请更换浏览器后重试");
        }
        cleanupConnection();
        return;
      }
      const isMobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(
        navigator.userAgent,
      );
      const reusableStream = streamRef.current;
      const hasReusableVideo =
        !!reusableStream &&
        reusableStream.getVideoTracks().some((track) => track.readyState === "live");
      let stream: MediaStream | null = hasReusableVideo ? reusableStream : null;
      let effectiveVideoOnly = qaVideoOnly;
      const preferredVideoConstraints: MediaTrackConstraints = {
        facingMode: { ideal: "environment" },
      };
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: preferredVideoConstraints,
            audio: effectiveVideoOnly
              ? false
              : {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                  channelCount: 1,
                },
          });
        } catch (mediaErr: any) {
          const shouldRetryVideoOnly =
            isMobileDevice &&
            !effectiveVideoOnly &&
            ["NotReadableError", "AbortError", "OverconstrainedError"].includes(
              mediaErr?.name || "",
            );
          if (shouldRetryVideoOnly) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: preferredVideoConstraints,
                audio: false,
              });
              effectiveVideoOnly = true;
            } catch {
            }
          }
          if (!stream) {
            const mediaName = typeof mediaErr?.name === "string" ? mediaErr.name : "";
            if (mediaName === "NotAllowedError" || mediaName === "SecurityError") {
              setErrorMessage(
                isEn
                  ? "Camera permission is blocked. In Chrome address bar, open Site settings and allow Camera, then retry."
                  : "摄像头权限被拦截。请在 Chrome 地址栏进入“网站设置”，将“摄像头”改为允许后重试。",
              );
            } else if (mediaName === "NotReadableError") {
              setErrorMessage(
                isEn
                  ? "Camera is currently in use by another app. Close other camera apps and retry."
                  : "摄像头正被其他应用占用。请关闭其他占用摄像头的应用后重试。",
              );
            } else {
              setErrorMessage(
                isEn
                  ? "Failed to access camera. Check browser permissions and retry."
                  : "访问摄像头失败，请检查浏览器权限后重试。",
              );
            }
            cleanupConnection();
            return;
          }
        }
      } else {
        effectiveVideoOnly = stream.getAudioTracks().length === 0;
      }
      const hasLiveAudioTrack = stream.getAudioTracks().some((track) => track.readyState === "live");
      if (!qaVideoOnly && !hasLiveAudioTrack) {
        setErrorMessage(
          isEn
            ? "Microphone is unavailable. Voice dialogue requires microphone permission and an active input device."
            : "麦克风不可用。语音对话必须开启麦克风权限并保证输入设备可用。",
        );
        cleanupConnection();
        return;
      }
      const audioCaptureEnabled = !effectiveVideoOnly;

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      if (isStaleSession()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const enableEnhancements = true;
      const videoFps = isMobileDevice ? 1 : 2;
      const urlParams = new URLSearchParams(window.location.search);
      const liveModelOverride = urlParams.get("liveModel")?.trim() || "";
      const liveLiteConfig = urlParams.get("liveLiteConfig") === "1";
      const defaultVisionLiveModel = "gemini-live-2.5-flash-preview";
      const primaryLiveModel =
        (process.env.GEMINI_LIVE_MODEL || defaultVisionLiveModel).trim();
      const fallbackLiveModel =
        (process.env.GEMINI_LIVE_MODEL_FALLBACK || defaultVisionLiveModel).trim();
      const forcedLiveModel = forcedLiveModelRef.current.trim();
      const selectedModel =
        liveModelOverride
          ? liveModelOverride
          : forcedLiveModel
            ? forcedLiveModel
          : mobileFallbackEnabledRef.current && fallbackLiveModel
            ? fallbackLiveModel
            : primaryLiveModel;
      const isNativeAudioModel = /native-audio/i.test(selectedModel);
      const disableLiveVideoStream =
        urlParams.get("liveNoVideo") === "1" || isNativeAudioModel;
      setActiveLiveModel(selectedModel);
      try {
        const healthRes = await fetch("/api/health");
        if (!healthRes.ok) {
          backendHealthyRef.current = false;
          setBackendDegraded(true);
        } else {
          const health = await healthRes.json();
          const runtime = health?.runtime || {};
          const yamnetLoaded = Boolean(runtime?.yamnet_loaded);
          const intentHeadLoaded = Boolean(runtime?.intent_head_loaded);
          backendHealthyRef.current = yamnetLoaded && intentHeadLoaded;
          setBackendDegraded(!backendHealthyRef.current);
        }
      } catch {
        backendHealthyRef.current = false;
        setBackendDegraded(true);
      }
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: "v1alpha" });
      if (!audioStreamerRef.current) {
        audioStreamerRef.current = new AudioStreamer();
      }
      await audioStreamerRef.current.resume();
      if (isStaleSession()) {
        audioStreamerRef.current?.stop();
        audioStreamerRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const modeInstruction =
        mode === "narration"
          ? isEn
            ? 'Current mode is "Narration": keep speaking in first-person cat voice based on new observations while allowing user interruption.'
            : "当前模式为“碎碎念模式”：在保持可被用户打断的前提下，允许基于新观测持续输出完整句子的猫咪第一人称解读。"
          : isEn
            ? 'Current mode is "Q&A": do not proactively narrate; respond only to user questions or explicit triggers, grounded in behavior and intent evidence.'
            : "当前模式为“一问一答模式”：默认不主动连续播报，仅在用户发问或明确触发时回答，但回答必须结合动作与意图证据。";
      const roleLabel =
        userProfile.role === "dad" ? (isEn ? "Dad" : "爸爸") : userProfile.role === "mom" ? (isEn ? "Mom" : "妈妈") : isEn ? "Human" : "人类";
      const safeCatName = userProfile.catName.trim().replace(/[\r\n]+/g, " ").slice(0, 24);
      const profileInstruction = safeCatName
        ? isEn
          ? `[Identity Profile]
The human speaking with you is "${roleLabel}". Prioritize addressing them as "${roleLabel}".
Your name is "${safeCatName}". If you hear or see "${safeCatName}", recognize it as your own name and respond promptly.`
          : `【身份档案】
正在与你对话的人类身份是“${roleLabel}”，你在对话中应优先称呼对方为“${roleLabel}”。
你的名字是“${safeCatName}”。当听到或看到“${safeCatName}”时，必须判断这是在呼唤你自己并及时回应。`
        : isEn
          ? `[Identity Profile]
The human speaking with you is "${roleLabel}". Prioritize addressing them as "${roleLabel}".`
          : `【身份档案】
正在与你对话的人类身份是“${roleLabel}”，你在对话中应优先称呼对方为“${roleLabel}”。`;
      const runtimeInstruction = isEn
        ? `[Runtime Hard Constraints]
You must always act as a "cat behavior translator" and never degrade into a generic chat assistant.
Base each response on visual/audio evidence from the last 10 seconds. If evidence is insufficient, explicitly say "insufficient evidence".
When receiving [System Observation], treat it as high-priority fact for follow-up answers.
${modeInstruction}`
        : `【运行时硬约束】
你必须始终充当“猫语（动作）翻译器”，不能退化为通用聊天助手。
每次回答优先引用最近10秒内的视觉或音频线索；若线索不足，必须明确说“当前证据不足”，不要凭空编造。
当收到 [系统观测] 提示时，将其视为高优先级事实并用于后续追问回答。
${modeInstruction}`;

      const liveConfig: any = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: `${persona.systemInstruction}\n\n${runtimeInstruction}\n\n${profileInstruction}`,
      };
      if (!isNativeAudioModel) {
        liveConfig.outputAudioTranscription = {};
        liveConfig.inputAudioTranscription = {};
        liveConfig.speechConfig = {
          languageCode: getSpeechLanguageCode(language),
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: persona.voiceName },
          },
        };
      }
      if (!liveLiteConfig && !isNativeAudioModel) {
        if (sessionHandleRef.current) {
          liveConfig.sessionResumption = { handle: sessionHandleRef.current };
        }
        liveConfig.contextWindowCompression = { slidingWindow: {} };
      }
      if (!isMobileDevice && !liveLiteConfig && !isNativeAudioModel) {
        liveConfig.realtimeInputConfig = {
          activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          automaticActivityDetection: {
            disabled: false,
            silenceDurationMs: 280,
          },
        };
        if (enableEnhancements && !isNativeAudioModel) {
          liveConfig.tools = [{ functionDeclarations: [playCatSoundDeclaration] }];
        }
      }

      console.log("Connecting to Gemini Live...");
      const sessionPromise = ai.live.connect({
        model: selectedModel,
        config: liveConfig,
        callbacks: {
          onopen: () => {
            if (isStaleSession()) {
              return;
            }
            setIsConnected(true);
            isConnectedRef.current = true;
            setIsConnecting(false);
            isConnectingRef.current = false;
            reconnectAttemptsRef.current = 0;
            recentSignalsRef.current = [];
            lastNarratedSignalTsRef.current = 0;
            lastFrameSizeRef.current = 0;
            lastVisionSignalTsRef.current = 0;
            pendingNarrationRef.current = false;
            observationDirtyRef.current = false;
            lastObservationTextRef.current = "";
            lastObservationAtRef.current = 0;
            lastAutoNarrationAtRef.current = 0;
            lastCaptureAtRef.current = 0;
            latestNarrationRef.current = "";
            narrationPendingStartedAtRef.current = 0;
            lastOutputAudioAtRef.current = 0;
            lastModelTextAtRef.current = 0;
            lastAudioRecoveryAttemptAtRef.current = 0;
            captureQueueRef.current = [];
            captureBusyRef.current = false;
            manualCaptureInFlightRef.current = 0;
            setLogs([]);
            recentOutputAudioChunkRef.current.clear();
            processedFunctionCallIdsRef.current.clear();
            if (!audioCaptureEnabled) {
              addDetectionLog(
                isEn
                  ? isMobileDevice
                    ? "Mobile safe mode: camera-only permission is enabled."
                    : "Microphone is unavailable. Running in camera-only mode."
                  : isMobileDevice
                    ? "移动端安全模式：已启用仅摄像头权限"
                    : "麦克风暂不可用，当前以仅摄像头模式运行",
              );
            }
            silenceCompetingAudio();
            startMediaPlayGuard();
            void audioStreamerRef.current?.resume();
            highlightBufferRef.current?.stop();
            highlightBufferRef.current = new VideoHighlightBuffer(stream, {
              maxBufferMs: 12000,
              chunkMs: 450,
            });
            highlightBufferRef.current.start();
            if (captureWorkerRef.current) {
              window.clearInterval(captureWorkerRef.current);
            }
            captureWorkerRef.current = window.setInterval(() => {
              void processCaptureQueue();
            }, 380);
            void trackEvent("session_started", {
              persona_id: persona.id,
              mode,
              model: selectedModel,
            });

            // Audio Buffer for YAMNet Classification
            let audioBuffer: string[] = [];
            const BUFFER_SIZE = 10; // Send to backend every ~1 second of frames
            const safeSendMedia = (mimeType: string, data: string) => {
              const content = data.trim();
              if (content.length < 24) return;
              sessionPromise.then((session) => {
                if (isStaleSession()) {
                  return;
                }
                if (mimeType.startsWith("audio/")) {
                  session.sendRealtimeInput({
                    audio: { mimeType, data: content },
                  });
                  return;
                }
                session.sendRealtimeInput({
                  media: { mimeType, data: content },
                });
              });
            };
            const mergeBase64Chunks = (chunks: string[]) => {
              let mergedBinary = "";
              for (const chunk of chunks) {
                const content = chunk.trim();
                if (!content) continue;
                mergedBinary += atob(content);
              }
              return mergedBinary ? btoa(mergedBinary) : "";
            };
            const emitSystemObservation = (signalText: string) => {
              const now = Date.now();
              const duplicateText = signalText === lastObservationTextRef.current;
              const tooClose = now - lastObservationAtRef.current < 1300;
              if (duplicateText && tooClose) {
                return;
              }
              lastObservationTextRef.current = signalText;
              lastObservationAtRef.current = now;
              recentSignalsRef.current = [
                ...recentSignalsRef.current.slice(-7),
                { ts: now, text: signalText },
              ];
              persistInteractionText("system_observation", signalText);
            };

            if (autoNarrationTimerRef.current) {
              window.clearInterval(autoNarrationTimerRef.current);
            }
            autoNarrationTimerRef.current = window.setInterval(() => {
              if (!pendingNarrationRef.current) {
                return;
              }
              if (Date.now() - narrationPendingStartedAtRef.current < 7000) {
                return;
              }
              pendingNarrationRef.current = false;
              narrationPendingStartedAtRef.current = 0;
            }, 850);
            if (audioHealthTimerRef.current) {
              window.clearInterval(audioHealthTimerRef.current);
            }
            audioHealthTimerRef.current = window.setInterval(() => {
              const now = Date.now();
              if (!isConnectedRef.current) {
                return;
              }
              if (!lastModelTextAtRef.current) {
                return;
              }
              if (now - lastModelTextAtRef.current < 1200) {
                return;
              }
              if (now - lastOutputAudioAtRef.current <= 7000) {
                return;
              }
              if (now - lastAudioRecoveryAttemptAtRef.current < 6000) {
                return;
              }
              lastAudioRecoveryAttemptAtRef.current = now;
              void audioStreamerRef.current?.resume();
              addDetectionLog(isEn ? "Audio output stalled, auto recovery triggered" : "音频输出异常，已触发自动恢复");
              void trackEvent("audio_output_recovery_triggered", {
                model: selectedModel,
                mode,
              });
            }, 2500);

            if (audioCaptureEnabled) {
              audioRecorderRef.current = new AudioRecorder(stream, (base64) => {
              const bufferedMs = audioStreamerRef.current?.getBufferedMs() || 0;
              if (Date.now() < outputAudioActiveUntilRef.current || bufferedMs > 120) {
                return;
              }
              safeSendMedia("audio/pcm;rate=16000", base64);

              if (!enableEnhancements) {
                return;
              }

              audioBuffer.push(base64);
              if (audioBuffer.length >= BUFFER_SIZE) {
                const chunkToSend = mergeBase64Chunks(audioBuffer);
                audioBuffer = [];
                if (!chunkToSend) {
                  return;
                }
                fetch(`/api/classify/active`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ audio_base64: chunkToSend })
                })
                  .then(res => res.json())
                  .then(data => {
                    if (data.detected && shouldCaptureAudioEvent(data)) {
                      console.log("Cat Sound Detected by YAMNet:", data);
                      const intentInfo =
                        data.intent_label && data.intent_label !== "unknown" && data.intent_label !== "neutral_other"
                          ? isEn
                            ? `, intent: ${data.intent_label}, intent confidence: ${((data.intent_confidence ?? 0) * 100).toFixed(1)}%`
                            : `, 意图: ${data.intent_label}, 意图置信度: ${((data.intent_confidence ?? 0) * 100).toFixed(1)}%`
                          : "";
                      const signalText = isEn
                        ? `Cat sound:${data.top_class}, confidence:${(data.confidence * 100).toFixed(1)}%${intentInfo}`
                        : `猫声:${data.top_class}, 置信度:${(data.confidence * 100).toFixed(1)}%${intentInfo}`;
                      emitSystemObservation(signalText);
                      relayObservationToLive(signalText);
                      captureHighlight("audio", signalText);
                      addDetectionLog(getAudioUserFriendlyLabel(data.top_class, data.intent_label || ""));
                    }
                  })
                  .catch(err => {
                    backendHealthyRef.current = false;
                    setBackendDegraded(true);
                    // Suppress fetch errors so they don't tear down the whole Gemini session
                    console.warn("YAMNet Backend fetch failed (Make sure backend is running on 0.0.0.0):", err);
                  });
              }
              });
            } else {
              audioRecorderRef.current = null;
            }

            if (videoRef.current) {
              videoRecorderRef.current = new VideoRecorder(
                videoRef.current,
                (base64) => {
                  const sizeNow = base64.length;
                  const prev = lastFrameSizeRef.current;
                  lastFrameSizeRef.current = sizeNow;
                  if (prev > 0) {
                    const motionRatio = Math.abs(sizeNow - prev) / prev;
                    const semanticLabel = getVisionSemanticLabel(motionRatio);
                    if (semanticLabel && Date.now() - lastVisionSignalTsRef.current > 4800) {
                      lastVisionSignalTsRef.current = Date.now();
                      const signalText = isEn
                        ? `Vision event:${semanticLabel}, delta:${(motionRatio * 100).toFixed(1)}%`
                        : `视觉事件:${semanticLabel}，变化幅度:${(motionRatio * 100).toFixed(1)}%`;
                      emitSystemObservation(signalText);
                      addDetectionLog(semanticLabel);
                    }
                  }
                  if (!disableLiveVideoStream) {
                    safeSendMedia("image/jpeg", base64);
                  }
                },
              );
              videoRecorderRef.current.start(videoFps);
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (isStaleSession()) {
              return;
            }
            const resumeUpdate = (message as any).sessionResumptionUpdate;
            if (resumeUpdate?.resumable && resumeUpdate?.newHandle) {
              sessionHandleRef.current = resumeUpdate.newHandle;
            }

            const parts = message.serverContent?.modelTurn?.parts;
            const outputTranscriptionText = (message as any)?.serverContent?.outputTranscription?.text;
            if (typeof outputTranscriptionText === "string" && outputTranscriptionText.trim()) {
              persistInteractionText("output_transcript", outputTranscriptionText);
            }
            const inputTranscriptionText = (message as any)?.serverContent?.inputTranscription?.text;
            if (typeof inputTranscriptionText === "string" && inputTranscriptionText.trim()) {
              persistInteractionText("input_transcript", inputTranscriptionText);
            }
            let collectedText = "";
            if (parts) {
              for (const part of parts) {
                const base64Audio = part.inlineData?.data;
                if (base64Audio && audioStreamerRef.current) {
                  const now = Date.now();
                  const chunkKey = `${base64Audio.length}:${base64Audio.slice(0, 20)}:${base64Audio.slice(-20)}`;
                  const lastSeenAt = recentOutputAudioChunkRef.current.get(chunkKey) || 0;
                  if (lastSeenAt > 0 && now - lastSeenAt < 8000) {
                    continue;
                  }
                  recentOutputAudioChunkRef.current.set(chunkKey, now);
                  if (recentOutputAudioChunkRef.current.size > 240) {
                    const firstKey = recentOutputAudioChunkRef.current.keys().next().value;
                    if (firstKey) {
                      recentOutputAudioChunkRef.current.delete(firstKey);
                    }
                  }
                  silenceCompetingAudio();
                  void audioStreamerRef.current.resume();
                  const bufferedAfter = audioStreamerRef.current.addPCM16(base64Audio);
                  outputAudioActiveUntilRef.current = Date.now() + Math.max(320, bufferedAfter + 150);
                  lastOutputAudioAtRef.current = Date.now();
                }
                if (part.text) {
                  collectedText += part.text;
                }
              }
            }

            if (message.serverContent?.interrupted) {
              if (audioStreamerRef.current) {
                audioStreamerRef.current.interrupt();
              }
              recentOutputAudioChunkRef.current.clear();
              processedFunctionCallIdsRef.current.clear();
              outputAudioActiveUntilRef.current = Date.now() + 180;
              pendingNarrationRef.current = false;
              narrationPendingStartedAtRef.current = 0;
            }

            if (collectedText) {
              lastModelTextAtRef.current = Date.now();
              setTranscript((prev) => (prev + collectedText).slice(-80));
              
              // Add to recognition buffer for action detection
              recognitionBufferRef.current += collectedText;
              // Limit buffer size
              if (recognitionBufferRef.current.length > 200) {
                recognitionBufferRef.current = recognitionBufferRef.current.slice(-200);
              }
              
              // Check if the text mentions any specific cat action
              const matchedAction = isCatAction(recognitionBufferRef.current);
              if (matchedAction) {
                 captureHighlight("vision", isEn ? `Detected action: ${matchedAction}` : `识别到动作: ${matchedAction}`);
                 // Clear buffer to avoid re-triggering on the same phrase immediately
                 recognitionBufferRef.current = ""; 
              }
            }

            if (parts) {
              for (const part of parts) {
                if (part.functionCall) {
                  const name = part.functionCall.name;
                  const args = part.functionCall.args as any;
                  const id = part.functionCall.id;
                  if (id && processedFunctionCallIdsRef.current.has(id)) {
                    continue;
                  }
                  if (id) {
                    processedFunctionCallIdsRef.current.add(id);
                    if (processedFunctionCallIdsRef.current.size > 300) {
                      const firstId = processedFunctionCallIdsRef.current.values().next().value;
                      if (firstId) {
                        processedFunctionCallIdsRef.current.delete(firstId);
                      }
                    }
                  }
                  if (enableEnhancements && name === 'playCatSound' && id) {
                    audioStreamerRef.current?.interrupt();
                    outputAudioActiveUntilRef.current = Date.now() + 1400;
                    pendingNarrationRef.current = false;
                    narrationPendingStartedAtRef.current = 0;
                    playCatAudio(args.soundType);
                    sessionPromise.then(session => {
                      if (isStaleSession()) {
                        return;
                      }
                      session.sendToolResponse({
                        functionResponses: [{
                          name: 'playCatSound',
                          id: id,
                          response: { result: `Played ${args.soundType} cat sound successfully.` }
                        }]
                      });
                    });
                  }
                }
              }
            }

            if (message.serverContent?.turnComplete) {
              recentOutputAudioChunkRef.current.clear();
              outputAudioActiveUntilRef.current =
                Date.now() + Math.max(120, (audioStreamerRef.current?.getBufferedMs() || 0) + 60);
              pendingNarrationRef.current = false;
              narrationPendingStartedAtRef.current = 0;
              setTranscript((prev) => {
                if (prev.trim()) {
                  const cleaned = prev.replace(/\[[^\]]+\]\s*/g, "").trim();
                  latestNarrationRef.current = cleaned;
                  persistInteractionText("model_output", cleaned);
                }
                return "";
              });
            }
          },
          onclose: (e) => {
            if (isStaleSession()) {
              return;
            }
            console.log("Live API Closed:", e);
            if (manualDisconnectRef.current) {
              manualDisconnectRef.current = false;
              cleanupConnection();
              return;
            }
            const code = typeof e?.code === "number" ? e.code : "unknown";
            const reason =
              typeof e?.reason === "string" && e.reason.trim()
                ? e.reason.trim()
                : isEn ? "Server closed the connection." : "服务端主动关闭连接";
            const modelNotFound =
              code === 1008 &&
              /not found|not supported for bidiGenerateContent/i.test(reason);
            if (modelNotFound && !mobileFallbackEnabledRef.current && fallbackLiveModel) {
              mobileFallbackEnabledRef.current = true;
              setActiveLiveModel(fallbackLiveModel);
              setErrorMessage(isEn ? "Primary Live model is unavailable. Switching to fallback model..." : "主 Live 模型不可用，正在切换到备用 Live 模型...");
              cleanupConnection({ preserveMediaStream: true });
              setTimeout(() => {
                void connect();
              }, 350);
              return;
            }
            if (code === 1006) {
              if (isMobileDevice && !mobileFallbackEnabledRef.current) {
                mobileFallbackEnabledRef.current = true;
                cleanupConnection({ preserveMediaStream: true });
                setTimeout(() => {
                  void connect();
                }, 350);
                return;
              }
              const canResume = reconnectAttemptsRef.current < 2 && !!sessionHandleRef.current;
              if (canResume) {
                reconnectAttemptsRef.current += 1;
                setErrorMessage(isEn ? "Connection fluctuation detected. Restoring session context..." : "连接波动，正在恢复会话上下文...");
                cleanupConnection({ preserveMediaStream: true });
                setTimeout(() => {
                  void connect();
                }, 450 * reconnectAttemptsRef.current);
                return;
              }
              setErrorMessage(isEn ? "Disconnected (1006): realtime channel interrupted. Stay on the same Wi-Fi and retry." : "连接已断开（1006）：实时通道被中断，请保持同一 Wi‑Fi 并重试");
            } else if (code === 1007) {
              const visionFallbackModel =
                fallbackLiveModel && fallbackLiveModel !== selectedModel
                  ? fallbackLiveModel
                  : defaultVisionLiveModel;
              const nativeAudioMismatch =
                /native-audio/i.test(selectedModel) &&
                !mobileFallbackEnabledRef.current &&
                !!visionFallbackModel &&
                visionFallbackModel !== selectedModel;
              if (nativeAudioMismatch) {
                forcedLiveModelRef.current = visionFallbackModel;
                setActiveLiveModel(visionFallbackModel);
                setErrorMessage(isEn ? "Current model is incompatible with video stream. Switching to multimodal Live model..." : "当前模型与视频流不兼容，正在切换到多模态 Live 模型...");
                cleanupConnection({ preserveMediaStream: true });
                setTimeout(() => {
                  void connect();
                }, 350);
                return;
              }
              const canRetry = reconnectAttemptsRef.current < 2;
              if (canRetry) {
                reconnectAttemptsRef.current += 1;
                sessionHandleRef.current = null;
                setErrorMessage(isEn ? "Connection parameter error (1007). Recovering automatically..." : "连接参数异常（1007），正在自动恢复...");
                cleanupConnection({ preserveMediaStream: true });
                setTimeout(() => {
                  void connect();
                }, 450 * reconnectAttemptsRef.current);
                return;
              }
              setErrorMessage(isEn ? "Disconnected (1007): invalid request parameters. Please retry." : "连接已断开（1007）：请求参数异常，请点击重试");
            } else if (modelNotFound) {
              setErrorMessage(
                isEn
                  ? `Current Live model is unavailable (${selectedModel}). Configure GEMINI_LIVE_MODEL in .env.local with a model available to your account.`
                  : `当前 Live 模型不可用（${selectedModel}）。请在 .env.local 配置 GEMINI_LIVE_MODEL 为你账号可用的 Live 模型`,
              );
            } else {
              setErrorMessage(isEn ? `Disconnected (${code}): ${reason}` : `连接已断开（${code}）：${reason}`);
            }
            cleanupConnection();
          },
          onerror: (error) => {
            if (isStaleSession()) {
              return;
            }
            console.error("Live API Error:", error);
            const detail =
              typeof error?.message === "string" && error.message.trim()
                ? error.message
                : isEn ? "Unknown error" : "未知错误";
            setErrorMessage(isEn ? `Gemini Live connection error: ${detail}` : `Gemini Live 连接异常：${detail}`);
            cleanupConnection();
          },
        },
      });

      const session = await sessionPromise;
      if (isStaleSession()) {
        session.close();
        return;
      }
      sessionRef.current = session;
    } catch (err: any) {
      if (sessionEpoch !== sessionEpochRef.current) {
        return;
      }
      console.error("Failed to connect:", err);
      const detail =
        typeof err?.message === "string" && err.message.trim()
          ? err.message
          : isEn ? "Unknown error" : "未知错误";
      setErrorMessage(isEn ? `Initialization failed: ${detail}` : `初始化连接失败：${detail}`);
      cleanupConnection();
    }
  }, [persona, mode, videoRef, userProfile, language, cleanupConnection, hasForeignActiveLock, claimSessionLock, refreshSessionLock, persistInteractionText, relayObservationToLive, addDetectionLog, isEn, silenceCompetingAudio, startMediaPlayGuard]);

  const triggerManualCapture = useCallback(() => {
    void captureHighlight("manual", isEn ? "Manual capture" : "手动抓拍");
  }, [captureHighlight, isEn]);

  const clearError = useCallback(() => {
    setErrorMessage("");
  }, []);

  return {
    isConnected,
    isConnecting,
    connect,
    disconnect,
    transcript,
    logs,
    highlightClip,
    highlightHistory,
    autoCaptureEnabled,
    backendDegraded,
    activeLiveModel,
    toggleAutoCapture,
    triggerManualCapture,
    updateHighlightCaption,
    clearHighlight,
    errorMessage,
    clearError,
  };
}
