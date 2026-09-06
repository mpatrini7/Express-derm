import type {
  AttentionLevel,
  FollowUpAction,
  RiskStatus,
} from "./types";

export const attentionLabels: Record<AttentionLevel, string> = {
  low: "Low",
  intermediate: "Inconclusive",
  high: "High",
  uncertain: "Inconclusive",
};

export const followUpLabels: Record<FollowUpAction, string> = {
  capture_required: "Accepted capture required",
  evaluate_required: "AI evaluation required",
  monitor_12_months: "Image comparison in 12 months",
  professional_review: "Professional review recommended now",
  inconclusive: "Inconclusive — no automatic classification",
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function formatDate(value: string | null, fallback = "Not scheduled") {
  return value ? dateFormatter.format(new Date(value)) : fallback;
}

export function formatAttention(
  level: AttentionLevel | null,
  status: RiskStatus,
) {
  if (!level) return "Not assessed";
  const label = attentionLabels[level];
  return status === "experimental" ? `${label} · experimental` : label;
}
