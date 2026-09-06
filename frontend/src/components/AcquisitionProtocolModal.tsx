import {
  Palette,
  Ruler,
  Save,
  Upload,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { api } from "../api";
import type {
  AcquisitionSetup,
  AcquisitionSetupUpdate,
  ProtocolStatus,
} from "../types";

interface Props {
  setup: AcquisitionSetup;
  onClose: () => void;
  onUpdated: (setup: AcquisitionSetup) => void;
}

type ReferenceType = "scale" | "color";
type Operation = "save" | ReferenceType;

interface OperationFeedback {
  kind: "error" | "success";
  text: string;
}

export const protocolStatusLabels: Record<ProtocolStatus, string> = {
  incomplete: "Incomplete",
  reference_pending: "References pending",
  provisional: "Provisional",
  validated: "Validated",
};

function editableSetup(setup: AcquisitionSetup): AcquisitionSetupUpdate {
  return {
    name: setup.name,
    magnification_x: setup.magnification_x,
    orientation: setup.orientation,
    spacer_id: setup.spacer_id,
    illumination: setup.illumination,
    exposure: setup.exposure,
    gain: setup.gain,
    white_balance: setup.white_balance,
    focus_threshold: setup.focus_threshold,
    min_brightness: setup.min_brightness,
    max_brightness: setup.max_brightness,
    thresholds_status: setup.thresholds_status,
  };
}

export function AcquisitionProtocolModal({
  setup,
  onClose,
  onUpdated,
}: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef<Operation | null>(null);
  const mountedRef = useRef(true);
  const [draft, setDraft] = useState(() => editableSetup(setup));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<ReferenceType | null>(null);
  const [saveFeedback, setSaveFeedback] =
    useState<OperationFeedback | null>(null);
  const [referenceFeedback, setReferenceFeedback] = useState<
    Partial<Record<ReferenceType, OperationFeedback>>
  >({});

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    mountedRef.current = true;
    document.body.style.overflow = "hidden";
    firstFieldRef.current?.focus();
    return () => {
      mountedRef.current = false;
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const busy = saving || uploading !== null;

  function requestClose() {
    if (operationRef.current === null) onClose();
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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationRef.current !== null) return;
    operationRef.current = "save";
    setSaving(true);
    setSaveFeedback(null);
    try {
      const updated = await api.updateAcquisitionSetup(draft);
      if (!mountedRef.current) return;
      onUpdated(updated);
      setDraft(editableSetup(updated));
      setSaveFeedback({
        kind: "success",
        text: `Protocol revision ${updated.revision} saved.`,
      });
    } catch (error) {
      if (!mountedRef.current) return;
      setSaveFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Unable to save",
      });
    } finally {
      operationRef.current = null;
      if (mountedRef.current) setSaving(false);
    }
  }

  async function uploadReference(
    referenceType: ReferenceType,
    file: File | null,
  ) {
    if (!file || operationRef.current !== null) return;
    operationRef.current = referenceType;
    setUploading(referenceType);
    setReferenceFeedback((current) => ({
      ...current,
      [referenceType]: undefined,
    }));
    try {
      const updated = await api.uploadAcquisitionReference(
        referenceType,
        file,
      );
      if (!mountedRef.current) return;
      onUpdated(updated);
      setReferenceFeedback((current) => ({
        ...current,
        [referenceType]: {
          kind: "success",
          text: `${
            referenceType === "scale" ? "Scale" : "Color"
          } reference saved.`,
        },
      }));
    } catch (error) {
      if (!mountedRef.current) return;
      setReferenceFeedback((current) => ({
        ...current,
        [referenceType]: {
          kind: "error",
          text: error instanceof Error ? error.message : "Upload failed",
        },
      }));
    } finally {
      operationRef.current = null;
      if (mountedRef.current) setUploading(null);
    }
  }

  const referencesReady = Boolean(
    setup.scale_reference_path && setup.color_reference_path,
  );

  return (
    <div
      className="lesion-detail-backdrop protocol-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={dialogRef}
        className="protocol-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="protocol-title"
        onKeyDown={keepFocusInside}
      >
        <header className="protocol-header">
          <div>
            <p className="eyebrow">Microscope setup</p>
            <h2 id="protocol-title">Acquisition protocol</h2>
            <span>Revision {setup.revision}</span>
          </div>
          <div className="protocol-header-actions">
            <span className={`protocol-state ${setup.protocol_status}`}>
              {protocolStatusLabels[setup.protocol_status]}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Close acquisition protocol"
              title="Close"
              disabled={busy}
              onClick={requestClose}
            >
              <X aria-hidden="true" size={19} />
            </button>
          </div>
        </header>

        <p className="protocol-summary-note">
          This setup is optional for capture. Fill it when you want repeatable
          capture metadata. Its validation status is recorded with observations
          but does not block experimental AI evaluation.
        </p>

        <form onSubmit={save}>
        <section className="protocol-section">
          <div className="protocol-section-heading">
            <h3>Physical setup</h3>
            <span>Advanced settings (repeatability)</span>
          </div>
            <div className="protocol-form-grid">
              <label className="span-2">
                Protocol name
                <input
                  ref={firstFieldRef}
                  disabled={busy}
                  value={draft.name}
                  maxLength={128}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </label>
              <label>
                Magnification
                <div className="input-suffix">
                  <input
                    type="number"
                    disabled={busy}
                    min={1}
                    max={2000}
                    step={1}
                    value={draft.magnification_x ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        magnification_x: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  />
                  <span>x</span>
                </div>
              </label>
              <label>
                Spacer / contact guide ID
                <input
                  disabled={busy}
                  value={draft.spacer_id ?? ""}
                  maxLength={128}
                  placeholder="e.g. spacer-01"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      spacer_id: event.target.value || null,
                    })
                  }
                />
              </label>
              <label>
                Image orientation
                <select
                  disabled={busy}
                  value={draft.orientation}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      orientation: event.target.value as
                        | "cranial_up"
                        | "caudal_up",
                    })
                  }
                >
                  <option value="cranial_up">Cranial edge at top</option>
                  <option value="caudal_up">Caudal edge at top</option>
                </select>
              </label>
              <label>
                Illumination
                <select
                  disabled={busy}
                  value={draft.illumination}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      illumination: event.target.value as
                        AcquisitionSetupUpdate["illumination"],
                    })
                  }
                >
                  <option value="integrated_led">Integrated LED</option>
                  <option value="cross_polarized">Cross-polarized</option>
                  <option value="external_controlled">
                    Controlled external light
                  </option>
                </select>
              </label>
            </div>
          </section>

        <section className="protocol-section">
          <div className="protocol-section-heading">
            <h3>Camera controls</h3>
            <span>Optional fixed values</span>
            </div>
            <div className="protocol-form-grid three-column">
              <label>
                Exposure
                <input
                  type="number"
                  disabled={busy}
                  step="any"
                  value={draft.exposure ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      exposure: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </label>
              <label>
                Gain
                <input
                  type="number"
                  disabled={busy}
                  step="any"
                  value={draft.gain ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      gain: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </label>
              <label>
                White balance
                <input
                  type="number"
                  disabled={busy}
                  step="any"
                  value={draft.white_balance ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      white_balance: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </label>
            </div>
          </section>

        <section className="protocol-section">
          <div className="protocol-section-heading">
            <h3>Calibration references</h3>
            <span>Optional quality references</span>
            </div>
            <div className="reference-grid">
              <div className="reference-item">
                <div className="reference-preview">
                  {setup.scale_reference_path ? (
                    <img
                      src={`/media/${setup.scale_reference_path}`}
                      alt="Saved millimetre scale reference"
                    />
                  ) : (
                    <Ruler aria-hidden="true" size={28} />
                  )}
                </div>
                <div>
                  <strong>Millimetre scale</strong>
                  <span>
                    {setup.scale_reference_path
                      ? "Reference available"
                      : "Reference missing"}
                  </span>
                </div>
                <label
                  className={`reference-upload-button${busy ? " disabled" : ""}`}
                >
                  <Upload aria-hidden="true" size={16} />
                  {uploading === "scale" ? "Uploading…" : "Upload"}
                  <input
                    type="file"
                    aria-label="Upload millimetre scale reference"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    onChange={(event) => {
                      void uploadReference(
                        "scale",
                        event.target.files?.[0] ?? null,
                      );
                      event.target.value = "";
                    }}
                  />
                </label>
                {referenceFeedback.scale && (
                  <p
                    className={`reference-feedback ${referenceFeedback.scale.kind}`}
                    role={
                      referenceFeedback.scale.kind === "error"
                        ? "alert"
                        : "status"
                    }
                  >
                    {referenceFeedback.scale.text}
                  </p>
                )}
              </div>

              <div className="reference-item">
                <div className="reference-preview">
                  {setup.color_reference_path ? (
                    <img
                      src={`/media/${setup.color_reference_path}`}
                      alt="Saved color reference"
                    />
                  ) : (
                    <Palette aria-hidden="true" size={28} />
                  )}
                </div>
                <div>
                  <strong>Color reference</strong>
                  <span>
                    {setup.color_reference_path
                      ? "Reference available"
                      : "Reference missing"}
                  </span>
                </div>
                <label
                  className={`reference-upload-button${busy ? " disabled" : ""}`}
                >
                  <Upload aria-hidden="true" size={16} />
                  {uploading === "color" ? "Uploading…" : "Upload"}
                  <input
                    type="file"
                    aria-label="Upload color reference"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    onChange={(event) => {
                      void uploadReference(
                        "color",
                        event.target.files?.[0] ?? null,
                      );
                      event.target.value = "";
                    }}
                  />
                </label>
                {referenceFeedback.color && (
                  <p
                    className={`reference-feedback ${referenceFeedback.color.kind}`}
                    role={
                      referenceFeedback.color.kind === "error"
                        ? "alert"
                        : "status"
                    }
                  >
                    {referenceFeedback.color.text}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="protocol-section">
            <div className="protocol-section-heading">
              <h3>Quality thresholds</h3>
              <span>Applied and stored with each image</span>
            </div>
            <div className="protocol-form-grid threshold-grid">
              <label>
                Focus minimum
                <input
                  type="number"
                  disabled={busy}
                  min={0}
                  step="any"
                  value={draft.focus_threshold}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      focus_threshold: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Brightness minimum
                <input
                  type="number"
                  disabled={busy}
                  min={0}
                  max={255}
                  step="any"
                  value={draft.min_brightness}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      min_brightness: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Brightness maximum
                <input
                  type="number"
                  disabled={busy}
                  min={0}
                  max={255}
                  step="any"
                  value={draft.max_brightness}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      max_brightness: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Threshold status
                <select
                  disabled={busy}
                  value={draft.thresholds_status}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      thresholds_status: event.target.value as
                        | "provisional"
                        | "calibrated",
                    })
                  }
                >
                  <option value="provisional">Provisional</option>
                  <option value="calibrated" disabled={!referencesReady}>
                    Calibrated on selected hardware
                  </option>
                </select>
              </label>
            </div>
          </section>

          <footer className="protocol-footer">
            {saveFeedback ? (
              <p
                className={`protocol-feedback ${saveFeedback.kind}`}
                role={saveFeedback.kind === "error" ? "alert" : "status"}
              >
                {saveFeedback.text}
              </p>
            ) : (
              <span>
                Saving creates revision {setup.revision + 1}; prior observation
                records remain unchanged.
              </span>
            )}
            <button
              type="submit"
              className="protocol-save"
              disabled={busy}
            >
              <Save aria-hidden="true" size={17} />
              {saving
                ? "Saving…"
                : saveFeedback?.kind === "error"
                  ? "Retry save"
                  : "Save new revision"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
