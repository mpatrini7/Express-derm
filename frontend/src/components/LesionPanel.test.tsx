import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { lesionFixture, patientFixture } from "../test/fixtures";
import type { Lesion, ModelRun, Observation } from "../types";
import { LesionPanel } from "./LesionPanel";

vi.mock("../api", () => ({
  api: {
    aiStatus: vi.fn(),
    evaluateObservation: vi.fn(),
    listObservations: vi.fn(),
    uploadObservation: vi.fn(),
    deleteObservation: vi.fn(),
  },
}));

vi.mock("./CameraCapture", () => ({
  CameraCapture: () => <div>Camera capture test double</div>,
}));

vi.mock("./AIResultCard", () => ({
  AIResultCard: () => <div>AI result test double</div>,
}));

const observation: Observation = {
  id: 12,
  lesion_id: lesionFixture.id,
  captured_at: "2026-07-25T10:05:00Z",
  microscope_image_path: "images/1/7/upload.png",
  original_filename: "upload.png",
  mime_type: "image/png",
  device_id: "upload",
  focus_score: 164,
  mean_brightness: 126,
  dark_fraction: 0,
  bright_fraction: 0,
  quality_score: 92,
  quality_status: "accepted",
  quality_reason: null,
  notes: "Baseline",
  created_at: "2026-07-25T10:05:00Z",
  acquisition: null,
};

const incompleteProtocolObservation: Observation = {
  ...observation,
  device_id: "manual-upload:usb-microscope-confirmed",
  acquisition: {
    protocol_revision: 4,
    protocol_name: "Incomplete microscope protocol",
    protocol_status: "incomplete",
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
    thresholds_status: "provisional",
    scale_reference_path: null,
    color_reference_path: null,
    created_at: "2026-07-25T10:00:00Z",
  },
};

const modelRun: ModelRun = {
  id: 1,
  observation_id: incompleteProtocolObservation.id,
  model_version: "research-model-v1",
  model_hash: "model-hash",
  backend: "onnxruntime",
  score: 0.32,
  attention_level: "low",
  abstained: false,
  abstention_reason: null,
  validation_status: "research_only",
  domain_status: "microscope_validation_pending",
  latency_ms: 12,
  result_json: "{}",
  created_at: "2026-07-25T10:05:00Z",
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

function panelProps(selectedLesion: Lesion | null = lesionFixture) {
  return {
    patient: patientFixture,
    lesions: selectedLesion ? [selectedLesion] : [],
    selectedLesion,
    onSelectLesion: vi.fn(),
    onOpenLesion: vi.fn(),
    onDeleteLesion: vi.fn().mockResolvedValue(undefined),
    onLesionChanged: vi.fn().mockResolvedValue(undefined),
    onUpdateLesion: vi.fn(),
    repositioningLesionId: null,
    onStartReposition: vi.fn(),
    onCancelReposition: vi.fn(),
  };
}

describe("LesionPanel workflows", () => {
  it("keeps one live acquisition instance while switching between lesions", () => {
    vi.mocked(api.listObservations).mockResolvedValue([]);
    const secondLesion = {
      ...lesionFixture,
      id: 8,
      lesion_code: "L-0002",
      label: "Second marker",
    };
    const lesions = [lesionFixture, secondLesion];
    const firstProps = { ...panelProps(), lesions };
    const view = render(<LesionPanel {...firstProps} />);
    const acquisition = screen.getByText("Camera capture test double");

    view.rerender(
      <LesionPanel
        {...firstProps}
        selectedLesion={secondLesion}
      />,
    );

    expect(screen.getAllByText("Camera capture test double")).toHaveLength(1);
    expect(screen.getByText("Camera capture test double")).toBe(acquisition);
  });

  it("shows automatic follow-up for an experimental assessment", () => {
    vi.mocked(api.listObservations).mockResolvedValue([]);
    const experimentalLesion: Lesion = {
      ...lesionFixture,
      observation_count: 1,
      accepted_observation_count: 1,
      attention_level: "low",
      risk_status: "experimental",
      follow_up_action: "monitor_12_months",
      next_check_at: "2027-07-25T12:00:00Z",
    };

    render(<LesionPanel {...panelProps(experimentalLesion)} />);

    expect(
      screen.getByText("Image comparison in 12 months"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Jul 25, 2027/)).toBeInTheDocument();
  });

  it("automatically evaluates an accepted capture with an incomplete protocol", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listObservations)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([incompleteProtocolObservation]);
    vi.mocked(api.uploadObservation).mockResolvedValue(
      incompleteProtocolObservation,
    );
    vi.mocked(api.aiStatus).mockResolvedValue({
      enabled: true,
      ready: true,
      backend: "onnxruntime",
      model_version: "research-model-v1",
      validation_status: "research_only",
      domain_status: "microscope_validation_pending",
      reason: null,
    });
    vi.mocked(api.evaluateObservation).mockResolvedValue(modelRun);

    render(<LesionPanel {...panelProps()} />);

    await user.selectOptions(
      screen.getByLabelText("Image source"),
      "upload",
    );
    await user.upload(
      screen.getByLabelText("Image file"),
      new File(["microscope"], "capture.png", { type: "image/png" }),
    );
    await user.click(
      screen.getByLabelText(
        "I confirm this file is a USB-microscope image.",
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Save, score and analyze" }),
    );

    expect(
      await screen.findByText(
        "Microscope image saved. Photo quality: 92%. Experimental assessment saved.",
      ),
    ).toBeInTheDocument();
    expect(api.aiStatus).toHaveBeenCalledOnce();
    expect(api.evaluateObservation).toHaveBeenCalledWith(
      incompleteProtocolObservation.id,
    );
  });

  it("saves a blurry image, reports fifty-percent quality and still evaluates it", async () => {
    const user = userEvent.setup();
    const lowQualityObservation: Observation = {
      ...incompleteProtocolObservation,
      id: 13,
      quality_score: 50,
      quality_reason: "Image is not sufficiently sharp",
    };
    vi.mocked(api.listObservations)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([lowQualityObservation]);
    vi.mocked(api.uploadObservation).mockResolvedValue(lowQualityObservation);
    vi.mocked(api.aiStatus).mockResolvedValue({
      enabled: true,
      ready: true,
      backend: "onnxruntime",
      model_version: "research-model-v1",
      validation_status: "research_only",
      domain_status: "microscope_validation_pending",
      reason: null,
    });
    vi.mocked(api.evaluateObservation).mockResolvedValue({
      ...modelRun,
      observation_id: lowQualityObservation.id,
    });
    const props = panelProps();
    render(<LesionPanel {...props} />);

    await user.selectOptions(screen.getByLabelText("Image source"), "upload");
    const fileInput = screen.getByLabelText("Image file");
    await user.upload(
      fileInput,
      new File(["blurred"], "blurred.png", { type: "image/png" }),
    );
    await user.click(
      screen.getByLabelText(
        "I confirm this file is a USB-microscope image.",
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Save, score and analyze" }),
    );

    expect(
      await screen.findByText(
        "Microscope image saved. Photo quality: 50%. Experimental assessment saved.",
      ),
    ).toBeInTheDocument();
    expect(fileInput).toHaveValue("");
    expect(api.aiStatus).toHaveBeenCalledOnce();
    expect(api.evaluateObservation).toHaveBeenCalledWith(
      lowQualityObservation.id,
    );
    expect(props.onLesionChanged).toHaveBeenCalledOnce();
  });

  it("does not misreport a saved upload when summary refresh fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listObservations)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([observation]);
    vi.mocked(api.uploadObservation).mockResolvedValue(observation);
    const props = panelProps();
    props.onLesionChanged.mockRejectedValue(new Error("Summary unavailable"));
    render(<LesionPanel {...props} />);

    const file = new File(["microscope"], "capture.png", {
      type: "image/png",
    });
    await user.selectOptions(
      screen.getByLabelText("Image source"),
      "upload",
    );
    await user.upload(screen.getByLabelText("Image file"), file);
    await user.type(
      screen.getByLabelText("Observation notes (optional)"),
      "Baseline",
    );
    const save = screen.getByRole("button", {
      name: "Save, score and analyze",
    });
    expect(save).toBeDisabled();
    await user.click(
      screen.getByLabelText("I confirm this file is a USB-microscope image."),
    );
    expect(save).toBeEnabled();
    await user.click(
      save,
    );

    expect(
      await screen.findByText(
        /Microscope image saved.*Photo quality: 92%.*save succeeded.*Summary unavailable/,
      ),
    ).toBeInTheDocument();
    expect(api.uploadObservation).toHaveBeenCalledWith(
      lesionFixture.id,
      file,
      "Baseline",
      true,
    );
    expect(screen.getByLabelText("Image file")).toHaveValue("");
  });

  it("ignores an old upload response after another lesion is selected", async () => {
    const user = userEvent.setup();
    const secondHistory = deferred<Observation[]>();
    let resolveUpload: (value: Observation) => void = () => undefined;
    vi.mocked(api.uploadObservation).mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    vi.mocked(api.listObservations)
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(secondHistory.promise);
    const firstProps = panelProps();
    const { rerender } = render(<LesionPanel {...firstProps} />);

    await user.selectOptions(
      screen.getByLabelText("Image source"),
      "upload",
    );
    await user.upload(
      screen.getByLabelText("Image file"),
      new File(["microscope"], "capture.png", { type: "image/png" }),
    );
    await user.click(
      screen.getByLabelText(
        "I confirm this file is a USB-microscope image.",
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Save, score and analyze" }),
    );

    const secondLesion = {
      ...lesionFixture,
      id: 8,
      lesion_code: "L-0002",
      label: "Second marker",
    };
    rerender(<LesionPanel {...panelProps(secondLesion)} />);
    resolveUpload(observation);

    await waitFor(() =>
      expect(firstProps.onLesionChanged).toHaveBeenCalledOnce(),
    );
    secondHistory.resolve([]);
    expect(
      await screen.findByText("No microscope observations saved."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "L-0002" })).toBeInTheDocument();
    expect(
      screen.queryByText("Microscope image saved. Photo quality: 92%."),
    ).not.toBeInTheDocument();
    expect(screen.queryByAltText("Microscope observation 12")).not.toBeInTheDocument();
    expect(api.listObservations).toHaveBeenCalledTimes(2);
  });

  it("distinguishes unavailable history from a valid empty history and retries", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listObservations)
      .mockRejectedValueOnce(new Error("Local observation store unavailable"))
      .mockResolvedValueOnce([observation]);

    render(<LesionPanel {...panelProps()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Observation history unavailable");
    expect(alert).toHaveTextContent("Local observation store unavailable");
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(
      screen.queryByText("No microscope observations saved."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("AI result test double")).not.toBeInTheDocument();

    await user.click(
      within(alert).getByRole("button", {
        name: "Retry observation history",
      }),
    );

    expect(
      await screen.findByAltText("Microscope observation 12"),
    ).toBeInTheDocument();
    expect(screen.getByText("AI result test double")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.listObservations).toHaveBeenCalledTimes(2);
  });

  it("deletes one microscope image while retaining the lesion", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listObservations)
      .mockResolvedValueOnce([observation])
      .mockResolvedValueOnce([]);
    vi.mocked(api.deleteObservation).mockResolvedValue(undefined);
    const props = panelProps();

    render(<LesionPanel {...props} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Delete microscope observation 12",
      }),
    );
    expect(
      screen.getByText(/The lesion and its other images remain/),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText(/Type IMG-0012 to confirm/),
      "IMG-0012",
    );
    await user.click(screen.getByRole("button", { name: "Delete image" }));

    expect(
      await screen.findByText("Microscope image deleted. Lesion retained."),
    ).toBeInTheDocument();
    expect(api.deleteObservation).toHaveBeenCalledWith(observation.id);
    expect(props.onLesionChanged).toHaveBeenCalledOnce();
    expect(
      screen.queryByAltText("Microscope observation 12"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: lesionFixture.lesion_code }),
    ).toBeInTheDocument();
  });

  it("keeps the image and confirmation open when deletion fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listObservations).mockResolvedValue([observation]);
    vi.mocked(api.deleteObservation).mockRejectedValue(
      new Error("Image deletion failed"),
    );
    const props = panelProps();

    render(<LesionPanel {...props} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Delete microscope observation 12",
      }),
    );
    await user.type(
      screen.getByLabelText(/Type IMG-0012 to confirm/),
      "IMG-0012",
    );
    await user.click(screen.getByRole("button", { name: "Delete image" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Image deletion failed",
    );
    expect(
      screen.getByAltText("Microscope observation 12"),
    ).toBeInTheDocument();
    expect(props.onLesionChanged).not.toHaveBeenCalled();
  });

  it("ignores delayed observation history from the previously selected lesion", async () => {
    const firstHistory = deferred<Observation[]>();
    vi.mocked(api.listObservations)
      .mockReturnValueOnce(firstHistory.promise)
      .mockResolvedValueOnce([]);
    const secondLesion = {
      ...lesionFixture,
      id: 8,
      lesion_code: "L-0002",
      label: "Second marker",
    };

    const { rerender } = render(<LesionPanel {...panelProps()} />);
    rerender(<LesionPanel {...panelProps(secondLesion)} />);

    expect(
      await screen.findByText("No microscope observations saved."),
    ).toBeInTheDocument();
    firstHistory.resolve([observation]);

    await waitFor(() => {
      expect(
        screen.queryByAltText("Microscope observation 12"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("AI result test double")).not.toBeInTheDocument();
    });
    expect(api.listObservations).toHaveBeenNthCalledWith(1, lesionFixture.id);
    expect(api.listObservations).toHaveBeenNthCalledWith(2, secondLesion.id);
  });

  it("keeps cached history but withholds AI when a saved upload cannot refresh it", async () => {
    const user = userEvent.setup();
    const newerObservation = {
      ...observation,
      id: 13,
      captured_at: "2026-07-25T11:05:00Z",
      microscope_image_path: "images/1/7/new-upload.png",
      original_filename: "new-upload.png",
    };
    vi.mocked(api.listObservations)
      .mockResolvedValueOnce([observation])
      .mockRejectedValueOnce(new Error("History refresh failed"));
    vi.mocked(api.uploadObservation).mockResolvedValue(newerObservation);

    render(<LesionPanel {...panelProps()} />);

    expect(
      await screen.findByAltText("Microscope observation 12"),
    ).toBeInTheDocument();
    expect(screen.getByText("AI result test double")).toBeInTheDocument();

    const file = new File(["microscope"], "new-upload.png", {
      type: "image/png",
    });
    await user.selectOptions(
      screen.getByLabelText("Image source"),
      "upload",
    );
    await user.upload(screen.getByLabelText("Image file"), file);
    await user.click(
      screen.getByLabelText(
        "I confirm this file is a USB-microscope image.",
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Save, score and analyze" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "History refresh failed",
    );
    expect(
      await screen.findByText(
        /Microscope image saved.*Photo quality: 92%.*save succeeded.*History refresh failed/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByAltText("Microscope observation 12"),
    ).toBeInTheDocument();
    expect(
      screen.queryByAltText("Microscope observation 13"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("AI result test double")).not.toBeInTheDocument();
  });

  it("locks the submitted detail draft and restores it after a failed save", async () => {
    const user = userEvent.setup();
    const pendingSave = deferred<Lesion>();
    const updatedLesion = {
      ...lesionFixture,
      label: "Locked draft",
      notes: "Operator note",
    };
    vi.mocked(api.listObservations).mockResolvedValue([]);
    const props = panelProps();
    props.onUpdateLesion
      .mockReturnValueOnce(pendingSave.promise)
      .mockResolvedValueOnce(updatedLesion);
    render(<LesionPanel {...props} />);

    await user.click(
      screen.getByRole("button", { name: "Edit L-0001 details" }),
    );
    const form = screen.getByRole("form", {
      name: "Edit details for L-0001",
    });
    const label = screen.getByRole("textbox", { name: "Label" });
    const notes = screen.getByRole("textbox", { name: "Notes" });
    await user.clear(label);
    await user.type(label, "Locked draft");
    await user.type(notes, "Operator note");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(form).toHaveAttribute("aria-busy", "true");
    expect(label).toBeDisabled();
    expect(notes).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Saving…" }),
    ).toBeDisabled();
    expect(props.onUpdateLesion).toHaveBeenCalledWith(lesionFixture, {
      body_part: "chest",
      x: 0.1,
      y: 1.1,
      z: 0.3,
      label: "Locked draft",
      notes: "Operator note",
    });

    pendingSave.reject(new Error("Local lesion store is busy"));

    expect(
      await screen.findByText("Local lesion store is busy"),
    ).toBeInTheDocument();
    expect(form).toHaveAttribute("aria-busy", "false");
    expect(label).toBeEnabled();
    expect(label).toHaveValue("Locked draft");
    expect(notes).toBeEnabled();
    expect(notes).toHaveValue("Operator note");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("Lesion details updated."),
    ).toBeInTheDocument();
    expect(props.onUpdateLesion).toHaveBeenCalledTimes(2);
    expect(props.onUpdateLesion).toHaveBeenLastCalledWith(lesionFixture, {
      body_part: "chest",
      x: 0.1,
      y: 1.1,
      z: 0.3,
      label: "Locked draft",
      notes: "Operator note",
    });
  });

  it("does not close the current editor when an old lesion save succeeds", async () => {
    const user = userEvent.setup();
    const firstSave = deferred<Lesion>();
    vi.mocked(api.listObservations).mockResolvedValue([]);
    const firstProps = panelProps();
    firstProps.onUpdateLesion.mockReturnValue(firstSave.promise);
    const view = render(<LesionPanel {...firstProps} />);

    await user.click(
      screen.getByRole("button", { name: "Edit L-0001 details" }),
    );
    const firstLabel = screen.getByRole("textbox", { name: "Label" });
    await user.clear(firstLabel);
    await user.type(firstLabel, "First lesion draft");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const secondLesion = {
      ...lesionFixture,
      id: 8,
      lesion_code: "L-0002",
      label: "Second marker",
    };
    const secondProps = panelProps(secondLesion);
    view.rerender(<LesionPanel {...secondProps} />);

    await user.click(
      screen.getByRole("button", { name: "Edit L-0002 details" }),
    );
    const secondLabel = screen.getByRole("textbox", { name: "Label" });
    await user.clear(secondLabel);
    await user.type(secondLabel, "Current lesion draft");

    firstSave.resolve({
      ...lesionFixture,
      label: "First lesion draft",
    });
    await firstSave.promise;

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "L-0002" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("textbox", { name: "Label" }),
      ).toHaveValue("Current lesion draft");
      expect(
        screen.queryByText("Lesion details updated."),
      ).not.toBeInTheDocument();
    });
  });

  it("does not let a stale failure unlock a newer lesion save", async () => {
    const user = userEvent.setup();
    const firstSave = deferred<Lesion>();
    const secondSave = deferred<Lesion>();
    vi.mocked(api.listObservations).mockResolvedValue([]);
    const firstProps = panelProps();
    firstProps.onUpdateLesion.mockReturnValue(firstSave.promise);
    const view = render(<LesionPanel {...firstProps} />);

    await user.click(
      screen.getByRole("button", { name: "Edit L-0001 details" }),
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const secondLesion = {
      ...lesionFixture,
      id: 8,
      lesion_code: "L-0002",
      label: "Second marker",
    };
    const secondProps = panelProps(secondLesion);
    secondProps.onUpdateLesion.mockReturnValue(secondSave.promise);
    view.rerender(<LesionPanel {...secondProps} />);

    await user.click(
      screen.getByRole("button", { name: "Edit L-0002 details" }),
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      screen.getByRole("button", { name: "Saving…" }),
    ).toBeDisabled();

    firstSave.reject(new Error("Old lesion write failed"));
    await firstSave.promise.catch(() => undefined);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Saving…" }),
      ).toBeDisabled();
      expect(
        screen.queryByText("Old lesion write failed"),
      ).not.toBeInTheDocument();
    });

    secondSave.resolve(secondLesion);
    expect(
      await screen.findByText("Lesion details updated."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });
});
