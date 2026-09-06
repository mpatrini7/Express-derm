import {
  CircleAlert,
  ImageOff,
  LoaderCircle,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { formatBodyRegion } from "../bodyRegions";
import { visiblePhotoQualityReason } from "../imageQuality";
import { savedWithRefreshWarning } from "../mutationFeedback";
import { followUpLabels, formatDate } from "../risk";
import type {
  Lesion,
  LesionAuditEvent,
  LongitudinalReview,
  LongitudinalReviewCreate,
  Observation,
} from "../types";
import { AIResultCard } from "./AIResultCard";
import { LongitudinalReview as LongitudinalReviewView } from "./LongitudinalReview";
import { ObservationDeleteDialog } from "./ObservationDeleteDialog";
import { PhotoQuality } from "./PhotoQuality";
import { RiskBadge } from "./RiskBadge";

interface Props {
  lesion: Lesion;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

export function LesionDetailModal({ lesion, onClose, onChanged }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const historyLoadRevision = useRef(0);
  const reviewSaveRevision = useRef(0);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [auditEvents, setAuditEvents] = useState<LesionAuditEvent[]>([]);
  const [reviews, setReviews] = useState<LongitudinalReview[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingReview, setSavingReview] = useState(false);
  const [pendingObservationDelete, setPendingObservationDelete] =
    useState<Observation | null>(null);
  const [deletionMessage, setDeletionMessage] = useState("");

  async function loadHistory() {
    const revision = historyLoadRevision.current + 1;
    historyLoadRevision.current = revision;
    setLoading(true);
    try {
      const [nextObservations, nextAuditEvents, nextReviews] = await Promise.all([
        api.listObservations(lesion.id),
        api.listLesionAuditEvents(lesion.id),
        api.listLongitudinalReviews(lesion.id),
      ]);
      if (revision !== historyLoadRevision.current) return false;
      setObservations(nextObservations);
      setAuditEvents(nextAuditEvents);
      setReviews(nextReviews);
      setHistoryError("");
      setHistoryReady(true);
      return true;
    } catch (error) {
      if (revision !== historyLoadRevision.current) return false;
      setHistoryReady(false);
      setHistoryError(
        error instanceof Error ? error.message : "Unable to load history",
      );
      return false;
    } finally {
      if (revision === historyLoadRevision.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    setObservations([]);
    setAuditEvents([]);
    setReviews([]);
    setHistoryError("");
    setHistoryReady(false);
    setSavingReview(false);
    setPendingObservationDelete(null);
    setDeletionMessage("");
    void loadHistory();
    return () => {
      historyLoadRevision.current += 1;
      reviewSaveRevision.current += 1;
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [lesion.id]);

  const latestAccepted = observations.find(
    (observation) => observation.quality_status === "accepted",
  );

  async function saveReview(payload: LongitudinalReviewCreate) {
    const revision = reviewSaveRevision.current + 1;
    reviewSaveRevision.current = revision;
    setSavingReview(true);
    try {
      const created = await api.createLongitudinalReview(lesion.id, payload);
      if (revision !== reviewSaveRevision.current) return;
      setReviews((current) => [created, ...current]);
    } finally {
      if (revision === reviewSaveRevision.current) {
        setSavingReview(false);
      }
    }
  }

  async function removeObservation(observation: Observation) {
    const deletedMessage = "Microscope image deleted. Lesion retained.";
    await api.deleteObservation(observation.id);
    setPendingObservationDelete(null);
    setObservations((current) =>
      current.filter((item) => item.id !== observation.id),
    );
    setReviews((current) =>
      current.filter(
        (review) =>
          review.baseline_observation_id !== observation.id &&
          review.comparison_observation_id !== observation.id,
      ),
    );
    setDeletionMessage(deletedMessage);
    try {
      await onChanged();
    } catch (error) {
      setDeletionMessage(savedWithRefreshWarning(deletedMessage, error));
    }
  }

  function requestClose() {
    if (!savingReview) onClose();
  }

  function keepFocusInside(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      [
        "button:not(:disabled)",
        "a[href]",
        "input:not(:disabled)",
        "select:not(:disabled)",
        "textarea:not(:disabled)",
        '[tabindex]:not([tabindex="-1"])',
      ].join(","),
    );
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="lesion-detail-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="lesion-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={loading || savingReview}
        aria-labelledby={titleId}
        onKeyDown={keepFocusInside}
      >
        <div className="lesion-detail-content">
        <header className="lesion-detail-header">
          <div>
            <p className="eyebrow">{formatBodyRegion(lesion.body_part)}</p>
            <h2 id={titleId}>{lesion.lesion_code}</h2>
            <span>{lesion.label || "No display label"}</span>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            aria-label="Close lesion details"
            title="Close"
            disabled={savingReview}
            onClick={requestClose}
          >
            <X aria-hidden="true" size={19} />
          </button>
        </header>

        <section className="lesion-risk-summary">
          <div>
            <span>AI risk factor</span>
            <RiskBadge
              level={lesion.attention_level}
              status={lesion.risk_status}
            />
          </div>
          <div>
            <span>Follow-up</span>
            <strong>{followUpLabels[lesion.follow_up_action]}</strong>
          </div>
          <div>
            <span>Next check</span>
            <strong>{formatDate(lesion.next_check_at)}</strong>
          </div>
        </section>

        <dl className="lesion-facts">
          <div>
            <dt>Mapped</dt>
            <dd>{formatDate(lesion.created_at)}</dd>
          </div>
          <div>
            <dt>Recorded edits</dt>
            <dd>
              {historyReady
                ? auditEvents.length
                : loading
                  ? "Loading"
                  : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Observations</dt>
            <dd>{lesion.observation_count}</dd>
          </div>
          <div>
            <dt>Accepted captures</dt>
            <dd>{lesion.accepted_observation_count}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{lesion.risk_model_version || "Not evaluated"}</dd>
          </div>
          <div>
            <dt>AI assessment</dt>
            <dd>{formatDate(lesion.risk_assessed_at, "Not evaluated")}</dd>
          </div>
          <div>
            <dt>Validation</dt>
            <dd>{lesion.risk_validation_status || "Not assessed"}</dd>
          </div>
          <div>
            <dt>Microscope domain</dt>
            <dd>{lesion.risk_domain_status || "Not assessed"}</dd>
          </div>
        </dl>

        {historyError && (
          <div className="lesion-history-error" role="alert">
            <CircleAlert aria-hidden="true" size={20} strokeWidth={2} />
            <div>
              <strong>Lesion history could not be loaded</strong>
              <span>{historyError}</span>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadHistory()}
            >
              <RefreshCw
                className={loading ? "rotating" : undefined}
                aria-hidden="true"
                size={16}
                strokeWidth={2}
              />
              {loading ? "Retrying" : "Retry"}
            </button>
          </div>
        )}

        {auditEvents.length > 0 && (
          <section className="lesion-audit-history">
            <div className="row-between">
              <div>
                <p className="eyebrow">Immutable audit trail</p>
                <h3>Lesion changes</h3>
              </div>
              <span>{auditEvents.length}</span>
            </div>
            <div className="lesion-audit-list">
              {auditEvents.map((event) => (
                <article key={event.id}>
                  <div>
                    <strong>
                      {event.event_type === "location"
                        ? "Marker repositioned"
                        : "Details updated"}
                    </strong>
                    <span>{new Date(event.created_at).toLocaleString()}</span>
                  </div>
                  {event.event_type === "location" ? (
                    <p>
                      {formatBodyRegion(event.previous_state.body_part)}
                      {" → "}
                      {formatBodyRegion(event.current_state.body_part)}
                    </p>
                  ) : (
                    <p>
                      {event.previous_state.label || "No label"}
                      {" → "}
                      {event.current_state.label || "No label"}
                    </p>
                  )}
                  {event.change_reason && <small>{event.change_reason}</small>}
                </article>
              ))}
            </div>
          </section>
        )}

        {historyReady && (
          <LongitudinalReviewView
            observations={observations}
            reviews={reviews}
            saving={savingReview}
            onSave={saveReview}
          />
        )}

        <div className="lesion-detail-grid">
          <section className="lesion-image-history">
            <div className="row-between">
              <div>
                <p className="eyebrow">Microscope record</p>
                <h3>Image history</h3>
              </div>
              <span>{observations.length}</span>
            </div>

            {!historyReady ? (
              <div
                className="empty-state lesion-history-state"
                role={loading ? "status" : undefined}
              >
                {loading ? (
                  <LoaderCircle
                    className="rotating"
                    aria-hidden="true"
                    size={22}
                    strokeWidth={2}
                  />
                ) : (
                  <ImageOff aria-hidden="true" size={22} />
                )}
                <p>
                  {loading
                    ? "Loading microscope history."
                    : "Microscope history is unavailable."}
                </p>
              </div>
            ) : observations.length === 0 ? (
              <div className="empty-state">
                <ImageOff aria-hidden="true" size={22} />
                <p>No microscope images saved.</p>
              </div>
            ) : (
              <div className="lesion-image-grid">
                {observations.map((observation) => (
                  <article key={observation.id}>
                    <img
                      src={`/media/${observation.microscope_image_path}`}
                      alt={`Microscope observation ${observation.id}`}
                    />
                    <div>
                      <strong>
                        {new Date(observation.captured_at).toLocaleString()}
                      </strong>
                      <PhotoQuality
                        compact
                        score={observation.quality_score}
                      />
                      {observation.acquisition && (
                        <small>
                          {observation.acquisition.device_name}
                          {" · "}
                          {observation.acquisition.width} x{" "}
                          {observation.acquisition.height}
                          {" · "}
                          Protocol r
                          {observation.acquisition.protocol_revision}
                          {" · "}
                          {observation.acquisition.protocol_status}
                        </small>
                      )}
                      {observation.notes && <small>{observation.notes}</small>}
                      {visiblePhotoQualityReason(observation.quality_reason) && (
                        <small>
                          {visiblePhotoQualityReason(observation.quality_reason)}
                        </small>
                      )}
                      <button
                        type="button"
                        className="observation-delete-action"
                        aria-label={`Delete microscope observation ${observation.id}`}
                        onClick={() => setPendingObservationDelete(observation)}
                      >
                        <Trash2 aria-hidden="true" size={15} />
                        Delete image
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="lesion-ai-detail">
            {!historyReady ? (
              <div className="empty-state">
                <p>
                  {loading
                    ? "Loading lesion history before AI evaluation."
                    : "Lesion history must load before AI evaluation is available."}
                </p>
              </div>
            ) : latestAccepted ? (
              <AIResultCard
                key={latestAccepted.id}
                observation={latestAccepted}
                onEvaluated={onChanged}
              />
            ) : (
              <div className="empty-state">
                <p>An accepted microscope capture is required before AI evaluation.</p>
              </div>
            )}
          </section>
        </div>

        <small className="safety-copy lesion-detail-safety">
          AI attention and automatic follow-up are screening aids, not a
          diagnosis. Experimental dates support local review planning only;
          clinician-directed checks take precedence.
        </small>
        {deletionMessage && (
          <p className="capture-message" aria-live="polite">
            {deletionMessage}
          </p>
        )}
        </div>
      </section>
      {pendingObservationDelete && (
        <ObservationDeleteDialog
          lesionCode={lesion.lesion_code}
          observation={pendingObservationDelete}
          onCancel={() => setPendingObservationDelete(null)}
          onConfirm={() => removeObservation(pendingObservationDelete)}
        />
      )}
    </div>,
    document.body,
  );
}
