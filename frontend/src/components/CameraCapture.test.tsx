import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type {
  AcquisitionSetup,
  CameraDevice,
  Observation,
} from "../types";
import { CameraCapture } from "./CameraCapture";

vi.mock("../api", () => ({
  api: {
    listCameraDevices: vi.fn(),
    getAcquisitionSetup: vi.fn(),
    captureSnapshot: vi.fn(),
  },
}));

const setup: AcquisitionSetup = {
  id: 1,
  revision: 3,
  name: "Clinic microscope",
  magnification_x: 20,
  orientation: "cranial_up",
  spacer_id: "SP-01",
  illumination: "integrated_led",
  exposure: null,
  gain: null,
  white_balance: null,
  focus_threshold: 80,
  min_brightness: 45,
  max_brightness: 220,
  thresholds_status: "provisional",
  scale_reference_path: null,
  color_reference_path: null,
  capture_ready: true,
  protocol_status: "reference_pending",
  updated_at: "2026-07-25T10:00:00Z",
};

const devices: CameraDevice[] = [
  {
    path: "mock://camera0",
    name: "Development camera",
    is_mock: true,
    modes: [
      {
        pixel_format: "MJPG",
        width: 1920,
        height: 1080,
        fps: [30],
      },
    ],
  },
];

const observation: Observation = {
  id: 12,
  lesion_id: 7,
  captured_at: "2026-07-25T10:05:00Z",
  microscope_image_path: "images/1/7/capture.png",
  original_filename: null,
  mime_type: "image/png",
  device_id: "mock://camera0",
  focus_score: 164,
  mean_brightness: 126,
  dark_fraction: 0,
  bright_fraction: 0,
  quality_score: 92,
  quality_status: "accepted",
  quality_reason: null,
  notes: null,
  created_at: "2026-07-25T10:05:00Z",
  acquisition: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("CameraCapture", () => {
  beforeEach(() => {
    vi.mocked(api.listCameraDevices).mockResolvedValue(devices);
    vi.mocked(api.getAcquisitionSetup).mockResolvedValue(setup);
    vi.mocked(api.captureSnapshot).mockResolvedValue(observation);
  });

  it("keeps a successful capture explicit when record refresh fails", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockRejectedValue(new Error("History unavailable"));
    render(<CameraCapture lesionId={7} onSaved={onSaved} />);

    const capture = await screen.findByRole("button", {
      name: "Capture best frame",
    });
    await waitFor(() => expect(capture).toBeEnabled());
    await user.click(capture);

    expect(
      await screen.findByText(
        /Microscope image saved.*Photo quality: 92%.*save succeeded.*History unavailable/,
      ),
    ).toBeInTheDocument();
    expect(api.captureSnapshot).toHaveBeenCalledWith(7, "mock://camera0", {
      pixel_format: "MJPG",
      width: 1920,
      height: 1080,
      fps: [30],
    });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledWith(observation);

    await user.click(
      screen.getByRole("button", { name: "Scan camera devices" }),
    );
    await waitFor(() =>
      expect(api.listCameraDevices).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.getByText(
        /Microscope image saved.*Photo quality: 92%.*save succeeded.*History unavailable/,
      ),
    ).toBeInTheDocument();
  });

  it("reports an acquisition failure without claiming that an image was saved", async () => {
    const user = userEvent.setup();
    vi.mocked(api.captureSnapshot).mockRejectedValue(
      new Error("Camera disconnected"),
    );
    render(<CameraCapture lesionId={7} onSaved={vi.fn()} />);

    const capture = await screen.findByRole("button", {
      name: "Capture best frame",
    });
    await waitFor(() => expect(capture).toBeEnabled());
    await user.click(capture);

    expect(await screen.findByText("Camera disconnected")).toBeInTheDocument();
    expect(screen.queryByText(/save succeeded/)).not.toBeInTheDocument();
  });

  it("reports the automatic assessment for an accepted live capture", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue({
      evaluated: true,
      error: null,
    });
    render(<CameraCapture lesionId={7} onSaved={onSaved} />);

    const capture = await screen.findByRole("button", {
      name: "Capture best frame",
    });
    await waitFor(() => expect(capture).toBeEnabled());
    await user.click(capture);

    expect(
      await screen.findByText(
        "Microscope image saved. Photo quality: 92%. Experimental assessment saved.",
      ),
    ).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(observation);
  });

  it("allows capture when the protocol is incomplete without an AI block", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAcquisitionSetup).mockResolvedValue({
      ...setup,
      magnification_x: null,
      spacer_id: null,
      capture_ready: false,
      protocol_status: "incomplete",
    });
    render(<CameraCapture lesionId={7} onSaved={vi.fn()} />);

    const capture = await screen.findByRole("button", {
      name: "Capture best frame",
    });
    expect(capture).toBeEnabled();
    expect(
      screen.queryByText(/AI is blocked until the protocol is validated/i),
    ).not.toBeInTheDocument();
    vi.mocked(api.captureSnapshot).mockResolvedValue({
      ...observation,
      quality_status: "accepted",
    });
    await user.click(capture);
    expect(
      await screen.findByText(/Microscope image saved.*Photo quality: 92%/),
    ).toBeInTheDocument();
    expect(api.captureSnapshot).toHaveBeenCalledTimes(1);
  });

  it("recovers when the acquisition protocol cannot be loaded initially", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAcquisitionSetup)
      .mockRejectedValueOnce(new Error("Local protocol store unavailable"))
      .mockResolvedValueOnce(setup);
    render(<CameraCapture lesionId={7} onSaved={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Acquisition protocol unavailable");
    expect(alert).toHaveTextContent("Local protocol store unavailable");
    expect(screen.getByRole("button", { name: "Capture best frame" })).toBeEnabled();
    expect(screen.queryByText(/AI is blocked until the protocol is validated/i)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Retry acquisition protocol",
      }),
    );

    expect(await screen.findByText(/Acquisition setup/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Capture best frame" }),
      ).toBeEnabled(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.getAcquisitionSetup).toHaveBeenCalledTimes(2);
  });

  it("recovers from a failed camera scan without using mutation feedback", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCameraDevices)
      .mockRejectedValueOnce(new Error("V4L2 enumeration failed"))
      .mockResolvedValueOnce(devices);
    render(<CameraCapture lesionId={7} onSaved={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Camera scan unavailable");
    expect(alert).toHaveTextContent("V4L2 enumeration failed");
    expect(screen.getByRole("combobox", { name: "Camera device" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Capture best frame" }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole("button", {
        name: "Retry camera scan",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Camera device" }),
      ).toHaveValue("mock://camera0"),
    );
    expect(
      screen.getByRole("button", { name: "Capture best frame" }),
    ).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.listCameraDevices).toHaveBeenCalledTimes(2);
  });

  it("ignores preflight responses invalidated by a StrictMode remount", async () => {
    const firstDevices = deferred<CameraDevice[]>();
    const currentDevices = deferred<CameraDevice[]>();
    const firstSetup = deferred<AcquisitionSetup>();
    const currentSetup = deferred<AcquisitionSetup>();
    vi.mocked(api.listCameraDevices)
      .mockReturnValueOnce(firstDevices.promise)
      .mockReturnValueOnce(currentDevices.promise);
    vi.mocked(api.getAcquisitionSetup)
      .mockReturnValueOnce(firstSetup.promise)
      .mockReturnValueOnce(currentSetup.promise);

    render(
      <StrictMode>
        <CameraCapture lesionId={7} onSaved={vi.fn()} />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(api.listCameraDevices).toHaveBeenCalledTimes(2);
      expect(api.getAcquisitionSetup).toHaveBeenCalledTimes(2);
    });
    currentDevices.resolve(devices);
    currentSetup.resolve({
      ...setup,
      thresholds_status: "calibrated",
      scale_reference_path: "images/_calibration/scale.png",
      color_reference_path: "images/_calibration/color.png",
      protocol_status: "validated",
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Capture best frame" }),
      ).toBeEnabled(),
    );
    firstDevices.resolve([]);
    firstSetup.resolve({
      ...setup,
      magnification_x: null,
      spacer_id: null,
      capture_ready: false,
      protocol_status: "incomplete",
    });

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Camera device" }),
      ).toHaveValue("mock://camera0");
      expect(
        screen.getByRole("button", { name: "Capture best frame" }),
      ).toBeEnabled();
    });
    expect(
      screen.queryByText(/Capture is enabled, but AI is blocked until the protocol is validated/i),
    ).not.toBeInTheDocument();
  });
});
