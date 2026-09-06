import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { Camera, Check, CircleAlert, LoaderCircle, MapPin, Trash2 } from "lucide-react";
import { api } from "../api";
import { visiblePhotoQualityReason } from "../imageQuality";
import { errorMessage } from "../mutationFeedback";
import type { ClinicalPhotoCandidate } from "../types";
import { PhotoQuality } from "./PhotoQuality";

interface Props {
  patientId: number;
  selectedCandidate: ClinicalPhotoCandidate | null;
  revision: number;
  assignmentMessage: string;
  onAssignRequested: (candidate: ClinicalPhotoCandidate) => void;
  onCancelAssignment: () => void;
}

export function ClinicalPhotoBatch({
  patientId,
  selectedCandidate,
  revision,
  assignmentMessage,
  onAssignRequested,
  onCancelAssignment,
}: Props) {
  const [candidates, setCandidates] = useState<ClinicalPhotoCandidate[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const requestRevision = useRef(0);

  async function loadCandidates() {
    const request = ++requestRevision.current;
    setLoading(true);
    try {
      const items = await api.listClinicalPhotoCandidates(patientId);
      if (request === requestRevision.current) {
        setCandidates(
          [...items].sort(
            (left, right) =>
              right.quality_score - left.quality_score ||
              right.detection_score - left.detection_score,
          ),
        );
      }
    } catch (reason) {
      if (request === requestRevision.current) {
        setMessage(errorMessage(reason, "Candidate queue unavailable"));
      }
    } finally {
      if (request === requestRevision.current) setLoading(false);
    }
  }

  useEffect(() => {
    setCandidates([]);
    setFile(null);
    setMessage("");
    void loadCandidates();
    return () => {
      requestRevision.current += 1;
    };
  }, [patientId, revision]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setMessage("");
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      const photo = await api.uploadClinicalPhoto(patientId, file);
      const count = photo.candidates.length;
      setMessage(
        count
          ? `Photo saved · quality ${Math.round(photo.quality_score)}% · ${count} candidate${count === 1 ? "" : "s"} proposed.`
          : `Photo saved · quality ${Math.round(photo.quality_score)}% · no candidate at or above 50% quality. Try a closer, evenly lit photo.`,
      );
      setFile(null);
      await loadCandidates();
    } catch (reason) {
      setMessage(errorMessage(reason, "Clinical photo upload failed"));
    } finally {
      setUploading(false);
    }
  }

  async function dismiss(candidate: ClinicalPhotoCandidate) {
    try {
      await api.dismissClinicalPhotoCandidate(candidate.id);
      setCandidates((items) => items.filter((item) => item.id !== candidate.id));
      if (selectedCandidate?.id === candidate.id) onCancelAssignment();
    } catch (reason) {
      setMessage(errorMessage(reason, "Candidate could not be dismissed"));
    }
  }

  return (
    <section className="clinical-photo-panel panel" aria-labelledby="clinical-photo-title">
      <div className="clinical-photo-heading">
        <div>
          <p className="eyebrow">New recommended workflow</p>
          <h3 id="clinical-photo-title">HD / 4K multi-lesion photo</h3>
          <p>
            Upload one clear skin photo. Express-Derm keeps its quality score and
            proposes separate lesion crops for operator confirmation.
          </p>
        </div>
        <form className="clinical-photo-upload" onSubmit={upload}>
          <label>
            Patient photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={chooseFile}
              disabled={uploading}
            />
          </label>
          <button type="submit" disabled={!file || uploading}>
            {uploading ? (
              <LoaderCircle aria-hidden="true" size={17} />
            ) : (
              <Camera aria-hidden="true" size={17} />
            )}
            {uploading ? "Finding candidates…" : "Save and find lesions"}
          </button>
        </form>
      </div>

      {(message || assignmentMessage) && (
        <div className="clinical-photo-message" role="status">
          {assignmentMessage ? <Check aria-hidden="true" size={17} /> : <CircleAlert aria-hidden="true" size={17} />}
          <span>{assignmentMessage || message}</span>
        </div>
      )}

      {selectedCandidate && (
        <div className="clinical-assignment-banner" role="status">
          <MapPin aria-hidden="true" size={18} />
          <strong>Candidate {selectedCandidate.candidate_index} selected.</strong>
          <span>Click its anatomical position on the 3D body.</span>
          <button type="button" onClick={onCancelAssignment}>Cancel</button>
        </div>
      )}

      {loading ? (
        <p className="clinical-photo-empty"><LoaderCircle aria-hidden="true" size={17} /> Loading pending candidates…</p>
      ) : candidates.length === 0 ? (
        <p className="clinical-photo-empty">No lesion candidates are waiting for BodyMap assignment.</p>
      ) : (
        <div
          className="clinical-candidate-list"
          role="region"
          aria-label="Pending lesion candidates, ordered by photo quality"
          tabIndex={0}
        >
          {candidates.map((candidate) => (
            <article
              key={candidate.id}
              className={selectedCandidate?.id === candidate.id ? "selected" : ""}
            >
              <img
                src={`/media/${candidate.crop_image_path}`}
                alt={`Automatically proposed lesion candidate ${candidate.candidate_index}`}
                loading="lazy"
                decoding="async"
              />
              <div className="clinical-candidate-copy">
                <strong>Candidate {candidate.candidate_index}</strong>
                <PhotoQuality score={candidate.quality_score} compact />
                <small
                  title="Visual contrast and shape prominence only; this is not medical risk or AI confidence."
                >
                  Visual prominence {Math.round(candidate.detection_score)}%
                </small>
                <small>
                  Contrast/shape visibility only — not medical risk.
                </small>
                {visiblePhotoQualityReason(candidate.quality_reason) && (
                  <small>
                    {visiblePhotoQualityReason(candidate.quality_reason)}
                  </small>
                )}
              </div>
              <div className="clinical-candidate-actions">
                <button type="button" onClick={() => onAssignRequested(candidate)}>
                  <MapPin aria-hidden="true" size={16} /> Assign on BodyMap
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={`Dismiss candidate ${candidate.candidate_index}`}
                  onClick={() => void dismiss(candidate)}
                >
                  <Trash2 aria-hidden="true" size={16} /> Dismiss
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <small className="clinical-photo-disclaimer">
        Candidate detection is an editable image-processing aid, not a diagnosis.
        Crops below 50% quality are discarded automatically. Confirm or dismiss
        every remaining proposal before using it as a lesion record.
      </small>
    </section>
  );
}
