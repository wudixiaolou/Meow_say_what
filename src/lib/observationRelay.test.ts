import test from "node:test";
import assert from "node:assert/strict";
import { shouldRelayObservation, buildObservationPrompt } from "./observationRelay";

test("shouldRelayObservation blocks rapid duplicate relays", () => {
  const now = 1_000_000;
  const blocked = shouldRelayObservation({
    nowMs: now,
    lastRelayAtMs: now - 1200,
    minGapMs: 3000,
    signalText: "猫声:Cat",
    lastSignalText: "猫声:Cat",
  });
  assert.equal(blocked, false);
});

test("shouldRelayObservation allows relay after enough gap", () => {
  const now = 1_000_000;
  const allowed = shouldRelayObservation({
    nowMs: now,
    lastRelayAtMs: now - 4200,
    minGapMs: 3000,
    signalText: "猫声:Cat",
    lastSignalText: "猫声:Animal",
  });
  assert.equal(allowed, true);
});

test("buildObservationPrompt produces first-person translation instruction", () => {
  const prompt = buildObservationPrompt("猫声:Cat, 置信度:88%", "qa");
  assert.match(prompt, /第一人称/);
  assert.match(prompt, /翻译/);
  assert.match(prompt, /猫声:Cat/);
});

test("buildObservationPrompt supports english mode", () => {
  const prompt = buildObservationPrompt("Cat sound: meow", "narration", "en");
  assert.match(prompt, /System Observation/);
  assert.match(prompt, /first-person cat voice/);
  assert.match(prompt, /Cat sound: meow/);
});
