import test from "node:test";
import assert from "node:assert/strict";
import { pickSupportedHighlightMimeType } from "./highlightMime";

test("Safari 优先选择 mp4 编码", () => {
  const selected = pickSupportedHighlightMimeType(
    (mime) => mime === "video/webm;codecs=vp8,opus" || mime === "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    true,
  );
  assert.equal(selected, "video/mp4;codecs=avc1.42E01E,mp4a.40.2");
});

test("Chrome 优先选择 webm 编码", () => {
  const selected = pickSupportedHighlightMimeType(
    (mime) => mime === "video/webm;codecs=vp8,opus" || mime === "video/mp4",
    false,
  );
  assert.equal(selected, "video/webm;codecs=vp8,opus");
});

test("Safari 下 mp4 不可用时回退到 webm", () => {
  const selected = pickSupportedHighlightMimeType(
    (mime) => mime === "video/webm;codecs=vp8,opus" || mime === "video/webm",
    true,
  );
  assert.equal(selected, "video/webm;codecs=vp8,opus");
});

test("当候选全部不支持时返回空串", () => {
  const selected = pickSupportedHighlightMimeType(() => false, false);
  assert.equal(selected, "");
});
