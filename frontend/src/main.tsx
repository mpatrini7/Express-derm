import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

interface AppErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends React.Component<
  React.PropsWithChildren<object>,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Express-Derm failed to render", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-boot-error" role="alert">
          <p className="eyebrow">Local app error</p>
          <h1>Express-Derm</h1>
          <p>The interface could not be rendered.</p>
          <pre>{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

const root = ReactDOM.createRoot(rootElement);

function renderBootstrapError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  root.render(
    <main className="app-boot-error" role="alert">
      <p className="eyebrow">Local app error</p>
      <h1>Express-Derm</h1>
      <p>The interface could not be loaded.</p>
      <pre>{message}</pre>
      <button type="button" onClick={() => window.location.reload()}>
        Reload app
      </button>
    </main>,
  );
}

void import("./App")
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </React.StrictMode>,
    );
  })
  .catch(renderBootstrapError);
