import { MapPin } from "lucide-react";
import { formatBodyRegion } from "../bodyRegions";

interface Props {
  region: string | null;
}

export function BodyMapRegionReadout({ region }: Props) {
  if (!region) return null;
  const formattedRegion = formatBodyRegion(region);

  return (
    <div
      className="bodymap-region-readout"
      role="status"
      aria-label={`Target: ${formattedRegion}`}
      aria-live="polite"
    >
      <MapPin aria-hidden="true" size={15} />
      <span>Target</span>
      <strong>{formattedRegion}</strong>
    </div>
  );
}
