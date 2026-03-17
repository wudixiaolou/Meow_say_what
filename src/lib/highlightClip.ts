import { HighlightClip } from "../types";

export function appendClipWithLimit(
  oldHistory: HighlightClip[],
  nextClip: HighlightClip,
  limit: number,
) {
  const merged = [nextClip, ...oldHistory];
  return {
    nextHistory: merged.slice(0, limit),
    removed: merged.slice(limit),
  };
}

export function pickSelectedClip(
  highlightClip: HighlightClip | null,
  highlightHistory: HighlightClip[],
  selectedClipId: string,
) {
  if (selectedClipId) {
    return highlightHistory.find((clip) => clip.id === selectedClipId) || highlightClip;
  }
  return highlightClip || (highlightHistory.length > 0 ? highlightHistory[0] : null);
}
