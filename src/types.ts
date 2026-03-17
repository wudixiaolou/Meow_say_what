export type PersonaId = "tsundere" | "clingy" | "philosopher" | "sarcastic";
export type InteractionMode = "narration" | "qa";
export type AppLanguage = "zh" | "en";

export interface Persona {
  id: PersonaId;
  name: string;
  avatar: string;
  tagline: string;
  systemInstruction: string;
  voiceName: "Puck" | "Charon" | "Kore" | "Fenrir" | "Zephyr";
}

export interface SessionLog {
  timestamp: Date;
  text: string;
}

export interface HighlightClip {
  id: string;
  createdAt: Date;
  triggerType: "audio" | "vision" | "manual";
  triggerText: string;
  clipBlob: Blob;
  clipUrl: string;
  caption: string;
}

export type InteractionTextSource =
  | "model_output"
  | "output_transcript"
  | "input_transcript"
  | "user_input"
  | "system_observation";

export interface InteractionTextRecord {
  id: string;
  sessionId: string;
  occurredAtMs: number;
  text: string;
  source: InteractionTextSource;
  consumedByDiaryDate: string | null;
}

export interface DiaryReadAloudSegment {
  type: "text" | "video";
  text?: string;
  videoId?: string;
}

export interface DiaryEntry {
  id: string;
  date: string;
  language?: AppLanguage;
  createdAtMs: number;
  title: string;
  content: string;
  summary: string;
  mood: "happy" | "calm" | "curious" | "playful" | "uneasy" | "tired" | "mixed";
  sourceTextIds: string[];
  linkedHighlightIds: string[];
  readAloudScript: DiaryReadAloudSegment[];
}

export interface DiaryScheduleSettings {
  enabled: boolean;
  timeOfDay: string;
  timezone: string;
  lastGeneratedDate: string;
}
