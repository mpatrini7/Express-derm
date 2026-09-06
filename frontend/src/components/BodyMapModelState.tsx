import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";

interface BodyMapModelErrorBoundaryProps {
  children: ReactNode;
  onError: (error: Error) => void;
}

interface BodyMapModelErrorBoundaryState {
  failed: boolean;
}

export class BodyMapModelErrorBoundary extends Component<
  BodyMapModelErrorBoundaryProps,
  BodyMapModelErrorBoundaryState
> {
  state: BodyMapModelErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): BodyMapModelErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function BodyMapModelLoading() {
  return (
    <div
      className="bodymap-model-state bodymap-model-loading"
      role="status"
      aria-live="polite"
    >
      <LoaderCircle aria-hidden="true" size={24} />
      <span>Loading human model</span>
    </div>
  );
}

export function BodyMapModelError({
  onRetry,
}: {
  onRetry: () => void;
}) {
  return (
    <div className="bodymap-model-state bodymap-model-error" role="alert">
      <AlertTriangle aria-hidden="true" size={26} />
      <div>
        <strong>3D model unavailable</strong>
        <p>
          The patient record remains available. Check the local model file and
          try loading it again.
        </p>
      </div>
      <button type="button" className="secondary" onClick={onRetry}>
        <RefreshCw aria-hidden="true" size={16} />
        Retry
      </button>
    </div>
  );
}
