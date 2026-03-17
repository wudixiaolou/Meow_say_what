export function chooseCaptureChunks(
  picked: Blob[],
  initChunk: Blob | null,
) {
  if (!picked.length) {
    return picked;
  }
  if (!initChunk) {
    return picked;
  }
  if (picked[0] === initChunk) {
    return picked;
  }
  return [initChunk, ...picked];
}

export interface TimedChunk {
  startedAt: number;
  endedAt: number;
}

export function pickTimedChunksForCaptureWindow<T extends TimedChunk>(
  chunks: T[],
  windowStart: number,
  windowEnd: number,
  leadingChunks: number = 1,
) {
  const firstMatchedIndex = chunks.findIndex(
    (chunk) => chunk.endedAt > windowStart && chunk.startedAt < windowEnd,
  );
  if (firstMatchedIndex < 0) {
    return [];
  }
  let lastMatchedIndex = firstMatchedIndex;
  for (let i = firstMatchedIndex + 1; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (chunk.startedAt >= windowEnd) {
      break;
    }
    lastMatchedIndex = i;
  }
  const fromIndex = Math.max(0, firstMatchedIndex - Math.max(0, leadingChunks));
  return chunks.slice(fromIndex, lastMatchedIndex + 1);
}

export function expandSelectionToContinuousPrefix<T>(
  allChunks: T[],
  selectedChunks: T[],
) {
  if (!allChunks.length || !selectedChunks.length) {
    return selectedChunks;
  }
  const lastSelected = selectedChunks[selectedChunks.length - 1];
  const endIndex = allChunks.lastIndexOf(lastSelected);
  if (endIndex < 0) {
    return selectedChunks;
  }
  return allChunks.slice(0, endIndex + 1);
}
