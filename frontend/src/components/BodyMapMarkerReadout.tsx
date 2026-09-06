import { CircleDot } from "lucide-react";
import { formatBodyRegion } from "../bodyRegions";
import { formatAttention } from "../risk";
import type { Lesion } from "../types";

interface Props {
  lesion:
    | Pick<
        Lesion,
        "lesion_code" | "body_part" | "attention_level" | "risk_status"
      >
    | null;
}

export function BodyMapMarkerReadout({ lesion }: Props) {
  if (!lesion) return null;

  const bodyPart = formatBodyRegion(lesion.body_part);
  const attention = formatAttention(
    lesion.attention_level,
    lesion.risk_status,
  );

  return (
    <div
      className="bodymap-region-readout bodymap-marker-readout"
      role="status"
      aria-label={`Marker ${lesion.lesion_code}: ${bodyPart}, ${attention}`}
      aria-live="polite"
    >
      <CircleDot aria-hidden="true" size={15} />
      <strong>{lesion.lesion_code}</strong>
      <span>{bodyPart}</span>
      <span className="marker-readout-attention">{attention}</span>
    </div>
  );
}
