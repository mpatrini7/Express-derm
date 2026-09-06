import { ZoomIn, ZoomOut } from "lucide-react";

interface Props {
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function BodyMapZoomControls({ onZoomIn, onZoomOut }: Props) {
  return (
    <div className="bodymap-zoom-controls" role="group" aria-label="Body zoom">
      <button
        type="button"
        className="icon-button"
        aria-label="Zoom in on BodyMap"
        title="Zoom in"
        onClick={onZoomIn}
      >
        <ZoomIn aria-hidden="true" size={17} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Zoom out from BodyMap"
        title="Zoom out"
        onClick={onZoomOut}
      >
        <ZoomOut aria-hidden="true" size={17} />
      </button>
    </div>
  );
}
