import { StrictMode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { ModelRun, Observation } from "../types";
import { AIResultCard } from "./AIResultCard";

vi.mock("../api", () => ({
  api: {
    aiStatus: vi.fn(),
    listEvaluations: vi.fn(),
    evaluateObservation: vi.fn(),
  },
}));

const observation: Observation = {
  id: 12,
  lesion_id: 7,
  captured_at: "2026-07-20T10:00:00Z",
  microscope_image_path: "images/1/7/comparison.png",
  original_filename: "comparison.png",
  mime_type: "image/png",
  device_id: "manual-upload:usb-microscope-confirmed",
  focus_score: 166,
  mean_brightness: 124,
  dark_fraction: 0,
  bright_fraction: 0,
  quality_score: 92,
  quality_status: "accepted",
  quality_reason: null,
  notes: null,
  created_at: "2026-07-20T10:00:00Z",
  acquisition: null,
};

const validatedObservation: Observation = {
  ...observation,
  acquisition: {
    protocol_revision: 4,
    protocol_name: "Validated microscope protocol",
    protocol_status: "validated",
    device_path: "manual-upload:usb-microscope-confirmed",
    device_name: "USB microscope",
    width: 1280,
    height: 720,
    pixel_format: "image/png",
    frame_rate: null,
    exposure: null,
    gain: null,
    white_balance: null,
    magnification_x: 20,
    orientation: "cranial_up",
    spacer_id: "SP-01",
    illumination: "integrated_led",
    focus_threshold: 80,
    min_brightness: 45,
    max_brightness: 220,
    thresholds_status: "calibrated",
    scale_reference_path: "images/_calibration/scale.png",
    color_reference_path: "images/_calibration/color.png",
    created_at: "2026-07-20T09:55:00Z",
  },
};

const runs: ModelRun[] = [
  {
    id: 2,
    observation_id: observation.id,
    model_version: "model-v2",
    model_hash: "hash-v2",
    backend: "tensorrt_cpp",
    score: 0.64,
    attention_level: "intermediate",
    abstained: false,
    abstention_reason: null,
    validation_status: "research_only",
    domain_status: "microscope_validation_pending",
    latency_ms: 14,
    result_json: "{}",
    created_at: "2026-07-22T10:00:00Z",
  },
  {
    id: 1,
    observation_id: observation.id,
    model_version: "model-v1",
    model_hash: "hash-v1",
    backend: "onnxruntime",
    score: 0.31,
    attention_level: "low",
    abstained: false,
    abstention_reason: null,
    validation_status: "research_only",
    domain_status: "microscope_validation_pending",
    latency_ms: 16,
    result_json: "{}",
    created_at: "2026-07-21T10:00:00Z",
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("AIResultCard", () => {
  beforeEach(() => {
    vi.mocked(api.aiStatus).mockResolvedValue({
      enabled: false,
      ready: false,
      backend: "disabled",
      model_version: null,
      validation_status: null,
      domain_status: null,
      reason: "AI is disabled",
    });
    vi.mocked(api.listEvaluations).mockResolvedValue(runs);
  });

  it("keeps technical metadata in history instead of the compact result", async () => {
    render(<AIResultCard observation={observation} />);

    const history = await screen.findByText("Evaluation history (2)");
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Photo quality 92 percent" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
    expect(screen.queryByText("Runtime")).not.toBeInTheDocument();
    expect(screen.queryByText("TensorRT C++")).not.toBeInTheDocument();
    expect(screen.queryByText("Validation")).not.toBeInTheDocument();
    expect(screen.queryByText("Domain")).not.toBeInTheDocument();
    expect(screen.queryByText("Confidence")).not.toBeInTheDocument();
    expect(screen.queryByText("AI attention score")).not.toBeInTheDocument();
    expect(screen.queryByText("0.640 / 1")).not.toBeInTheDocument();
    const historyDetails = history.closest("details");
    expect(historyDetails).not.toBeNull();
    const historyQueries = within(historyDetails!);
    expect(historyQueries.getByText("model-v2")).toBeInTheDocument();
    expect(historyQueries.getByText("model-v1")).toBeInTheDocument();
    expect(historyQueries.getAllByText("research_only")).toHaveLength(2);
    expect(screen.getAllByText("Inconclusive").length).toBeGreaterThan(0);
    expect(screen.queryByText("Intermediate")).not.toBeInTheDocument();
  });

  it("keeps the quality score but hides the legacy sharpness sentence", async () => {
    render(
      <AIResultCard
        observation={{
          ...observation,
          quality_score: 50,
          quality_reason: "Image is not sufficiently sharp",
        }}
      />,
    );

    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Usable with caution")).toBeInTheDocument();
    expect(
      screen.queryByText(/Image is not sufficiently sharp/),
    ).not.toBeInTheDocument();
  });

  it("shows the combined result and both model signals", async () => {
    const signal = (version: string) => ({
      model_version: version,
      model_sha256: "a".repeat(64),
      target: version,
      view_names: ["original", "center_crop_90", "center_crop_80"],
      view_scores: [0.91, 0.89, 0.87],
      consensus_level: "high" as const,
      low_threshold: 0.1,
      high_threshold: 0.8,
      thresholds_validated: false,
    });
    const dualRun: ModelRun = {
      ...runs[0],
      attention_level: "high",
      abstained: false,
      result_json: JSON.stringify({
        decision_policy_version: "dual-center-scale-confirmation-v1",
        combined_label: "high_confirmed",
        signals: {
          melanoma_attention: signal("melanoma-v1"),
          broad_malignancy_attention: signal("broad-v1"),
        },
      }),
    };
    vi.mocked(api.listEvaluations).mockResolvedValue([dualRun]);

    render(<AIResultCard observation={observation} />);

    expect(await screen.findByText("High confirmed")).toBeInTheDocument();
    expect(screen.getByText("Melanoma attention")).toBeInTheDocument();
    expect(screen.getByText("BCC / SCC / AK attention")).toBeInTheDocument();
  });

  it("loads model status and evaluation history after a StrictMode remount", async () => {
    vi.mocked(api.aiStatus).mockResolvedValue({
      enabled: true,
      ready: true,
      backend: "onnxruntime",
      model_version: "model-v2",
      validation_status: "research_only",
      domain_status: "microscope_validation_pending",
      reason: null,
    });

    render(
      <StrictMode>
        <AIResultCard observation={validatedObservation} />
      </StrictMode>,
    );

    expect(await screen.findByText("Evaluation history (2)")).toBeInTheDocument();
    expect(
      screen.queryByText("Loading model status and evaluation history."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Run experimental assessment",
      }),
    ).toBeEnabled();
    expect(api.aiStatus).toHaveBeenCalledTimes(2);
    expect(api.listEvaluations).toHaveBeenCalledTimes(2);
  });

  it("keeps a saved evaluation explicit when the patient refresh fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.aiStatus).mockResolvedValue({
      enabled: true,
      ready: true,
      backend: "onnxruntime",
      model_version: "model-v2",
      validation_status: "research_only",
      domain_status: "microscope_validation_pending",
      reason: null,
    });
    vi.mocked(api.evaluateObservation).mockResolvedValue(runs[0]);
    const onEvaluated = vi
      .fn()
      .mockRejectedValue(new Error("Patient summary unavailable"));
    render(
      <AIResultCard
        observation={validatedObservation}
        onEvaluated={onEvaluated}
      />,
    );

    const evaluate = await screen.findByRole("button", {
      name: "Run experimental assessment",
    });
    await waitFor(() => expect(evaluate).toBeEnabled());
    await user.click(evaluate);

    expect(
      await screen.findByText(
        /Experimental assessment saved.*save succeeded.*Patient summary unavailable/,
      ),
    ).toBeInTheDocument();
    expect(api.evaluateObservation).toHaveBeenCalledWith(observation.id);
  });

  it("allows evaluation without a validated acquisition protocol", async () => {
    const user = userEvent.setup();
    vi.mocked(api.aiStatus).mockResolvedValue({
      enabled: true,
      ready: true,
      backend: "onnxruntime",
      model_version: "model-v2",
      validation_status: "research_only",
      domain_status: "microscope_validation_pending",
      reason: null,
    });
    vi.mocked(api.evaluateObservation).mockResolvedValue(runs[0]);
    render(<AIResultCard observation={observation} />);

    const evaluate = await screen.findByRole("button", {
      name: "Run experimental assessment",
    });
    await waitFor(() => expect(evaluate).toBeEnabled());
    await user.click(evaluate);

    expect(api.evaluateObservation).toHaveBeenCalledWith(observation.id);
    expect(
      screen.queryByText(/validated acquisition protocol is required/i),
    ).not.toBeInTheDocument();
  });

  it("disables evaluation for a legacy upload without source confirmation", async () => {
    vi.mocked(api.aiStatus).mockResolvedValue({
      enabled: true,
      ready: true,
      backend: "onnxruntime",
      model_version: "model-v2",
      validation_status: "research_only",
      domain_status: "microscope_validation_pending",
      reason: null,
    });
    render(
      <AIResultCard
        observation={{ ...observation, device_id: "upload" }}
      />,
    );

    expect(
      await screen.findByText(/source confirmation is missing/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Run experimental assessment",
      }),
    ).toBeDisabled();
  });

  it("distinguishes unavailable data from an empty history and recovers on retry", async () => {
    const user = userEvent.setup();
    vi.mocked(api.aiStatus)
      .mockRejectedValueOnce(new Error("Local AI service unavailable"))
      .mockResolvedValue({
        enabled: true,
        ready: true,
        backend: "onnxruntime",
        model_version: "model-v2",
        validation_status: "research_only",
        domain_status: "microscope_validation_pending",
        reason: null,
      });
    vi.mocked(api.listEvaluations)
      .mockRejectedValueOnce(new Error("Evaluation history unavailable"))
      .mockResolvedValue(runs);

    render(<AIResultCard observation={observation} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Assessment data unavailable");
    expect(alert).toHaveTextContent("Local AI service unavailable");
    expect(
      screen.queryByText("No model evaluation has been saved."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Run experimental assessment",
      }),
    ).toBeDisabled();

    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Evaluation history (2)")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.aiStatus).toHaveBeenCalledTimes(2);
    expect(api.listEvaluations).toHaveBeenCalledTimes(2);
  });

  it("ignores a delayed response from the previously selected observation", async () => {
    const firstStatus = deferred<Awaited<ReturnType<typeof api.aiStatus>>>();
    const firstRuns = deferred<ModelRun[]>();
    const secondObservation = {
      ...observation,
      id: 24,
      microscope_image_path: "images/1/7/newest.png",
      original_filename: "newest.png",
    };
    vi.mocked(api.aiStatus)
      .mockReturnValueOnce(firstStatus.promise)
      .mockResolvedValue({
        enabled: true,
        ready: true,
        backend: "onnxruntime",
        model_version: "model-new",
        validation_status: "research_only",
        domain_status: "microscope_validation_pending",
        reason: null,
      });
    vi.mocked(api.listEvaluations)
      .mockReturnValueOnce(firstRuns.promise)
      .mockResolvedValue([]);

    const { rerender } = render(<AIResultCard observation={observation} />);
    rerender(<AIResultCard observation={secondObservation} />);

    expect(
      await screen.findByText("No model evaluation has been saved."),
    ).toBeInTheDocument();
    firstStatus.resolve({
      enabled: false,
      ready: false,
      backend: "disabled",
      model_version: null,
      validation_status: null,
      domain_status: null,
      reason: "Old model status",
    });
    firstRuns.resolve(runs);

    await waitFor(() => {
      expect(screen.queryByText("model-v2")).not.toBeInTheDocument();
      expect(screen.queryByText("Old model status")).not.toBeInTheDocument();
    });
    expect(api.listEvaluations).toHaveBeenNthCalledWith(1, observation.id);
    expect(api.listEvaluations).toHaveBeenNthCalledWith(2, secondObservation.id);
  });
});
