import test from "node:test";
import assert from "node:assert/strict";
import { appendClipWithLimit, pickSelectedClip } from "./highlightClip";
import { HighlightClip } from "../types";

function createClip(id: string): HighlightClip {
  return {
    id,
    createdAt: new Date(),
    triggerType: "manual",
    triggerText: "手动抓拍",
    clipBlob: new Blob(["x"], { type: "video/webm" }),
    clipUrl: `blob:${id}`,
    caption: "本喵高光时刻",
  };
}

test("appendClipWithLimit 保留最新片段并返回被移除片段", () => {
  const old = [createClip("2"), createClip("1")];
  const next = createClip("3");
  const result = appendClipWithLimit(old, next, 2);
  assert.deepEqual(
    result.nextHistory.map((item) => item.id),
    ["3", "2"],
  );
  assert.deepEqual(
    result.removed.map((item) => item.id),
    ["1"],
  );
});

test("pickSelectedClip 默认选择最新片段", () => {
  const latest = createClip("latest");
  const older = createClip("older");
  const selected = pickSelectedClip(null, [latest, older], "");
  assert.equal(selected?.id, "latest");
});

test("pickSelectedClip 优先按 selectedClipId 命中历史记录", () => {
  const latest = createClip("latest");
  const older = createClip("older");
  const selected = pickSelectedClip(latest, [latest, older], "older");
  assert.equal(selected?.id, "older");
});
