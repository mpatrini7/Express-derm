import {
  ArrowRight,
  CalendarClock,
  Database,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { formatDate } from "../risk";
import type { Patient } from "../types";
import { RiskBadge } from "./RiskBadge";

type FollowUpCategory = "due" | "next_30_days" | "later";
type FollowUpFilter = "all" | FollowUpCategory;

interface ScheduledPatient {
  category: FollowUpCategory;
  dayOffset: number;
  patient: Patient;
  timestamp: number;
}

interface Props {
  patients: Patient[];
  openingId: number | null;
  loading?: boolean;
  unavailable?: boolean;
  onOpen: (patient: Patient) => void;
  now?: Date;
}

const millisecondsPerDay = 24 * 60 * 60 * 1000;

function startOfLocalDay(value: Date): Date {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day;
}

export function classifyFollowUp(
  value: string,
  now: Date,
): Omit<ScheduledPatient, "patient"> | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const today = startOfLocalDay(now);
  const checkDay = startOfLocalDay(parsed);
  const dayOffset = Math.round(
    (checkDay.getTime() - today.getTime()) / millisecondsPerDay,
  );

  return {
    category:
      dayOffset <= 0
        ? "due"
        : dayOffset <= 30
          ? "next_30_days"
          : "later",
    dayOffset,
    timestamp: parsed.getTime(),
  };
}

function timingLabel(item: ScheduledPatient): string {
  if (item.dayOffset < 0) {
    const days = Math.abs(item.dayOffset);
    return `${days} ${days === 1 ? "day" : "days"} overdue`;
  }
  if (item.dayOffset === 0) return "Due today";
  return `In ${item.dayOffset} ${item.dayOffset === 1 ? "day" : "days"}`;
}

export function FollowUpQueue({
  patients,
  openingId,
  loading = false,
  unavailable = false,
  onOpen,
  now,
}: Props) {
  const [filter, setFilter] = useState<FollowUpFilter>("all");
  const referenceNow = useMemo(() => now ?? new Date(), [now]);
  const scheduledPatients = useMemo(
    () =>
      patients
        .flatMap((patient): ScheduledPatient[] => {
          if (!patient.next_check_at) return [];
          const schedule = classifyFollowUp(
            patient.next_check_at,
            referenceNow,
          );
          return schedule ? [{ ...schedule, patient }] : [];
        })
        .sort(
          (left, right) =>
            left.timestamp - right.timestamp ||
            left.patient.patient_code.localeCompare(
              right.patient.patient_code,
              undefined,
              { numeric: true },
            ),
        ),
    [patients, referenceNow],
  );

  const categoryCounts: Record<FollowUpCategory, number> = {
    due: scheduledPatients.filter((item) => item.category === "due").length,
    next_30_days: scheduledPatients.filter(
      (item) => item.category === "next_30_days",
    ).length,
    later: scheduledPatients.filter((item) => item.category === "later").length,
  };
  const unscheduledCount = patients.length - scheduledPatients.length;
  const visiblePatients =
    filter === "all"
      ? scheduledPatients
      : scheduledPatients.filter((item) => item.category === filter);
  const filters: Array<{
    label: string;
    value: FollowUpFilter;
    count: number;
  }> = [
    {
      label: "All scheduled",
      value: "all",
      count: scheduledPatients.length,
    },
    { label: "Due now", value: "due", count: categoryCounts.due },
    {
      label: "Next 30 days",
      value: "next_30_days",
      count: categoryCounts.next_30_days,
    },
    { label: "Later", value: "later", count: categoryCounts.later },
  ];

  return (
    <section className="panel follow-up-queue" aria-busy={loading}>
      <div className="panel-heading row-between">
        <div>
          <p className="eyebrow">Automatic AI worklist</p>
          <h2>Follow-up</h2>
        </div>
        <span
          className={
            loading
              ? "status-chip loading"
              : unavailable
                ? "status-chip unavailable"
                : "status-chip"
          }
          aria-live="polite"
        >
          {loading ? (
            <>
              <LoaderCircle aria-hidden="true" size={15} strokeWidth={2} />
              {patients.length === 0 ? "Loading" : "Refreshing"}
            </>
          ) : unavailable ? (
            "Unavailable"
          ) : (
            <>
              {scheduledPatients.length}{" "}
              {scheduledPatients.length === 1
                ? "scheduled record"
                : "scheduled records"}
            </>
          )}
        </span>
      </div>

      {patients.length === 0 && (loading || unavailable) ? (
        <div
          className="empty-state follow-up-empty patient-data-state"
          role={loading ? "status" : undefined}
        >
          {loading ? (
            <LoaderCircle aria-hidden="true" size={22} strokeWidth={2} />
          ) : (
            <Database aria-hidden="true" size={22} strokeWidth={2} />
          )}
          <p>
            {loading
              ? "Loading local patient records."
              : "Patient data is unavailable."}
          </p>
        </div>
      ) : (
        <>
          <div className="follow-up-safety">
            <ShieldCheck aria-hidden="true" size={20} strokeWidth={2} />
            <div>
              <strong>AI-generated dates</strong>
              <span>
                Experimental dates support local review planning only.
                Clinician-directed checks remain separate and take precedence.
              </span>
            </div>
          </div>

          <dl className="follow-up-summary">
            <div className={categoryCounts.due > 0 ? "due" : ""}>
              <dt>Due now</dt>
              <dd>{categoryCounts.due}</dd>
            </div>
            <div>
              <dt>Next 30 days</dt>
              <dd>{categoryCounts.next_30_days}</dd>
            </div>
            <div>
              <dt>Later</dt>
              <dd>{categoryCounts.later}</dd>
            </div>
            <div>
              <dt>No AI date</dt>
              <dd>{unscheduledCount}</dd>
            </div>
          </dl>

          <div
            className="follow-up-filters"
            role="group"
            aria-label="Filter scheduled follow-up"
          >
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
                <span>{item.count}</span>
              </button>
            ))}
          </div>

          {visiblePatients.length === 0 ? (
            <div className="empty-state follow-up-empty">
              <CalendarClock aria-hidden="true" size={24} strokeWidth={1.8} />
              <p>
                {scheduledPatients.length === 0
                  ? "No automatic AI follow-up dates are scheduled."
                  : "No records match this follow-up window."}
              </p>
              {scheduledPatients.length > 0 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setFilter("all")}
                >
                  Show all scheduled
                </button>
              )}
            </div>
          ) : (
            <div className="follow-up-list" aria-label="Scheduled follow-up list">
              {visiblePatients.map((item) => (
                <button
                  key={item.patient.id}
                  type="button"
                  className="follow-up-row"
                  aria-busy={openingId === item.patient.id}
                  disabled={openingId === item.patient.id}
                  onClick={() => onOpen(item.patient)}
                >
                  <div className="follow-up-identity">
                    <strong>{item.patient.patient_code}</strong>
                    <span>
                      {item.patient.display_name || "No display label"}
                    </span>
                  </div>
                  <div className="follow-up-date">
                    <span>Next check</span>
                    <strong>{formatDate(item.patient.next_check_at)}</strong>
                    <small className={item.category}>
                      {timingLabel(item)}
                    </small>
                  </div>
                  <div className="follow-up-risk">
                    <span>Highest AI risk factor</span>
                    <RiskBadge
                      level={item.patient.highest_attention_level}
                      status={item.patient.attention_status}
                    />
                  </div>
                  <div className="follow-up-coverage">
                    <span>Accepted coverage</span>
                    <strong>
                      {item.patient.documented_lesions}/
                      {item.patient.mapped_lesions}
                    </strong>
                  </div>
                  {openingId === item.patient.id ? (
                    <>
                      <LoaderCircle
                        className="follow-up-loading-icon"
                        aria-hidden="true"
                        size={19}
                        strokeWidth={2}
                      />
                      <span className="sr-only">Loading patient record</span>
                    </>
                  ) : (
                    <ArrowRight aria-hidden="true" size={19} strokeWidth={2} />
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
