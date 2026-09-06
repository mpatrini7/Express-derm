import { AlertTriangle, Trash2, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export interface DeleteImpact {
  label: string;
  value: number | string;
}

interface Props {
  title: string;
  recordCode: string;
  description: string;
  impacts: DeleteImpact[];
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteConfirmationDialog({
  title,
  recordCode,
  description,
  impacts,
  confirmLabel,
  onCancel,
  onConfirm,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const confirmed = confirmation === recordCode;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) onCancel();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, submitting]);

  useEffect(() => {
    if (submitting) inputRef.current?.focus();
  }, [submitting]);

  function keepFocusInside(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled)",
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
    if (!confirmed || submitting) return;

    setSubmitting(true);
    setMessage("");
    try {
      await onConfirm();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to delete the record",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="lesion-detail-backdrop delete-confirmation-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <form
        ref={dialogRef}
        className="delete-confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={submitting}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={keepFocusInside}
        onSubmit={submit}
      >
        <header className="delete-confirmation-header">
          <div className="delete-confirmation-heading">
            <span className="delete-confirmation-icon">
              <AlertTriangle aria-hidden="true" size={21} strokeWidth={2} />
            </span>
            <div>
              <p className="eyebrow">Permanent deletion</p>
              <h2 id={titleId}>{title}</h2>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close deletion confirmation"
            title="Close"
            disabled={submitting}
            onClick={onCancel}
          >
            <X aria-hidden="true" size={19} />
          </button>
        </header>

        <div className="delete-confirmation-content">
          <p id={descriptionId}>{description}</p>
          <dl className="delete-impact-list" aria-label="Records to delete">
            {impacts.map((impact) => (
              <div key={impact.label}>
                <dt>{impact.label}</dt>
                <dd>{impact.value}</dd>
              </div>
            ))}
          </dl>

          <label className="delete-confirmation-field" htmlFor={inputId}>
            <span>
              Type <code>{recordCode}</code> to confirm
            </span>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              autoComplete="off"
              readOnly={submitting}
              spellCheck={false}
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setMessage("");
              }}
            />
          </label>
        </div>

        <footer className="delete-confirmation-footer">
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
              className="destructive-button"
              disabled={!confirmed || submitting}
            >
              <Trash2 aria-hidden="true" size={17} strokeWidth={2} />
              {submitting ? "Deleting…" : confirmLabel}
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
