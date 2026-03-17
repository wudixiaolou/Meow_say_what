import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseCaptureChunks,
  expandSelectionToContinuousPrefix,
  pickTimedChunksForCaptureWindow,
} from "./highlightBufferCompose";

test("当窗口不含初始化片段时应自动补齐初始化片段", async () => {
  const init = new Blob(["init"], { type: "video/webm" });
  const c2 = new Blob(["c2"], { type: "video/webm" });
  const picked = [c2];
  const result = chooseCaptureChunks(picked, init);
  const text = await new Blob(result).text();
  assert.equal(text, "initc2");
});

test("当窗口已含初始化片段时不重复补齐", async () => {
  const init = new Blob(["init"], { type: "video/webm" });
  const c2 = new Blob(["c2"], { type: "video/webm" });
  const picked = [init, c2];
  const result = chooseCaptureChunks(picked, init);
  const text = await new Blob(result).text();
  assert.equal(text, "initc2");
});

test("无初始化片段时保持原窗口片段", async () => {
  const c2 = new Blob(["c2"], { type: "video/webm" });
  const picked = [c2];
  const result = chooseCaptureChunks(picked, null);
  const text = await new Blob(result).text();
  assert.equal(text, "c2");
});

test("窗口片段选择会向前补一个片段以提高可解码性", () => {
  const chunks = [
    { payload: "c1", startedAt: 0, endedAt: 400 },
    { payload: "c2", startedAt: 400, endedAt: 800 },
    { payload: "c3", startedAt: 800, endedAt: 1200 },
  ];
  const selected = pickTimedChunksForCaptureWindow(chunks, 550, 1100, 1);
  assert.deepEqual(selected.map((item) => item.payload), ["c1", "c2", "c3"]);
});

test("窗口无匹配片段时返回空数组", () => {
  const chunks = [{ payload: "c1", startedAt: 0, endedAt: 400 }];
  const selected = pickTimedChunksForCaptureWindow(chunks, 500, 700, 1);
  assert.deepEqual(selected, []);
});

test("会扩展为从缓冲区开头到命中末尾的连续片段", () => {
  const chunks = [{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }];
  const selected = [chunks[1], chunks[2]];
  const expanded = expandSelectionToContinuousPrefix(chunks, selected);
  assert.deepEqual(expanded.map((item) => item.id), ["c1", "c2", "c3"]);
});

test("扩展逻辑在空选择时保持空数组", () => {
  const chunks = [{ id: "c1" }];
  const expanded = expandSelectionToContinuousPrefix(chunks, []);
  assert.deepEqual(expanded, []);
});
