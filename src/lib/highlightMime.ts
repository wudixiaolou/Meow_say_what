export function pickSupportedHighlightMimeType(
  isTypeSupported: (mimeType: string) => boolean,
  preferMp4: boolean,
) {
  const mp4Candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
  ];
  const webmCandidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  const candidates = preferMp4
    ? [...mp4Candidates, ...webmCandidates]
    : [...webmCandidates, ...mp4Candidates];
  for (const candidate of candidates) {
    if (isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "";
}
