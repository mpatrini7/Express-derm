import { ArrowRight, MapPin, Move3d, ShieldCheck, X } from "lucide-react";
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
  lesionCode: string;
  currentBodyPart: string;
  proposedBodyPart: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function RepositionConfirmationDialog({
  lesionCode,
  currentBodyPart,
  proposedBodyPart,
  onCancel,
  onConfirm,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
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
      "button:not(:disabled)",
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
      await onConfirm();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to move the marker",
      );
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="lesion-detail-backdrop reposition-confirmation-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <form
        ref={dialogRef}
        className="delete-confirmation-dialog reposition-confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={submitting}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={keepFocusInside}
        onSubmit={submit}
      >
        <header className="delete-confirmation-header reposition-confirmation-header">
          <div className="delete-confirmation-heading reposition-confirmation-heading">
            <span className="delete-confirmation-icon reposition-confirmation-icon">
              <MapPin aria-hidden="true" size={21} strokeWidth={2} />
            </span>
            <div>
              <p className="eyebrow">Confirm BodyMap location</p>
              <h2 id={titleId}>Move marker {lesionCode}?</h2>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close marker move confirmation"
            title="Close"
            disabled={submitting}
            onClick={onCancel}
          >
            <X aria-hidden="true" size={19} />
          </button>
        </header>

        <div className="delete-confirmation-content reposition-confirmation-content">
          <p id={descriptionId}>
            Confirm the anatomical location before replacing the saved marker
            coordinates.
          </p>
          <div
            className="reposition-location-change"
            aria-label="Marker location change"
          >
            <div>
              <span>Current</span>
              <strong>{formatBodyRegion(currentBodyPart)}</strong>
            </div>
            <ArrowRight aria-hidden="true" size={19} />
            <div>
              <span>Proposed</span>
              <strong>{formatBodyRegion(proposedBodyPart)}</strong>
            </div>
          </div>
          <div className="reposition-history-note">
            <ShieldCheck aria-hidden="true" size={19} />
            <p>
              Lesion identity, microscope observations, AI runs and review
              history stay attached. The move is added to the immutable audit
              trail.
            </p>
          </div>
        </div>

        <footer className="delete-confirmation-footer reposition-confirmation-footer">
          <div className="delete-confirmation-message" aria-live="polite">
            {message ? <p role="alert">{message}</p> : null}
          </div>
          <div className="delete-confirmation-actions">
            <button
              ref={cancelRef}
              type="button"
              className="secondary"
              disabled={submitting}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="reposition-confirmation-button"
              disabled={submitting}
            >
              <Move3d aria-hidden="true" size={17} strokeWidth={2} />
              {submitting ? "Moving..." : "Move marker"}
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
