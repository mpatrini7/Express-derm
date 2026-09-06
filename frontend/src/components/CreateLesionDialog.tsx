import { Crosshair, MapPin, Plus, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { formatBodyRegion } from "../bodyRegions";

interface Props {
  bodyPart: string;
  onCancel: () => void;
  onConfirm: (label: string | null) => Promise<void>;
}

export function CreateLesionDialog({
  bodyPart,
  onCancel,
  onConfirm,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const labelId = useId();
  const labelHintId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    labelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  function keepFocusInside(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      "input:not(:disabled), button:not(:disabled)",
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setMessage("");
    try {
      await onConfirm(label.trim() || null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to add the marker",
      );
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="lesion-detail-backdrop create-lesion-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <form
        ref={dialogRef}
        className="delete-confirmation-dialog create-lesion-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={submitting}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={keepFocusInside}
        onSubmit={submit}
      >
        <header className="delete-confirmation-header create-lesion-header">
          <div className="delete-confirmation-heading create-lesion-heading">
            <span className="delete-confirmation-icon create-lesion-icon">
              <Crosshair aria-hidden="true" size={21} strokeWidth={2} />
            </span>
            <div>
              <p className="eyebrow">Confirm BodyMap marker</p>
              <h2 id={titleId}>Add lesion marker?</h2>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close marker creation"
            title="Close"
            disabled={submitting}
            onClick={onCancel}
          >
            <X aria-hidden="true" size={19} />
          </button>
        </header>

        <div className="delete-confirmation-content create-lesion-content">
          <p id={descriptionId}>
            Review the anatomical location before creating a persistent lesion
            record.
          </p>
          <div className="create-lesion-location">
            <MapPin aria-hidden="true" size={19} />
            <div>
              <span>Proposed location</span>
              <strong>{formatBodyRegion(bodyPart)}</strong>
            </div>
          </div>
          <div className="create-lesion-field">
            <label htmlFor={labelId}>Display label (optional)</label>
            <input
              id={labelId}
              ref={labelRef}
              value={label}
              maxLength={120}
              disabled={submitting}
              aria-describedby={labelHintId}
              placeholder="e.g. Left shoulder baseline"
              onChange={(event) => setLabel(event.target.value)}
            />
            <small id={labelHintId}>
              The local database assigns the progressive lesion code after
              confirmation.
            </small>
          </div>
          <div className="create-lesion-note">
            <Crosshair aria-hidden="true" size={18} />
            <p>
              This marker stores location only. Microscope observations and
              images are attached later.
            </p>
          </div>
        </div>

        <footer className="delete-confirmation-footer create-lesion-footer">
          <div className="delete-confirmation-message" aria-live="polite">
            {message ? <p role="alert">{message}</p> : null}
          </div>
          <div className="delete-confirmation-actions">
            <button
              type="button"
              className="secondary"
              disabled={submitting}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="create-lesion-button"
              disabled={submitting}
            >
              <Plus aria-hidden="true" size={17} strokeWidth={2} />
              {submitting ? "Adding..." : "Add marker"}
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
