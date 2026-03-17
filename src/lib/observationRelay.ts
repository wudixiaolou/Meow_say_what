import { AppLanguage } from "../types";

export function shouldRelayObservation(params: {
  nowMs: number;
  lastRelayAtMs: number;
  minGapMs: number;
  signalText: string;
  lastSignalText: string;
}) {
  const { nowMs, lastRelayAtMs, minGapMs, signalText, lastSignalText } = params;
  if (!signalText.trim()) {
    return false;
  }
  if (nowMs - lastRelayAtMs < minGapMs) {
    return false;
  }
  return signalText !== lastSignalText;
}

export function buildObservationPrompt(signalText: string, mode: "narration" | "qa", language: AppLanguage = "zh") {
  const normalized = signalText.trim();
  if (language === "en") {
    if (mode === "narration") {
      return `[System Observation] ${normalized}\nReply immediately in first-person cat voice, one natural English line, 8 to 16 words.`;
    }
    return `[System Observation] ${normalized}\nThis is an explicit trigger. Reply in first-person cat voice with one short English line under 14 words.`;
  }
  if (mode === "narration") {
    return `【系统观测】${normalized}\n请立刻用猫咪第一人称输出一句自然中文翻译，12到24字。`;
  }
  return `【系统观测】${normalized}\n这是明确触发，请用猫咪第一人称给出一句简短翻译，不超过20字。`;
}
