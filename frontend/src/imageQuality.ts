export type PhotoQualityBand = "good" | "usable" | "poor" | "unscored";

export function photoQualityPercent(score: number | null) {
  if (score === null || !Number.isFinite(score)) return null;
  return Math.round(Math.min(Math.max(score, 0), 100));
}

export function photoQualityBand(score: number | null): PhotoQualityBand {
  const percent = photoQualityPercent(score);
  if (percent === null) return "unscored";
  if (percent >= 80) return "good";
  if (percent >= 50) return "usable";
  return "poor";
}

export function savedPhotoQualityMessage(score: number | null) {
  const percent = photoQualityPercent(score);
  return percent === null
    ? "Microscope image saved. Photo quality was not scored."
    : `Microscope image saved. Photo quality: ${percent}%.`;
}

export function visiblePhotoQualityReason(reason: string | null) {
  if (!reason) return null;
  const visibleReasons = reason
    .split(";")
    .map((item) => item.trim())
    .filter(
      (item) => item.toLowerCase() !== "image is not sufficiently sharp",
    );
  return visibleReasons.join("; ") || null;
}
