import {
  photoQualityBand,
  photoQualityPercent,
} from "../imageQuality";

interface Props {
  score: number | null;
  compact?: boolean;
}

const bandLabels = {
  good: "Good image",
  usable: "Usable with caution",
  poor: "Poor image",
  unscored: "Not scored",
} as const;

export function PhotoQuality({ score, compact = false }: Props) {
  const percent = photoQualityPercent(score);
  const band = photoQualityBand(score);

  return (
    <div className={`photo-quality ${band}${compact ? " compact" : ""}`}>
      <div>
        <span>Photo quality</span>
        <strong>{percent === null ? "—" : `${percent}%`}</strong>
      </div>
      {percent !== null && (
        <progress
          aria-label={`Photo quality ${percent} percent`}
          max={100}
          value={percent}
        />
      )}
      {!compact && <small>{bandLabels[band]}</small>}
    </div>
  );
}
