import { Save, UserPlus, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Patient, PatientProfileInput } from "../types";

interface Props {
  patient: Patient | null;
  onClose: () => void;
  onSubmit: (payload: PatientProfileInput) => Promise<void>;
}

export function PatientProfileModal({
  patient,
  onClose,
  onSubmit,
}: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);
  const savingRef = useRef(false);
  const [displayName, setDisplayName] = useState(patient?.display_name ?? "");
  const [birthYear, setBirthYear] = useState(
    patient?.birth_year === null || patient?.birth_year === undefined
      ? ""
      : String(patient.birth_year),
  );
  const [notes, setNotes] = useState(patient?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    displayNameRef.current?.focus();
    return () => {
      mountedRef.current = false;
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  function keepFocusInside(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !savingRef.current) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
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
    if (savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setMessage("");
    try {
      await onSubmit({
        display_name: displayName.trim() || null,
        birth_year: birthYear ? Number(birthYear) : null,
        notes: notes.trim() || null,
      });
      if (mountedRef.current) onClose();
    } catch (error) {
      if (mountedRef.current) {
        setMessage(
          error instanceof Error ? error.message : "Unable to save patient",
        );
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  const title = patient ? `Edit ${patient.patient_code}` : "New patient";

  return createPortal(
    <div
      className="lesion-detail-backdrop patient-profile-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !savingRef.current) {
          onClose();
        }
      }}
    >
      <form
        ref={dialogRef}
        className="patient-profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={saving}
        aria-labelledby={titleId}
        onKeyDown={keepFocusInside}
        onSubmit={submit}
      >
        <header className="patient-profile-header">
          <div>
            <p className="eyebrow">
              {patient ? "Local patient profile" : "Local database"}
            </p>
            <h2 id={titleId}>{title}</h2>
            {patient && <span>Patient code cannot be changed</span>}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close patient profile"
            title="Close"
            disabled={saving}
            onClick={onClose}
          >
            <X aria-hidden="true" size={19} />
          </button>
        </header>

        <section className="patient-profile-fields">
          <label>
            Display label
            <input
              ref={displayNameRef}
              disabled={saving}
              maxLength={128}
              value={displayName}
              placeholder="Optional alias"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label>
            Birth year
            <input
              type="number"
              disabled={saving}
              min="1900"
              max={new Date().getFullYear()}
              inputMode="numeric"
              value={birthYear}
              placeholder="Optional"
              onChange={(event) => setBirthYear(event.target.value)}
            />
          </label>
          <label className="patient-profile-notes">
            Notes
            <textarea
              disabled={saving}
              rows={5}
              maxLength={4000}
              value={notes}
              placeholder="Optional non-identifying notes"
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </section>

        <footer className="patient-profile-footer">
          {message ? (
            <p className="capture-message" role="alert">
              {message}
            </p>
          ) : (
            <span />
          )}
          <div>
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {patient ? (
                <Save aria-hidden="true" size={17} />
              ) : (
                <UserPlus aria-hidden="true" size={17} />
              )}
              {saving
                ? "Saving…"
                : patient
                  ? "Save profile"
                  : "Create patient"}
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
