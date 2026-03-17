import test from "node:test";
import assert from "node:assert/strict";
import { generateDiaryWithModel, matchHighlightsForDiary } from "./diaryGenerator";
import { HighlightClip, InteractionTextRecord } from "../types";

function createMaterial(id: string, occurredAtMs: number, text: string): InteractionTextRecord {
  return {
    id,
    sessionId: "session-1",
    occurredAtMs,
    text,
    source: "model_output",
    consumedByDiaryDate: null,
  };
}

function createClip(id: string, createdAtMs: number, caption: string, triggerText: string): HighlightClip {
  return {
    id,
    createdAt: new Date(createdAtMs),
    triggerType: "manual",
    triggerText,
    clipBlob: new Blob(["x"], { type: "video/webm" }),
    clipUrl: `blob:${id}`,
    caption,
  };
}

test("matchHighlightsForDiary 优先选择时间接近且文本命中的片段", () => {
  const base = Date.now();
  const materials = [
    createMaterial("m1", base + 10_000, "猫咪在门口喵喵叫，想让我开门"),
    createMaterial("m2", base + 85_000, "它叼着玩具跑到沙发边"),
  ];
  const highlights = [
    createClip("h1", base + 12_000, "门口喵喵", "喵喵"),
    createClip("h2", base + 85_500, "沙发玩具", "玩具"),
    createClip("h3", base + 480_000, "远时间片段", "无关"),
  ];
  const ids = matchHighlightsForDiary(materials, highlights, 3);
  assert.deepEqual(ids, ["h1", "h2"]);
});

test("matchHighlightsForDiary 在无文本命中时仍可按时间轴自动匹配", () => {
  const base = Date.now();
  const materials = [
    createMaterial("m1", base + 20_000, "今天情绪稳定"),
    createMaterial("m2", base + 45_000, "互动频率增加"),
  ];
  const highlights = [
    createClip("h1", base + 18_000, "镜头一", "片段一"),
    createClip("h2", base + 44_000, "镜头二", "片段二"),
    createClip("h3", base + 350_000, "镜头三", "片段三"),
  ];
  const ids = matchHighlightsForDiary(materials, highlights, 2);
  assert.deepEqual(ids, ["h2", "h1"]);
});

test("generateDiaryWithModel 在英文模式下返回英文 fallback", async () => {
  const result = await generateDiaryWithModel({
    date: "2026-03-16",
    catName: "",
    personaName: "Cat Diary",
    materials: [],
    linkedHighlightIds: [],
    language: "en",
  });
  assert.match(result.title, /Diary/i);
  assert.match(result.content, /^I am /);
  assert.match(result.summary, /gentle.*moments/i);
});
