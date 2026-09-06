import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { visiblePhotoQualityReason } from "../imageQuality";
import { errorMessage, savedWithRefreshWarning } from "../mutationFeedback";
import { attentionLabels } from "../risk";
import {
  hasConfirmedMicroscopeSource,
  inferUploadSourceType,
  isAIEligibleObservation,
} from "../observationProvenance";
import type {
  AIStatus,
  DualAIResultPayload,
  ModelRun,
  Observation,
} from "../types";
import { PhotoQuality } from "./PhotoQuality";

interface Props {
  observation: Observation;
  onEvaluated?: () => Promise<void>;
}

const combinedLabels = {
  high_confirmed: "High confirmed",
  review: "Review",
  no_elevated_signal: "No elevated signal",
} as const;

function parseDualResult(resultJson: string): DualAIResultPayload | null {
  try {
    const payload = JSON.parse(resultJson) as Partial<DualAIResultPayload>;
    if (
      payload.decision_policy_version !==
        "dual-center-scale-confirmation-v1" ||
      !payload.signals?.melanoma_attention ||
      !payload.signals?.broad_malignancy_attention ||
      !payload.combined_label
    ) {
      return null;
    }
    return payload as DualAIResultPayload;
  } catch {
    return null;
  }
}

export function AIResultCard({ observation, onEvaluated }: Props) {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [runs, setRuns] = useState<ModelRun[]>([]);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const loadRevision = useRef(0);
  const activeObservationId = useRef<number | null>(observation.id);
  activeObservationId.current = observation.id;

  async function refresh() {
    const observationId = observation.id;
    if (activeObservationId.current !== observationId) return;

    const revision = loadRevision.current + 1;
    loadRevision.current = revision;
    setLoading(true);
    setLoadError("");
    try {
      const [nextStatus, nextRuns] = await Promise.all([
        api.aiStatus(),
        api.listEvaluations(observationId),
      ]);
      if (
        activeObservationId.current !== observationId ||
        loadRevision.current !== revision
      ) {
        return;
      }
      setStatus(nextStatus);
      setRuns(nextRuns);
      setDataReady(true);
    } catch (error) {
      if (
        activeObservationId.current !== observationId ||
        loadRevision.current !== revision
      ) {
        return;
      }
      setLoadError(errorMessage(error, "AI assessment data unavailable"));
      throw error;
    } finally {
      if (
        activeObservationId.current === observationId &&
        loadRevision.current === revision
      ) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    // React StrictMode runs an effect setup, cleanup and setup again during
    // development. The cleanup clears the active observation, so every setup
    // must restore it before starting the request.
    activeObservationId.current = observation.id;
    setStatus(null);
    setRuns([]);
    setMessage("");
    setRunning(false);
    setDataReady(false);
    setLoadError("");
    void refresh().catch(() => undefined);
    return () => {
      loadRevision.current += 1;
      if (activeObservationId.current === observation.id) {
        activeObservationId.current = null;
      }
    };
  }, [observation.id]);

  async function evaluate() {
    const observationId = observation.id;
    setRunning(true);
    setMessage("");
    try {
      await api.evaluateObservation(observationId);
      const savedMessage = "Experimental assessment saved.";
      if (activeObservationId.current === observationId) {
        setMessage(savedMessage);
      }
      const refreshes = await Promise.allSettled([
        refresh(),
        onEvaluated?.() ?? Promise.resolve(),
      ]);
      const failedRefresh = refreshes.find(
        (result) => result.status === "rejected",
      );
      if (
        activeObservationId.current === observationId &&
        failedRefresh?.status === "rejected"
      ) {
        setMessage(savedWithRefreshWarning(savedMessage, failedRefresh.reason));
      }
    } catch (error) {
      if (activeObservationId.current === observationId) {
        setMessage(errorMessage(error, "Evaluation failed"));
      }
    } finally {
      if (activeObservationId.current === observationId) {
        setRunning(false);
      }
    }
  }

  const latest = runs[0];
  const dualResult = latest ? parseDualResult(latest.result_json) : null;
  const sourceType = inferUploadSourceType(observation);
  const sourceConfirmed = hasConfirmedMicroscopeSource(observation);
  const eligible = isAIEligibleObservation(observation);
  const qualityReason = visiblePhotoQualityReason(observation.quality_reason);

  return (
    <section className="ai-card">
      <div className="row-between">
        <div>
          <p className="eyebrow">Experimental AI screening</p>
          <h3>Lesion assessment</h3>
        </div>
        <span
          className={dataReady && status?.ready ? "dot online" : "dot"}
          title={
            loading
              ? "Checking AI availability"
              : dataReady && status?.ready
                ? "AI available"
                : "AI unavailable"
          }
        />
      </div>

      <PhotoQuality score={observation.quality_score} />
      {qualityReason && (
        <p className="photo-quality-warning">
          {qualityReason}. Interpret the experimental result with
          additional caution.
        </p>
      )}

      {!dataReady && loading ? (
        <p className="ai-load-state" role="status">
          <LoaderCircle aria-hidden="true" className="rotating" size={17} />
          Loading model status and evaluation history.
        </p>
      ) : !dataReady && loadError ? (
        <div className="ai-load-error" role="alert">
          <CircleAlert aria-hidden="true" size={18} />
          <div>
            <strong>Assessment data unavailable</strong>
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            className="ai-load-retry"
            onClick={() => void refresh().catch(() => undefined)}
            disabled={loading}
          >
            <RefreshCw
              aria-hidden="true"
              className={loading ? "rotating" : ""}
              size={16}
            />
            {loading ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : latest ? (
        <div className="ai-result">
          <span className={`attention ${latest.attention_level}`}>
            {dualResult
              ? combinedLabels[dualResult.combined_label]
              : attentionLabels[latest.attention_level]}
          </span>
          {dualResult && (
            <div className="ai-signal-grid">
              <div>
                <span>Melanoma attention</span>
                <strong>
                  {
                    attentionLabels[
                      dualResult.signals.melanoma_attention.consensus_level
                    ]
                  }
                </strong>
              </div>
              <div>
                <span>BCC / SCC / AK attention</span>
                <strong>
                  {
                    attentionLabels[
                      dualResult.signals.broad_malignancy_attention
                        .consensus_level
                    ]
                  }
                </strong>
              </div>
            </div>
          )}
          {latest.abstained && (
            <p className="capture-message">
              {dualResult ? "Review result" : "Inconclusive result"}:{" "}
              {latest.abstention_reason}
            </p>
          )}
        </div>
      ) : !status?.ready ? (
        <p className="muted">
          {status?.reason || "Model status unavailable."}
        </p>
      ) : (
        <p className="muted">No model evaluation has been saved.</p>
      )}

      {dataReady && loading && (
        <p className="ai-load-state" role="status">
          <LoaderCircle aria-hidden="true" className="rotating" size={17} />
          Refreshing assessment data.
        </p>
      )}

      {dataReady && loadError && (
        <div className="ai-load-error cached" role="alert">
          <CircleAlert aria-hidden="true" size={18} />
          <div>
            <strong>Assessment data could not be refreshed</strong>
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            className="ai-load-retry"
            onClick={() => void refresh().catch(() => undefined)}
            disabled={loading}
          >
            <RefreshCw
              aria-hidden="true"
              className={loading ? "rotating" : ""}
              size={16}
            />
            {loading ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {sourceType === "unknown" && (
        <p className="muted">
          Legacy manual upload: source confirmation is missing. AI cannot be used
          safely.
        </p>
      )}

      {!sourceConfirmed && sourceType !== "unknown" && (
        <p className="muted">
          This upload is not a confirmed microscope image. AI is disabled for this
          source until validation data is collected for this image domain.
        </p>
      )}

      <button
        type="button"
        onClick={evaluate}
        disabled={
          !dataReady ||
          loading ||
          Boolean(loadError) ||
          !status?.ready ||
          running ||
          !eligible
        }
      >
        {running ? "Evaluating…" : "Run experimental assessment"}
      </button>

      {dataReady && runs.length > 0 && (
        <details className="ai-run-history">
          <summary>Evaluation history ({runs.length})</summary>
          <div>
            {runs.map((run) => (
              <article key={run.id}>
                <div>
                  <strong>{run.model_version}</strong>
                  <time dateTime={run.created_at}>
                    {new Date(run.created_at).toLocaleString()}
                  </time>
                </div>
                <span className={`attention ${run.attention_level}`}>
                  {attentionLabels[run.attention_level]}
                </span>
                <span>{run.validation_status}</span>
              </article>
            ))}
          </div>
        </details>
      )}

      <small className="safety-copy">
        Research prototype. This result is not a diagnosis and does not exclude
        the need for professional review.
      </small>
      {message && (
        <p className="capture-message" aria-live="polite">
          {message}
        </p>
      )}
    </section>
  );
}
