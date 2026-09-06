import {
  Camera,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { errorMessage, savedWithRefreshWarning } from "../mutationFeedback";
import { savedPhotoQualityMessage } from "../imageQuality";
import type {
  AcquisitionSetup,
  CameraDevice,
  CameraMode,
  Observation,
} from "../types";
import {
  AcquisitionProtocolModal,
  protocolStatusLabels,
} from "./AcquisitionProtocolModal";

interface Props {
  lesionId: number;
  onSaved: (
    observation: Observation,
  ) => Promise<AutomaticEvaluationResult | null>;
}

export interface AutomaticEvaluationResult {
  evaluated: boolean;
  error: string | null;
}

interface LoadErrorProps {
  title: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}

function CameraLoadError({
  title,
  message,
  retryLabel,
  onRetry,
}: LoadErrorProps) {
  return (
    <div className="camera-load-error" role="alert">
      <CircleAlert aria-hidden="true" size={18} />
      <div>
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      <button type="button" aria-label={retryLabel} onClick={onRetry}>
        <RefreshCw aria-hidden="true" size={16} />
        Retry
      </button>
    </div>
  );
}

function preferredMode(modes: CameraMode[]) {
  const practical = modes.filter(
    (mode) => mode.width <= 1920 && mode.height <= 1080,
  );
  const candidates = practical.length ? practical : modes;
  return (
    [...candidates].sort((left, right) => {
      const pixels = right.width * right.height - left.width * left.height;
      if (pixels !== 0) return pixels;
      return Math.max(...right.fps, 0) - Math.max(...left.fps, 0);
    })[0] ?? null
  );
}

function modeKey(mode: CameraMode) {
  return `${mode.pixel_format}:${mode.width}x${mode.height}`;
}

function modeLabel(mode: CameraMode) {
  const fps = mode.fps.length ? ` · ${Math.max(...mode.fps)} fps` : "";
  return `${mode.width} x ${mode.height} · ${mode.pixel_format}${fps}`;
}

export function CameraCapture({ lesionId, onSaved }: Props) {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [device, setDevice] = useState("");
  const [mode, setMode] = useState<CameraMode | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [deviceLoadError, setDeviceLoadError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [message, setMessage] = useState("");
  const [setup, setSetup] = useState<AcquisitionSetup | null>(null);
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupLoadError, setSetupLoadError] = useState("");
  const [showProtocol, setShowProtocol] = useState(false);
  const mountedRef = useRef(true);
  const deviceLoadRevision = useRef(0);
  const setupLoadRevision = useRef(0);
  const captureRevision = useRef(0);

  async function loadDevices() {
    const revision = deviceLoadRevision.current + 1;
    deviceLoadRevision.current = revision;
    setLoadingDevices(true);
    setDeviceLoadError("");
    setPreviewError("");
    try {
      const items = await api.listCameraDevices();
      if (!mountedRef.current || deviceLoadRevision.current !== revision) return;
      setDevices(items);
      const selected =
        items.find((item) => item.path === device) ?? items[0] ?? null;
      setDevice(selected?.path ?? "");
      setMode(preferredMode(selected?.modes ?? []));
    } catch (error) {
      if (!mountedRef.current || deviceLoadRevision.current !== revision) return;
      setDeviceLoadError(errorMessage(error, "Camera scan unavailable"));
    } finally {
      if (mountedRef.current && deviceLoadRevision.current === revision) {
        setLoadingDevices(false);
      }
    }
  }

  async function loadSetup() {
    const revision = setupLoadRevision.current + 1;
    setupLoadRevision.current = revision;
    setSetupLoading(true);
    setSetupLoadError("");
    try {
      const nextSetup = await api.getAcquisitionSetup();
      if (!mountedRef.current || setupLoadRevision.current !== revision) return;
      setSetup(nextSetup);
    } catch (error) {
      if (!mountedRef.current || setupLoadRevision.current !== revision) return;
      setSetupLoadError(
        errorMessage(error, "Acquisition protocol unavailable"),
      );
    } finally {
      if (mountedRef.current && setupLoadRevision.current === revision) {
        setSetupLoading(false);
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    void loadDevices();
    void loadSetup();
    return () => {
      mountedRef.current = false;
      deviceLoadRevision.current += 1;
      setupLoadRevision.current += 1;
    };
  }, []);

  useEffect(() => {
    captureRevision.current += 1;
    setCapturing(false);
    setMessage("");
    setShowProtocol(false);
  }, [lesionId]);

  const currentDevice = devices.find((item) => item.path === device) ?? null;
  const hasVisibleDevice = Boolean(currentDevice || device);
  const previewUrl = useMemo(() => {
    if (!device) return "";
    const params = new URLSearchParams({ device });
    if (mode) {
      params.set("width", String(mode.width));
      params.set("height", String(mode.height));
      params.set("pixel_format", mode.pixel_format);
      if (mode.fps.length) {
        params.set("frame_rate", String(Math.max(...mode.fps)));
      }
    }
    return `/api/camera/preview?${params.toString()}`;
  }, [device, mode]);

  function selectDevice(path: string) {
    const selected = devices.find((item) => item.path === path) ?? null;
    setDevice(path);
    setMode(preferredMode(selected?.modes ?? []));
    setPreviewError("");
    setMessage("");
  }

  async function capture() {
    if (
      !device ||
      loadingDevices ||
      deviceLoadError ||
      previewError
    ) {
      return;
    }
    const revision = captureRevision.current + 1;
    captureRevision.current = revision;
    setCapturing(true);
    setMessage("");
    try {
      const observation = await api.captureSnapshot(lesionId, device, mode);
      let savedMessage = savedPhotoQualityMessage(observation.quality_score);
      try {
        const aiResult = await onSaved(observation);
        if (aiResult?.evaluated) {
          savedMessage += " Experimental assessment saved.";
        } else if (aiResult?.error) {
          savedMessage += ` Analysis unavailable: ${aiResult.error}`;
        }
        if (captureRevision.current === revision) setMessage(savedMessage);
      } catch (error) {
        if (captureRevision.current === revision) {
          setMessage(savedWithRefreshWarning(savedMessage, error));
        }
      }
    } catch (error) {
      if (captureRevision.current === revision) {
        setMessage(errorMessage(error, "Capture failed"));
      }
    } finally {
      if (captureRevision.current === revision) setCapturing(false);
    }
  }

  return (
    <>
      <div className="camera-card">
        <div className="row-between">
          <div>
            <p className="eyebrow">USB microscope</p>
            <h3>Live acquisition</h3>
          </div>
          <div className="camera-heading-actions">
            {setup && (
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowProtocol(true)}
                aria-label="Open acquisition protocol"
                title="Acquisition protocol"
              >
                <SlidersHorizontal size={17} />
              </button>
            )}
            <span
              className={
                device &&
                !loadingDevices &&
                !deviceLoadError &&
                !previewError
                  ? "dot online"
                  : "dot"
              }
              title={
                loadingDevices
                  ? "Scanning camera devices"
                  : device && !deviceLoadError && !previewError
                    ? "Camera available"
                    : "Camera unavailable"
              }
            />
            <button
              type="button"
              className="icon-button"
              onClick={() => void loadDevices()}
              disabled={loadingDevices}
              aria-label="Scan camera devices"
              title="Scan camera devices"
            >
              <RefreshCw
                size={17}
                className={loadingDevices ? "rotating" : ""}
              />
            </button>
          </div>
        </div>

        {setup && (
          <button
            type="button"
            className="protocol-summary"
            onClick={() => setShowProtocol(true)}
          >
            <span>
              Acquisition setup
              {setup.magnification_x
                ? ` · ${setup.magnification_x}x`
                : ""}
              {setupLoading && (
                <LoaderCircle
                  aria-label="Refreshing acquisition protocol"
                  className="rotating"
                  size={14}
                />
              )}
            </span>
            <strong className={`protocol-state ${setup.protocol_status}`}>
              {protocolStatusLabels[setup.protocol_status]}
            </strong>
          </button>
        )}

        {!setup && setupLoading && (
          <p className="camera-load-state" role="status">
            <LoaderCircle aria-hidden="true" className="rotating" size={17} />
            Loading acquisition protocol.
          </p>
        )}

        {setupLoadError && (
          <CameraLoadError
            title="Acquisition protocol unavailable"
            message={setupLoadError}
            retryLabel="Retry acquisition protocol"
            onRetry={() => void loadSetup()}
          />
        )}

        {deviceLoadError && (
          <CameraLoadError
            title="Camera scan unavailable"
            message={deviceLoadError}
            retryLabel="Retry camera scan"
            onRetry={() => void loadDevices()}
          />
        )}

        <div className="camera-controls">
          <label>
            Camera device
            <select
              value={device}
              disabled={loadingDevices || Boolean(deviceLoadError)}
              onChange={(event) => selectDevice(event.target.value)}
            >
              <option value="">No camera detected</option>
              {devices.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.name}
                  {item.is_mock ? " (mock)" : ""}
                </option>
              ))}
            </select>
          </label>

          {currentDevice && currentDevice.modes.length > 0 && (
            <label>
              Capture mode
              <select
                value={mode ? modeKey(mode) : ""}
                onChange={(event) => {
                  setMode(
                    currentDevice.modes.find(
                      (item) => modeKey(item) === event.target.value,
                    ) ?? null,
                  );
                  setPreviewError("");
                }}
              >
                {currentDevice.modes.map((item) => (
                  <option key={modeKey(item)} value={modeKey(item)}>
                    {modeLabel(item)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="preview-shell">
          {previewUrl && !previewError && hasVisibleDevice ? (
            <img
              key={previewUrl}
              src={previewUrl}
              alt="Live USB microscope preview"
              onLoad={() => setPreviewError("")}
              onError={() =>
                setPreviewError("Preview unavailable. Check the wired camera.")
              }
            />
          ) : (
            <p>
              {previewError ||
                (loadingDevices
                  ? "Scanning camera devices…"
                  : devices.length === 0
                    ? "No local microscope device found. If your camera is connected, continue with setup and permissions (Linux/macOS mismatch can hide USB UVC)."
                    : "Connect the wired UVC microscope to this system.")}
            </p>
          )}
        </div>

        {devices.length === 0 && !loadingDevices && !deviceLoadError && (
          <p className="manual-upload-hint">
            No live device is available. Choose “Upload microscope file” in the
            image-source selector above.
          </p>
        )}

        <button
          type="button"
          className="capture-button"
          disabled={
            !device ||
            capturing ||
            loadingDevices ||
            Boolean(deviceLoadError) ||
            Boolean(previewError)
          }
          onClick={() => void capture()}
        >
          <Camera size={17} />
          {capturing ? "Scoring and saving…" : "Capture best frame"}
        </button>

        {message && (
          <p className="capture-message" aria-live="polite">
            {message}
          </p>
        )}
      </div>

      {setup && showProtocol && (
        <AcquisitionProtocolModal
          setup={setup}
          onClose={() => setShowProtocol(false)}
          onUpdated={(nextSetup) => {
            setSetup(nextSetup);
            setSetupLoadError("");
          }}
        />
      )}
    </>
  );
}
