import { GoogleGenAI } from "@google/genai";
import { DiaryReadAloudSegment, HighlightClip, InteractionTextRecord } from "../types";

interface GenerateDiaryResult {
  title: string;
  content: string;
  summary: string;
  mood: "happy" | "calm" | "curious" | "playful" | "uneasy" | "tired" | "mixed";
  readAloudScript: DiaryReadAloudSegment[];
}

type SupportedLanguage = "zh" | "en";

function normalizeForMatch(text: string) {
  return text.toLowerCase().replace(/[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function extractMatchTokens(text: string) {
  const normalized = normalizeForMatch(text);
  const latinTokens = normalized
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  const cjkRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  return Array.from(new Set([...latinTokens, ...cjkRuns])).slice(0, 10);
}

function computeTimeScore(deltaMs: number) {
  if (deltaMs <= 15_000) return 4;
  if (deltaMs <= 45_000) return 3;
  if (deltaMs <= 120_000) return 2;
  if (deltaMs <= 300_000) return 1;
  return 0;
}

export function matchHighlightsForDiary(
  materials: InteractionTextRecord[],
  highlightHistory: HighlightClip[],
  maxCount: number = 3,
) {
  if (maxCount <= 0 || materials.length === 0 || highlightHistory.length === 0) {
    return [];
  }
  const materialRows = materials.map((item) => ({
    occurredAtMs: item.occurredAtMs,
    normalizedText: normalizeForMatch(item.text),
  }));
  return [...highlightHistory]
    .map((clip) => {
      const clipMs = clip.createdAt.getTime();
      const nearestDelta = materialRows.reduce((minDelta, row) => {
        const delta = Math.abs(row.occurredAtMs - clipMs);
        return delta < minDelta ? delta : minDelta;
      }, Number.POSITIVE_INFINITY);
      const timeScore = computeTimeScore(nearestDelta);
      const clipTokens = extractMatchTokens(`${clip.caption} ${clip.triggerText}`);
      const textScore = clipTokens.reduce((score, token) => {
        const matched = materialRows.some((row) => row.normalizedText.includes(token));
        return matched ? score + 1 : score;
      }, 0);
      const totalScore = timeScore * 3 + Math.min(textScore, 3) * 2;
      return {
        id: clip.id,
        totalScore,
        createdAtMs: clipMs,
      };
    })
    .filter((item) => item.totalScore > 0)
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      return b.createdAtMs - a.createdAtMs;
    })
    .slice(0, maxCount)
    .map((item) => item.id);
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildFallback(
  catName: string,
  materials: InteractionTextRecord[],
  linkedHighlightIds: string[],
  language: SupportedLanguage,
): GenerateDiaryResult {
  const isEn = language === "en";
  const fallbackName = isEn ? (catName.trim() || "Kitty") : catName.trim() || "本喵";
  const top = isEn ? "" : materials.slice(-5).map((item) => item.text).join("；");
  const defaultContent = isEn
    ? "Today there were fewer interaction materials. We stayed close quietly and enjoyed each other's company."
    : "今天的互动素材偏少，我们安静地待在一起，感受彼此的陪伴。";
  const content = top || defaultContent;
  const intro = isEn ? `I am ${fallbackName}. ${content}` : `我是${fallbackName}。${content}`;
  const script: DiaryReadAloudSegment[] = [{ type: "text", text: intro }];
  linkedHighlightIds.forEach((videoId, idx) => {
    if (idx === 0) {
      script.push({ type: "video", videoId });
      script.push({
        type: "text",
        text: isEn
          ? "That clip is the moment I wanted to share with you the most today."
          : "刚刚那一段，就是我今天最想和你分享的瞬间。",
      });
    }
  });
  return {
    title: isEn ? `${fallbackName}'s Interaction Diary` : `${fallbackName}的互动日记`,
    content: intro,
    summary: isEn
      ? "Today we shared some gentle little moments. I will keep remembering you."
      : "今天我们有一些温柔的小互动，我会继续记住你。",
    mood: "mixed",
    readAloudScript: script,
  };
}

function pickFinalText(primary: unknown, fallback: string, language: SupportedLanguage, maxLength: number) {
  const next = String(primary || fallback).slice(0, maxLength).trim();
  if (!next) {
    return fallback.slice(0, maxLength);
  }
  const cjkCount = (next.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinCount = (next.match(/[A-Za-z]/g) || []).length;
  if (language === "en") {
    if (cjkCount > 8 && cjkCount > latinCount) {
      return fallback.slice(0, maxLength);
    }
    return next;
  }
  if (latinCount > 32 && latinCount > cjkCount * 2) {
    return fallback.slice(0, maxLength);
  }
  return next;
}

function sanitizeEnglishText(text: string) {
  return text.replace(/[\u4e00-\u9fff]+/g, " ").replace(/\s+/g, " ").trim();
}

function measureDiaryLength(text: string, language: SupportedLanguage) {
  if (language === "en") {
    return (text.trim().match(/\b[^\s]+\b/g) || []).length;
  }
  return text.replace(/\s+/g, "").length;
}

function ensureMinimumDiaryLength(
  content: string,
  fallback: string,
  materials: InteractionTextRecord[],
  language: SupportedLanguage,
  minLength: number,
) {
  const isEn = language === "en";
  const mergeSeparator = isEn ? " " : "";
  const materialText = materials
    .slice(-8)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join(isEn ? " " : "。");
  let next = [content.trim(), materialText, fallback.trim()].filter(Boolean).join(mergeSeparator).trim();
  const padding = isEn
    ? "I kept replaying these little moments in my mind, and every detail made me feel closer to you."
    : "我把这些细节都认真记在心里，反复回想我们今天的每一次靠近、对视和回应，越想越觉得温暖踏实。";
  while (measureDiaryLength(next, language) < minLength) {
    next = `${next}${mergeSeparator}${padding}`.trim();
  }
  return next;
}

export async function generateDiaryWithModel(params: {
  date: string;
  catName: string;
  personaName: string;
  materials: InteractionTextRecord[];
  linkedHighlightIds: string[];
  language?: SupportedLanguage;
}) {
  const language: SupportedLanguage = params.language === "en" ? "en" : "zh";
  const fallback = buildFallback(params.catName, params.materials, params.linkedHighlightIds, language);
  // Safe check for API key in browser environment
  const apiKey = import.meta.env?.VITE_GEMINI_API_KEY || "";
  
  if (!apiKey || params.materials.length === 0) {
    return fallback;
  }
  const ai = new GoogleGenAI({ apiKey });
  const isEn = language === "en";
  const materialLines = params.materials
    .slice(-120)
    .map(
      (item) =>
        `- [${new Date(item.occurredAtMs).toLocaleTimeString(isEn ? "en-US" : "zh-CN", { hour12: false })}] (${item.source}) ${item.text}`,
    )
    .join("\n");

  const langInstruction = isEn
    ? "All textual fields must be in natural English only."
    : "所有文本字段必须使用自然、地道的简体中文。";
  const formatInstruction = isEn
    ? "Do not mix Chinese into output text except unavoidable proper nouns from source materials."
    : "除素材中的专有名词外，不要混入英文句子或英文短语。";
  const diaryIntentInstruction = isEn
    ? "Write a daily cat diary that summarizes interesting interactions from live text materials and combines highlight clips as memorable moments."
    : "角色：喵星驻地球观察员。任务：以猫咪第一人称（本喵/朕/偶）写日记，接收并加工对话信息。重点记录：1. 食物（口味/口感）；2. 叫声（音调/含义）；3. 开心和不开心（原因/表现）。";
  const personaInstruction = isEn
    ? "The cat voice must strictly match the selected persona style."
    : "风格：严格对应所选人格。使用“猫眼滤镜”重构事件（如：铲屎官迟到->愚蠢的两脚兽试图饿死本喵）。可使用口头禅（愚蠢的人类/朕乏了/妙啊）和标签（#今日罐头指数 #本喵心情记录）。";
  const structureInstruction = isEn
    ? "Narrative should include at least two concrete events from materials (if available) and form a coherent beginning-middle-ending timeline. Make the diary detailed and descriptive to fill the page."
    : "结构：正文内容必须丰富充实，字数严格不少于100字！若素材不足，请吐槽铲屎官太懒。加入感官描写（肉香、触感）。summary控制在1-2句。";
  const highlightGuidance =
    params.linkedHighlightIds.length > 0
      ? isEn
        ? `Matched highlight IDs for today: ${JSON.stringify(params.linkedHighlightIds)}. Reflect these moments naturally in narrative and readAloudScript.`
        : `今日已匹配高光片段ID：${JSON.stringify(params.linkedHighlightIds)}。正文与朗读脚本需自然呼应这些瞬间。`
      : isEn
        ? "No highlight clip is matched today. Focus on live interaction text materials only."
        : "今日未匹配到高光片段，正文聚焦Live互动文本即可。";

  const prompt = `You are an interactive diary generator. Please generate strict JSON based on the following materials:
{
  "title": "string",
  "content": "string",
  "summary": "string",
  "mood": "happy|calm|curious|playful|uneasy|tired|mixed",
  "readAloudScript": [{"type":"text","text":"string"} or {"type":"video","videoId":"string"}]
}

Requirements:
1) Use First Person perspective (as a cat), style matches persona "${params.personaName}"
2) Do not fabricate facts not present in materials
3) If video IDs are provided, insert at most ${Math.min(params.linkedHighlightIds.length, 3)} video nodes in readAloudScript, videoId must be from ${JSON.stringify(params.linkedHighlightIds)}
4) content must be at least 100 ${isEn ? "words" : "Chinese characters"} and should be rich in detail; summary 1-2 sentences.
5) ${langInstruction}
6) ${formatInstruction}
7) Output JSON only. No markdown, no code block, no explanation.
8) readAloudScript text nodes must follow the same language rule as content.
9) ${diaryIntentInstruction}
10) ${personaInstruction}
11) ${structureInstruction}
12) ${highlightGuidance}

Date: ${params.date}
Cat Name: ${params.catName || "Unnamed Cat"}
Materials:
${materialLines}`;
  try {
    const res = await ai.models.generateContent({
      model: import.meta.env?.VITE_GEMINI_DIARY_MODEL || "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.5,
      },
    });
    const raw = (res.text || "").trim();
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }
    const scriptRaw = Array.isArray((parsed as any).readAloudScript)
      ? (parsed as any).readAloudScript
      : fallback.readAloudScript;
    const script: DiaryReadAloudSegment[] = scriptRaw
      .map((item: any) => {
        if (item?.type === "video" && typeof item?.videoId === "string") {
          return { type: "video", videoId: item.videoId };
        }
        if (typeof item?.text === "string" && item.text.trim()) {
          const normalizedText = isEn ? sanitizeEnglishText(item.text.trim()) : item.text.trim();
          if (!normalizedText) {
            return null;
          }
          return { type: "text", text: normalizedText };
        }
        return null;
      })
      .filter(Boolean) as DiaryReadAloudSegment[];
    const finalTitle = pickFinalText((parsed as any).title, fallback.title, language, 60);
    const rawContent = pickFinalText((parsed as any).content, fallback.content, language, 1200);
    const finalContent = pickFinalText(
      ensureMinimumDiaryLength(rawContent, fallback.content, params.materials, language, 100),
      fallback.content,
      language,
      1200,
    );
    const finalSummary = pickFinalText((parsed as any).summary, fallback.summary, language, 240);
    return {
      title: isEn ? sanitizeEnglishText(finalTitle) || fallback.title : finalTitle,
      content: isEn ? sanitizeEnglishText(finalContent) || fallback.content : finalContent,
      summary: isEn ? sanitizeEnglishText(finalSummary) || fallback.summary : finalSummary,
      mood: ["happy", "calm", "curious", "playful", "uneasy", "tired", "mixed"].includes((parsed as any).mood)
        ? (parsed as any).mood
        : fallback.mood,
      readAloudScript: script.length > 0 ? script : fallback.readAloudScript,
    } as GenerateDiaryResult;
  } catch {
    return fallback;
  }
}
