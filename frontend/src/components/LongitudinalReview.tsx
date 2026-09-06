import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  RefreshCw,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { hasConfirmedMicroscopeSource } from "../observationProvenance";
import type {
  LongitudinalChangeFlag,
  LongitudinalReview as LongitudinalReviewRecord,
  LongitudinalReviewCreate,
  Observation,
} from "../types";

interface Props {
  observations: Observation[];
  reviews: LongitudinalReviewRecord[];
  saving: boolean;
  onSave: (payload: LongitudinalReviewCreate) => Promise<void>;
}

interface ImagePaneProps {
  label: string;
  observation: Observation;
  zoom: number;
  resetToken: number;
}

interface SaveFeedback {
  kind: "error" | "success";
  text: string;
}

const flagLabels: Record<LongitudinalChangeFlag, string> = {
  no_visible_change: "No visual change recorded",
  change_observed: "Visual change recorded",
  uncertain: "Uncertain",
};

function comparisonDate(observation: Observation) {
  return new Date(observation.captured_at).toLocaleString();
}

function ImagePane({
  label,
  observation,
  zoom,
  resetToken,
}: ImagePaneProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0;
      viewportRef.current.scrollTop = 0;
    }
  }, [observation.id, resetToken]);

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport || zoom === 1) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
  }

  function pan(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    if (!viewport || !drag || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.x);
    viewport.scrollTop = drag.scrollTop - (event.clientY - drag.y);
  }

  function stopPan(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (viewport?.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  return (
    <figure className="review-image-pane">
      <figcaption>
        <span>{label}</span>
        <strong>{comparisonDate(observation)}</strong>
      </figcaption>
      <div
        ref={viewportRef}
        className={zoom > 1 ? "review-image-viewport zoomed" : "review-image-viewport"}
        onPointerDown={startPan}
        onPointerMove={pan}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
      >
        <img
          src={`/media/${observation.microscope_image_path}`}
          alt={`${label} microscope observation ${observation.id}`}
          draggable={false}
          style={{ width: `${zoom * 100}%` }}
        />
      </div>
      <small>
        {observation.acquisition
          ? `${observation.acquisition.width} x ${observation.acquisition.height} · protocol r${observation.acquisition.protocol_revision}`
          : "Legacy capture metadata"}
      </small>
    </figure>
  );
}

export function LongitudinalReview({
  observations,
  reviews,
  saving,
  onSave,
}: Props) {
  const accepted = useMemo(
    () =>
      observations
        .filter(
          (observation) =>
            observation.quality_status === "accepted" &&
            hasConfirmedMicroscopeSource(observation),
        )
        .sort(
          (left, right) =>
            new Date(left.captured_at).getTime() -
            new Date(right.captured_at).getTime(),
        ),
    [observations],
  );
  const [baselineId, setBaselineId] = useState<number | null>(null);
  const [comparisonId, setComparisonId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [resetToken, setResetToken] = useState(0);
  const [changeFlag, setChangeFlag] =
    useState<LongitudinalChangeFlag | null>(null);
  const [notes, setNotes] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null);

  useEffect(() => {
    const acceptedIds = new Set(accepted.map((observation) => observation.id));
    setBaselineId((current) =>
      current !== null && acceptedIds.has(current)
        ? current
        : accepted.at(-2)?.id ?? null,
    );
    setComparisonId((current) =>
      current !== null && acceptedIds.has(current)
        ? current
        : accepted.at(-1)?.id ?? null,
    );
  }, [accepted]);

  const observationsById = useMemo(
    () =>
      new Map(
        observations.map((observation) => [observation.id, observation]),
      ),
    [observations],
  );
  const baseline =
    baselineId === null ? null : observationsById.get(baselineId) ?? null;
  const comparison =
    comparisonId === null ? null : observationsById.get(comparisonId) ?? null;
  const pairIsChronological =
    baseline !== null &&
    comparison !== null &&
    baseline.id !== comparison.id &&
    new Date(baseline.captured_at).getTime() <=
      new Date(comparison.captured_at).getTime();

  function resetView() {
    setZoom(1);
    setResetToken((current) => current + 1);
  }

  async function saveReview() {
    if (
      saving ||
      !baseline ||
      !comparison ||
      !changeFlag ||
      !pairIsChronological
    ) {
      return;
    }
    if (saveFeedback?.kind !== "error") {
      setSaveFeedback(null);
    }
    try {
      await onSave({
        baseline_observation_id: baseline.id,
        comparison_observation_id: comparison.id,
        change_flag: changeFlag,
        notes: notes.trim() || null,
      });
      setChangeFlag(null);
      setNotes("");
      setSaveFeedback({
        kind: "success",
        text: "Operator review saved.",
      });
    } catch (error) {
      setSaveFeedback({
        kind: "error",
        text:
          error instanceof Error ? error.message : "Unable to save review",
      });
    }
  }

  function clearSaveError() {
    setSaveFeedback((current) =>
      current?.kind === "error" ? null : current,
    );
  }

  return (
    <section className="longitudinal-review">
      <div className="row-between">
        <div>
          <p className="eyebrow">Operator comparison</p>
          <h3>Longitudinal review</h3>
        </div>
        <span>{accepted.length} eligible captures</span>
      </div>

      {accepted.length < 2 ? (
        <div className="empty-state longitudinal-empty">
          <CalendarDays aria-hidden="true" size={22} />
          <p>
            Two source-confirmed, quality-accepted microscope captures are
            required for comparison.
          </p>
        </div>
      ) : (
        <>
          <ol
            className="review-timeline"
            aria-label="Eligible microscope capture timeline"
          >
            {accepted.map((observation, index) => (
              <li
                key={observation.id}
                className={[
                  observation.id === baselineId ? "baseline" : "",
                  observation.id === comparisonId ? "comparison" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span>{index + 1}</span>
                <time dateTime={observation.captured_at}>
                  {new Date(observation.captured_at).toLocaleDateString()}
                </time>
              </li>
            ))}
          </ol>

          <div className="review-toolbar">
            <label>
              Baseline
              <select
                value={baselineId ?? ""}
                disabled={saving}
                onChange={(event) => {
                  setBaselineId(Number(event.target.value));
                  clearSaveError();
                }}
              >
                {accepted.map((observation) => (
                  <option key={observation.id} value={observation.id}>
                    {comparisonDate(observation)}
                  </option>
                ))}
              </select>
            </label>
            <ArrowRight aria-hidden="true" size={18} />
            <label>
              Comparison
              <select
                value={comparisonId ?? ""}
                disabled={saving}
                onChange={(event) => {
                  setComparisonId(Number(event.target.value));
                  clearSaveError();
                }}
              >
                {accepted.map((observation) => (
                  <option key={observation.id} value={observation.id}>
                    {comparisonDate(observation)}
                  </option>
                ))}
              </select>
            </label>
            <div className="review-zoom-controls">
              <button
                type="button"
                className="icon-button"
                aria-label="Zoom out comparison images"
                title="Zoom out"
                disabled={zoom <= 1}
                onClick={() => setZoom((current) => Math.max(1, current - 0.25))}
              >
                <ZoomOut aria-hidden="true" size={18} />
              </button>
              <label>
                <span>Zoom {Math.round(zoom * 100)}%</span>
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="0.25"
                  value={zoom}
                  aria-label="Comparison image zoom"
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label="Zoom in comparison images"
                title="Zoom in"
                disabled={zoom >= 4}
                onClick={() => setZoom((current) => Math.min(4, current + 0.25))}
              >
                <ZoomIn aria-hidden="true" size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Reset comparison image view"
                title="Reset view"
                onClick={resetView}
              >
                <RotateCcw aria-hidden="true" size={17} />
              </button>
            </div>
          </div>

          {!pairIsChronological && (
            <p className="capture-message" role="alert">
              Choose an older baseline and a different, later comparison.
            </p>
          )}

          {baseline && comparison && (
            <div className="review-image-pair">
              <ImagePane
                label="Baseline"
                observation={baseline}
                zoom={zoom}
                resetToken={resetToken}
              />
              <ImagePane
                label="Comparison"
                observation={comparison}
                zoom={zoom}
                resetToken={resetToken}
              />
            </div>
          )}

          <div className="review-entry" aria-busy={saving}>
            <fieldset disabled={saving}>
              <legend>Operator flag</legend>
              <div className="review-flag-options">
                {(Object.keys(flagLabels) as LongitudinalChangeFlag[]).map(
                  (flag) => (
                    <label key={flag} className={changeFlag === flag ? "selected" : ""}>
                      <input
                        type="radio"
                        name="longitudinal-change-flag"
                        value={flag}
                        checked={changeFlag === flag}
                        onChange={() => {
                          setChangeFlag(flag);
                          clearSaveError();
                        }}
                      />
                      {flagLabels[flag]}
                    </label>
                  ),
                )}
              </div>
            </fieldset>
            <label>
              Review note
              <textarea
                rows={2}
                maxLength={2000}
                value={notes}
                disabled={saving}
                placeholder="Optional visual observations"
                onChange={(event) => {
                  setNotes(event.target.value);
                  clearSaveError();
                }}
              />
            </label>
            <button
              type="button"
              disabled={!changeFlag || !pairIsChronological || saving}
              onClick={saveReview}
            >
              {saving ? "Saving…" : "Save operator review"}
            </button>
          </div>

          {saveFeedback?.kind === "error" && (
            <div className="review-save-error" role="alert">
              <CircleAlert aria-hidden="true" size={20} strokeWidth={2} />
              <div>
                <strong>Review was not saved</strong>
                <span>{saveFeedback.text}</span>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveReview()}
              >
                <RefreshCw
                  className={saving ? "rotating" : undefined}
                  aria-hidden="true"
                  size={16}
                  strokeWidth={2}
                />
                {saving ? "Retrying" : "Retry"}
              </button>
            </div>
          )}
        </>
      )}

      {reviews.length > 0 && (
        <div className="review-history">
          <div className="row-between">
            <strong>Saved review history</strong>
            <span>{reviews.length}</span>
          </div>
          <div>
            {reviews.map((review) => {
              const reviewedBaseline = observationsById.get(
                review.baseline_observation_id,
              );
              const reviewedComparison = observationsById.get(
                review.comparison_observation_id,
              );
              return (
                <article key={review.id}>
                  <div>
                    <strong>{flagLabels[review.change_flag]}</strong>
                    <time dateTime={review.created_at}>
                      {new Date(review.created_at).toLocaleString()}
                    </time>
                  </div>
                  <span>
                    {reviewedBaseline
                      ? new Date(reviewedBaseline.captured_at).toLocaleDateString()
                      : `Observation ${review.baseline_observation_id}`}
                    {" → "}
                    {reviewedComparison
                      ? new Date(
                          reviewedComparison.captured_at,
                        ).toLocaleDateString()
                      : `Observation ${review.comparison_observation_id}`}
                  </span>
                  {review.notes && <p>{review.notes}</p>}
                </article>
              );
            })}
          </div>
        </div>
      )}

      <small className="safety-copy">
        Operator comparison only. A visual flag is not a diagnosis and does not
        alter AI attention or follow-up scheduling.
      </small>
      {saveFeedback?.kind === "success" && (
        <p className="capture-message" role="status">
          {saveFeedback.text}
        </p>
      )}
    </section>
  );
}
