export type BodyView = "front" | "back" | "left" | "right";

const views: Array<{ value: BodyView; label: string }> = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

interface Props {
  activeView: BodyView | "free";
  onSelect: (view: BodyView) => void;
}

export function BodyViewControls({ activeView, onSelect }: Props) {
  return (
    <div
      className="bodymap-view-controls"
      role="group"
      aria-label="Body view"
    >
      {views.map((view) => (
        <button
          key={view.value}
          type="button"
          aria-pressed={activeView === view.value}
          title={`Show ${view.label.toLocaleLowerCase()} view`}
          onClick={() => onSelect(view.value)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
