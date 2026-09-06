import { FormEvent, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  FolderOpen,
  LoaderCircle,
  Move3d,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import { formatBodyRegion } from "../bodyRegions";
import { errorMessage, savedWithRefreshWarning } from "../mutationFeedback";
import {
  savedPhotoQualityMessage,
  visiblePhotoQualityReason,
} from "../imageQuality";
import { aiIneligibilityReason } from "../observationProvenance";
import { followUpLabels, formatDate } from "../risk";
import type {
  Lesion,
  LesionEditableState,
  Observation,
  Patient,
} from "../types";
import { AIResultCard } from "./AIResultCard";
import { CameraCapture } from "./CameraCapture";
import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";
import { ObservationDeleteDialog } from "./ObservationDeleteDialog";
import { PhotoQuality } from "./PhotoQuality";
import { RiskBadge } from "./RiskBadge";

interface Props {
  patient: Patient | null;
  lesions: Lesion[];
  selectedLesion: Lesion | null;
  onSelectLesion: (lesion: Lesion) => void;
  onOpenLesion: (lesion: Lesion) => void;
  onDeleteLesion: (lesion: Lesion) => Promise<void>;
  onLesionChanged: () => Promise<void>;
  onUpdateLesion: (
    lesion: Lesion,
    values: LesionEditableState,
  ) => Promise<Lesion>;
  repositioningLesionId: number | null;
  onStartReposition: (lesion: Lesion) => void;
  onCancelReposition: () => void;
}

export function LesionPanel({
  patient,
  lesions,
  selectedLesion,
  onSelectLesion,
  onOpenLesion,
  onDeleteLesion,
  onLesionChanged,
  onUpdateLesion,
  repositioningLesionId,
  onStartReposition,
  onCancelReposition,
}: Props) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [observationsLoadedFor, setObservationsLoadedFor] = useState<
    number | null
  >(null);
  const [observationsLoadingFor, setObservationsLoadingFor] = useState<
    number | null
  >(selectedLesion?.id ?? null);
  const [observationLoadError, setObservationLoadError] = useState<{
    lesionId: number;
    message: string;
  } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Lesion | null>(null);
  const [pendingObservationDelete, setPendingObservationDelete] =
    useState<Observation | null>(null);
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingDetailsForId, setSavingDetailsForId] = useState<number | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);
  const [microscopeSourceConfirmed, setMicroscopeSourceConfirmed] =
    useState(false);
  const [captureSource, setCaptureSource] = useState<"camera" | "upload">(
    "camera",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeLesionIdRef = useRef<number | null>(selectedLesion?.id ?? null);
  const observationRequestRef = useRef(0);
  const detailsSaveRevisionRef = useRef(0);
  const detailsSaveOperationRef = useRef<{
    lesionId: number;
    revision: number;
  } | null>(null);
  activeLesionIdRef.current = selectedLesion?.id ?? null;
  const saving = savingDetailsForId === selectedLesion?.id;

  async function refreshObservations(lesionId: number | null) {
    if (activeLesionIdRef.current !== lesionId) return;

    const requestId = ++observationRequestRef.current;
    if (lesionId === null) {
      if (activeLesionIdRef.current === null) {
        setObservations([]);
        setObservationsLoadedFor(null);
        setObservationsLoadingFor(null);
        setObservationLoadError(null);
      }
      return;
    }
    setObservationsLoadingFor(lesionId);
    setObservationLoadError(null);
    try {
      const items = await api.listObservations(lesionId);
      if (
        activeLesionIdRef.current === lesionId &&
        observationRequestRef.current === requestId
      ) {
        setObservations(items);
        setObservationsLoadedFor(lesionId);
      }
    } catch (error) {
      if (
        activeLesionIdRef.current !== lesionId ||
        observationRequestRef.current !== requestId
      ) {
        return;
      }
      setObservationLoadError({
        lesionId,
        message: errorMessage(error, "Observation history unavailable"),
      });
      throw error;
    } finally {
      if (
        activeLesionIdRef.current === lesionId &&
        observationRequestRef.current === requestId
      ) {
        setObservationsLoadingFor(null);
      }
    }
  }

  useEffect(() => {
    const lesionId = selectedLesion?.id ?? null;
    setObservations([]);
    setObservationsLoadedFor(null);
    setObservationLoadError(null);
    void refreshObservations(lesionId).catch(() => undefined);
    return () => {
      observationRequestRef.current += 1;
    };
  }, [selectedLesion?.id]);

  useEffect(() => {
    detailsSaveRevisionRef.current += 1;
    detailsSaveOperationRef.current = null;
    setSavingDetailsForId(null);
    setEditing(false);
    setEditLabel(selectedLesion?.label ?? "");
    setEditNotes(selectedLesion?.notes ?? "");
    setFile(null);
    setNotes("");
    setMessage("");
    setUploading(false);
    setMicroscopeSourceConfirmed(false);
    setCaptureSource("camera");
    setPendingObservationDelete(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [selectedLesion?.id]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!selectedLesion || !file) return;
    const lesionId = selectedLesion.id;
    setUploading(true);
    setMessage("");
    try {
      const observation = await api.uploadObservation(
        lesionId,
        file,
        notes,
        microscopeSourceConfirmed,
      );
      const savedMessage = savedPhotoQualityMessage(
        observation.quality_score,
      );
      if (activeLesionIdRef.current === lesionId) {
        setMessage(savedMessage);
        setFile(null);
        setNotes("");
        setMicroscopeSourceConfirmed(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
      try {
        const aiResult = await recordChanged(lesionId, observation);
        if (activeLesionIdRef.current === lesionId && aiResult?.evaluated) {
          setMessage(`${savedMessage} Experimental assessment saved.`);
        } else if (
          activeLesionIdRef.current === lesionId &&
          aiResult?.error
        ) {
          setMessage(`${savedMessage} AI assessment unavailable: ${aiResult.error}`);
        }
      } catch (error) {
        if (activeLesionIdRef.current === lesionId) {
          setMessage(savedWithRefreshWarning(savedMessage, error));
        }
      }
    } catch (error) {
      if (activeLesionIdRef.current === lesionId) {
        setMessage(errorMessage(error, "Upload failed"));
      }
    } finally {
      if (activeLesionIdRef.current === lesionId) setUploading(false);
    }
  }

  async function recordChanged(lesionId: number, observation?: Observation) {
    const aiResult = observation
      ? await automaticallyEvaluate(observation)
      : null;
    await Promise.all([
      refreshObservations(lesionId),
      onLesionChanged(),
    ]);
    return aiResult;
  }

  async function automaticallyEvaluate(observation: Observation) {
    const ineligibilityReason = aiIneligibilityReason(observation);
    if (ineligibilityReason) {
      return { evaluated: false as const, error: ineligibilityReason };
    }

    try {
      const status = await api.aiStatus();
      if (!status.ready) {
        return {
          evaluated: false as const,
          error: status.reason ?? "The configured model is not ready.",
        };
      }
      await api.evaluateObservation(observation.id);
      return { evaluated: true as const, error: null };
    } catch (error) {
      return {
        evaluated: false as const,
        error: errorMessage(error, "model unavailable"),
      };
    }
  }

  async function remove(lesion: Lesion) {
    setDeletingId(lesion.id);
    try {
      await onDeleteLesion(lesion);
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  }

  async function removeObservation(observation: Observation) {
    const lesionId = observation.lesion_id;
    const deletedMessage = "Microscope image deleted. Lesion retained.";
    await api.deleteObservation(observation.id);
    setPendingObservationDelete(null);

    if (activeLesionIdRef.current === lesionId) {
      setObservations((current) =>
        current.filter((item) => item.id !== observation.id),
      );
      setMessage(deletedMessage);
    }
    try {
      await Promise.all([
        activeLesionIdRef.current === lesionId
          ? refreshObservations(lesionId)
          : Promise.resolve(),
        onLesionChanged(),
      ]);
    } catch (error) {
      if (activeLesionIdRef.current === lesionId) {
        setMessage(savedWithRefreshWarning(deletedMessage, error));
      }
    }
  }

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    if (!selectedLesion) return;
    const lesion = selectedLesion;
    const lesionId = lesion.id;
    if (detailsSaveOperationRef.current?.lesionId === lesionId) return;
    const operation = {
      lesionId,
      revision: detailsSaveRevisionRef.current + 1,
    };
    detailsSaveRevisionRef.current = operation.revision;
    detailsSaveOperationRef.current = operation;
    setSavingDetailsForId(lesionId);
    setMessage("");
    try {
      await onUpdateLesion(lesion, {
        body_part: lesion.body_part,
        x: lesion.x,
        y: lesion.y,
        z: lesion.z,
        label: editLabel.trim() || null,
        notes: editNotes.trim() || null,
      });
      if (
        activeLesionIdRef.current !== lesionId ||
        detailsSaveOperationRef.current !== operation
      ) {
        return;
      }
      setEditing(false);
      setMessage("Lesion details updated.");
    } catch (error) {
      if (
        activeLesionIdRef.current !== lesionId ||
        detailsSaveOperationRef.current !== operation
      ) {
        return;
      }
      setMessage(
        error instanceof Error ? error.message : "Unable to update lesion",
      );
    } finally {
      if (detailsSaveOperationRef.current === operation) {
        detailsSaveOperationRef.current = null;
        setSavingDetailsForId(null);
      }
    }
  }

  const selectedLesionId = selectedLesion?.id ?? null;
  const observationHistoryReady =
    selectedLesionId !== null &&
    observationsLoadedFor === selectedLesionId;
  const currentObservationError =
    observationLoadError?.lesionId === selectedLesionId
      ? observationLoadError.message
      : "";
  const observationHistoryLoading =
    selectedLesionId !== null &&
    (observationsLoadingFor === selectedLesionId ||
      (!observationHistoryReady && !currentObservationError));
  const visibleObservations = observationHistoryReady ? observations : [];
  const latestAccepted = visibleObservations.find(
    (observation) => observation.quality_status === "accepted",
  );

  return (
    <aside className="panel lesion-panel">
      <div className="panel-heading">
        <p className="eyebrow">Longitudinal record</p>
        <h2>{patient ? patient.patient_code : "No patient"}</h2>
      </div>

      <div className="lesion-list">
        {lesions.map((lesion) => (
          <div className="entity-row" key={lesion.id}>
            <button
              type="button"
              className={selectedLesion?.id === lesion.id ? "lesion active" : "lesion"}
              onClick={() => onSelectLesion(lesion)}
              disabled={deletingId === lesion.id}
            >
              <strong>{lesion.lesion_code}</strong>
              <span>{formatBodyRegion(lesion.body_part)}</span>
            </button>
            <button
              type="button"
              className="icon-button danger"
              aria-label={`Delete lesion ${lesion.lesion_code}`}
              title={`Delete lesion ${lesion.lesion_code}`}
              disabled={deletingId !== null}
              onClick={() => setPendingDelete(lesion)}
            >
              <Trash2 aria-hidden="true" size={17} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

      {!selectedLesion ? (
        <div className="empty-state">
          <p>Select a marker or click the body map to create one.</p>
        </div>
      ) : (
        <>
          <div className="selected-lesion">
            <div className="row-between">
              <div>
                <p className="eyebrow">Selected lesion</p>
                <h3>{selectedLesion.lesion_code}</h3>
                <p>{formatBodyRegion(selectedLesion.body_part)}</p>
                {selectedLesion.label && (
                  <small>{selectedLesion.label}</small>
                )}
              </div>
              <div className="selected-lesion-toolbar">
                <RiskBadge
                  level={selectedLesion.attention_level}
                  status={selectedLesion.risk_status}
                />
                <div className="selected-lesion-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Open full record for ${selectedLesion.lesion_code}`}
                    title="Open full lesion record"
                    disabled={saving}
                    onClick={() => {
                      setEditing(false);
                      if (repositioningLesionId === selectedLesion.id) {
                        onCancelReposition();
                      }
                      onOpenLesion(selectedLesion);
                    }}
                  >
                    <FolderOpen
                      aria-hidden="true"
                      size={17}
                      strokeWidth={2}
                    />
                  </button>
                  <button
                    type="button"
                    className={editing ? "icon-button active" : "icon-button"}
                    aria-label={
                      editing
                        ? `Cancel editing ${selectedLesion.lesion_code}`
                        : `Edit ${selectedLesion.lesion_code} details`
                    }
                    title={editing ? "Cancel editing" : "Edit lesion details"}
                    disabled={saving}
                    onClick={() => {
                      if (editing) {
                        setEditing(false);
                        setEditLabel(selectedLesion.label ?? "");
                        setEditNotes(selectedLesion.notes ?? "");
                      } else {
                        if (
                          repositioningLesionId === selectedLesion.id
                        ) {
                          onCancelReposition();
                        }
                        setEditing(true);
                      }
                    }}
                  >
                    {editing ? (
                      <X aria-hidden="true" size={17} />
                    ) : (
                      <Pencil aria-hidden="true" size={16} />
                    )}
                  </button>
                  <button
                    type="button"
                    className={
                      repositioningLesionId === selectedLesion.id
                        ? "icon-button active"
                        : "icon-button"
                    }
                    aria-label={
                      repositioningLesionId === selectedLesion.id
                        ? `Cancel repositioning ${selectedLesion.lesion_code}`
                        : `Reposition ${selectedLesion.lesion_code}`
                    }
                    title={
                      repositioningLesionId === selectedLesion.id
                        ? "Cancel repositioning"
                        : "Reposition marker"
                    }
                    disabled={saving}
                    onClick={() => {
                      setEditing(false);
                      if (repositioningLesionId === selectedLesion.id) {
                        onCancelReposition();
                      } else {
                        onStartReposition(selectedLesion);
                      }
                    }}
                  >
                    {repositioningLesionId === selectedLesion.id ? (
                      <X aria-hidden="true" size={17} />
                    ) : (
                      <Move3d aria-hidden="true" size={17} />
                    )}
                  </button>
                </div>
              </div>
            </div>
            {editing && (
              <form
                className="lesion-edit-form"
                aria-busy={saving}
                aria-label={`Edit details for ${selectedLesion.lesion_code}`}
                onSubmit={saveDetails}
              >
                <label>
                  Label
                  <input
                    disabled={saving}
                    value={editLabel}
                    maxLength={128}
                    onChange={(event) => setEditLabel(event.target.value)}
                    placeholder="Optional display label"
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    disabled={saving}
                    value={editNotes}
                    rows={3}
                    onChange={(event) => setEditNotes(event.target.value)}
                    placeholder="Optional lesion notes"
                  />
                </label>
                <button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </form>
            )}
            <dl className="selected-lesion-follow-up">
              <div>
                <dt>Follow-up</dt>
                <dd>{followUpLabels[selectedLesion.follow_up_action]}</dd>
              </div>
              <div>
                <dt>Next check</dt>
                <dd>{formatDate(selectedLesion.next_check_at)}</dd>
              </div>
            </dl>
          </div>

          <div className="capture-source-card stack">
            <div>
              <p className="eyebrow">New microscope observation</p>
              <h3>Choose image source</h3>
            </div>
            <label>
              Image source
              <select
                value={captureSource}
                disabled={uploading}
                onChange={(event) => {
                  const nextSource = event.target.value as "camera" | "upload";
                  setCaptureSource(nextSource);
                  setMessage("");
                  if (nextSource === "camera") {
                    setFile(null);
                    setNotes("");
                    setMicroscopeSourceConfirmed(false);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }
                }}
              >
                <option value="camera">Live USB microscope</option>
                <option value="upload">Upload microscope file</option>
              </select>
            </label>
            <small className="muted">
              Every decodable microscope image is saved. Focus, exposure and
              clipping determine an advisory quality score from 0 to 100%.
            </small>
          </div>

          {captureSource === "camera" ? (
            <CameraCapture
              lesionId={selectedLesion.id}
              onSaved={(observation) =>
                recordChanged(selectedLesion.id, observation)
              }
            />
          ) : (
            <form
              id="manual-microscope-upload"
              className="upload-card stack"
              onSubmit={upload}
            >
              <h3>Upload microscope file</h3>
              <label>
                Image file
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <label>
                Observation notes (optional)
                <textarea
                  value={notes}
                  disabled={uploading}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Observation notes"
                  rows={3}
                />
              </label>
              <label className="upload-source-confirmation">
                <input
                  type="checkbox"
                  checked={microscopeSourceConfirmed}
                  disabled={uploading}
                  onChange={(event) =>
                    setMicroscopeSourceConfirmed(event.target.checked)
                  }
                />
                <span>I confirm this file is a USB-microscope image.</span>
              </label>
              <small className="muted">
                Body photos and other non-microscope images are not accepted.
              </small>
              <button disabled={!file || uploading || !microscopeSourceConfirmed}>
                {uploading ? "Scoring image…" : "Save, score and analyze"}
              </button>
            </form>
          )}

          {message && (
            <p className="capture-message" aria-live="polite">
              {message}
            </p>
          )}

          {latestAccepted &&
            !observationHistoryLoading &&
            !currentObservationError && (
              <AIResultCard
                key={latestAccepted.id}
                observation={latestAccepted}
                onEvaluated={onLesionChanged}
              />
            )}

          <div className="history">
            <div className="row-between">
              <h3>History</h3>
              <span className="observation-history-count" aria-live="polite">
                {observationHistoryLoading && observationHistoryReady && (
                  <LoaderCircle
                    aria-hidden="true"
                    className="rotating"
                    size={14}
                  />
                )}
                {observationHistoryReady
                  ? observations.length
                  : currentObservationError
                    ? "Unavailable"
                    : "Loading"}
              </span>
            </div>
            {currentObservationError && (
              <div className="observation-history-error" role="alert">
                <CircleAlert aria-hidden="true" size={18} />
                <div>
                  <strong>Observation history unavailable</strong>
                  <span>{currentObservationError}</span>
                </div>
                <button
                  type="button"
                  aria-label="Retry observation history"
                  disabled={observationHistoryLoading}
                  onClick={() => {
                    if (selectedLesionId !== null) {
                      void refreshObservations(selectedLesionId).catch(
                        () => undefined,
                      );
                    }
                  }}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={observationHistoryLoading ? "rotating" : ""}
                    size={16}
                  />
                  {observationHistoryLoading ? "Retrying…" : "Retry"}
                </button>
              </div>
            )}
            {observationHistoryLoading && !observationHistoryReady && (
              <p className="observation-history-state" role="status">
                <LoaderCircle
                  aria-hidden="true"
                  className="rotating"
                  size={17}
                />
                Loading observation history.
              </p>
            )}
            {observationHistoryReady && observations.length === 0 && (
              <p className="observation-history-state">
                No microscope observations saved.
              </p>
            )}
            {visibleObservations.map((observation) => (
              <article className="observation" key={observation.id}>
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
                      {observation.acquisition.width} x{" "}
                      {observation.acquisition.height}
                      {observation.acquisition.magnification_x
                        ? ` · ${observation.acquisition.magnification_x}x`
                        : ""}
                      {` · Protocol r${observation.acquisition.protocol_revision}`}
                    </small>
                  )}
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
        </>
      )}
      {pendingDelete && (
        <DeleteConfirmationDialog
          title={`Delete lesion ${pendingDelete.lesion_code}?`}
          recordCode={pendingDelete.lesion_code}
          description="This permanently removes the mapped lesion, its observation and model-run history, audit events, visual reviews and all associated microscope images."
          impacts={[
            {
              label: "Location",
              value: formatBodyRegion(pendingDelete.body_part),
            },
            {
              label: "Observations",
              value: pendingDelete.observation_count,
            },
            {
              label: "Accepted captures",
              value: pendingDelete.accepted_observation_count,
            },
          ]}
          confirmLabel="Delete lesion"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => remove(pendingDelete)}
        />
      )}
      {pendingObservationDelete && selectedLesion && (
        <ObservationDeleteDialog
          lesionCode={selectedLesion.lesion_code}
          observation={pendingObservationDelete}
          onCancel={() => setPendingObservationDelete(null)}
          onConfirm={() => removeObservation(pendingObservationDelete)}
        />
      )}
    </aside>
  );
}
