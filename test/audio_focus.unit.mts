import test from "node:test";
import assert from "node:assert/strict";
import { acquireAudioFocus, getAudioFocusOwner, revokeAudioFocus } from "../src/lib/audioFocus";

const win = globalThis as unknown as { window?: any };
if (!win.window) {
  win.window = {};
}

test("acquireAudioFocus should keep single owner", () => {
  revokeAudioFocus("reset");
  const releaseLive = acquireAudioFocus("live-stream", () => {});
  assert.equal(getAudioFocusOwner(), "live-stream");
  releaseLive();
  assert.equal(getAudioFocusOwner(), null);
});

test("new owner should preempt previous owner", () => {
  revokeAudioFocus("reset");
  let revoked = 0;
  acquireAudioFocus("diary-tts", () => {
    revoked += 1;
  });
  acquireAudioFocus("live-stream", () => {});
  assert.equal(revoked, 1);
  assert.equal(getAudioFocusOwner(), "live-stream");
  revokeAudioFocus("cleanup");
});

test("revokeAudioFocus should clear current owner", () => {
  revokeAudioFocus("reset");
  acquireAudioFocus("cat-sound", () => {});
  assert.equal(getAudioFocusOwner(), "cat-sound");
  revokeAudioFocus("manual");
  assert.equal(getAudioFocusOwner(), null);
});
