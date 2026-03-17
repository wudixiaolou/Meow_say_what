import test from "node:test";
import assert from "node:assert/strict";
import { buildPersistedClip, restoreClipFromPersisted } from "./highlightStorage";
import { HighlightClip } from "../types";

function createClip(id: string, createdAtMs: number): HighlightClip {
  return {
    id,
    createdAt: new Date(createdAtMs),
    triggerType: "manual",
    triggerText: "手动抓拍",
    clipBlob: new Blob(["x"], { type: "video/webm" }),
    clipUrl: `blob:${id}`,
    caption: "本喵高光时刻",
  };
}

test("buildPersistedClip 会序列化 createdAt 时间戳", () => {
  const clip = createClip("a", 1700000000000);
  const persisted = buildPersistedClip(clip);
  assert.equal(persisted.createdAtMs, 1700000000000);
  assert.equal(persisted.id, "a");
});

test("restoreClipFromPersisted 会恢复为可播放对象", () => {
  const clip = createClip("b", 1700000001000);
  const persisted = buildPersistedClip(clip);
  const restored = restoreClipFromPersisted(persisted, (blob) => `blob:restored-${blob.size}`);
  assert.equal(restored.id, "b");
  assert.equal(restored.createdAt.getTime(), 1700000001000);
  assert.equal(restored.clipUrl, "blob:restored-1");
});
