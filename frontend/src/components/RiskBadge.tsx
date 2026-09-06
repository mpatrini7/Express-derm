import { attentionLabels } from "../risk";
import type { AttentionLevel, RiskStatus } from "../types";

interface Props {
  level: AttentionLevel | null;
  status: RiskStatus;
  stacked?: boolean;
}

export function RiskBadge({ level, status, stacked = false }: Props) {
  if (!level) {
    return <span className="risk-badge not-assessed">Not assessed</span>;
  }

  return (
    <span
      className={`risk-badge ${level} ${status}${stacked ? " stacked" : ""}`}
      aria-label={
        status === "experimental"
          ? `${attentionLabels[level]} Experimental`
          : undefined
      }
    >
      <span>{attentionLabels[level]}</span>
      {status === "experimental" && (
        <>
          {!stacked && (
            <span className="risk-badge-separator" aria-hidden="true">
              ·
            </span>
          )}
          <small className="experimental-label">Experimental</small>
        </>
      )}
    </span>
  );
}
