import { LocateFixed, Maximize2, Minimize2, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface Props {
  status: string;
  repositioningCode: string | null;
  selectedLesionCode: string | null;
  busy: boolean;
  onCancelReposition: () => void;
  onFocusSelected: () => void;
  children: ReactNode;
  footer: ReactNode;
}

export function BodyMapFrame({
  status,
  repositioningCode,
  selectedLesionCode,
  busy,
  onCancelReposition,
  onFocusSelected,
  children,
  footer,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const focusButtonRef = useRef<HTMLButtonElement>(null);
  const hasExpandedRef = useRef(false);

  useEffect(() => {
    if (expanded) {
      hasExpandedRef.current = true;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      focusButtonRef.current?.focus();
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }

    if (hasExpandedRef.current) focusButtonRef.current?.focus();
  }, [expanded]);

  function keepFocusInside(event: KeyboardEvent<HTMLElement>) {
    if (!expanded) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setExpanded(false);
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
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

  const panel = (
    <section
      ref={panelRef}
      className={expanded ? "bodymap panel bodymap-expanded" : "bodymap panel"}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? "true" : undefined}
      aria-labelledby={titleId}
      onKeyDown={keepFocusInside}
    >
      <div className="bodymap-heading">
        <div>
          <p className="eyebrow">Manual location map</p>
          <h2 id={titleId}>3D BodyMap</h2>
        </div>
        <div className="bodymap-heading-actions">
          <span
            className={
              repositioningCode
                ? "status-chip repositioning"
                : "status-chip"
            }
            aria-live="polite"
          >
            {status}
          </span>
          {selectedLesionCode && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Focus BodyMap on ${selectedLesionCode}`}
              title={`Focus on ${selectedLesionCode}`}
              onClick={onFocusSelected}
            >
              <LocateFixed aria-hidden="true" size={17} />
            </button>
          )}
          <button
            ref={focusButtonRef}
            type="button"
            className="icon-button"
            aria-label={
              expanded ? "Exit expanded BodyMap" : "Expand BodyMap"
            }
            title={expanded ? "Exit expanded view" : "Expand BodyMap"}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <Minimize2 aria-hidden="true" size={17} />
            ) : (
              <Maximize2 aria-hidden="true" size={17} />
            )}
          </button>
          {repositioningCode && (
            <button
              type="button"
              className="icon-button"
              aria-label="Cancel marker repositioning"
              title="Cancel repositioning"
              disabled={busy}
              onClick={onCancelReposition}
            >
              <X aria-hidden="true" size={17} />
            </button>
          )}
        </div>
      </div>

      {children}
      {footer}
    </section>
  );

  if (!expanded) return panel;

  return createPortal(
    <div
      className="bodymap-focus-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) setExpanded(false);
      }}
    >
      {panel}
    </div>,
    document.body,
  );
}
