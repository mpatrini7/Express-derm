import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  LongitudinalReview as LongitudinalReviewRecord,
  Observation,
} from "../types";
import { LongitudinalReview } from "./LongitudinalReview";

const observations: Observation[] = [
  {
    id: 11,
    lesion_id: 7,
    captured_at: "2026-06-20T10:00:00Z",
    microscope_image_path: "images/1/7/baseline.png",
    original_filename: "baseline.png",
    mime_type: "image/png",
    device_id: "manual-upload:usb-microscope-confirmed",
    focus_score: 155,
    mean_brightness: 120,
    dark_fraction: 0,
    bright_fraction: 0,
    quality_score: 90,
    quality_status: "accepted",
    quality_reason: null,
    notes: "Baseline",
    created_at: "2026-06-20T10:00:00Z",
    acquisition: null,
  },
  {
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
    quality_score: 94,
    quality_status: "accepted",
    quality_reason: null,
    notes: "Comparison",
    created_at: "2026-07-20T10:00:00Z",
    acquisition: null,
  },
  {
    id: 13,
    lesion_id: 7,
    captured_at: "2026-07-21T10:00:00Z",
    microscope_image_path: "images/1/7/rejected.png",
    original_filename: "rejected.png",
    mime_type: "image/png",
    device_id: "manual-upload:usb-microscope-confirmed",
    focus_score: 2,
    mean_brightness: 120,
    dark_fraction: 0,
    bright_fraction: 0,
    quality_score: 50,
    quality_status: "rejected",
    quality_reason: "Image is out of focus",
    notes: null,
    created_at: "2026-07-21T10:00:00Z",
    acquisition: null,
  },
];

const savedReview: LongitudinalReviewRecord = {
  id: 3,
  lesion_id: 7,
  baseline_observation_id: 11,
  comparison_observation_id: 12,
  change_flag: "uncertain",
  notes: "Repeat with matched illumination.",
  created_at: "2026-07-22T09:30:00Z",
};

describe("LongitudinalReview", () => {
  it("compares accepted captures and saves an operator-only flag", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <LongitudinalReview
        observations={observations}
        reviews={[savedReview]}
        saving={false}
        onSave={onSave}
      />,
    );

    expect(
      await screen.findByAltText("Baseline microscope observation 11"),
    ).toBeInTheDocument();
    expect(
      screen.getByAltText("Comparison microscope observation 12"),
    ).toBeInTheDocument();
    expect(
      screen.queryByAltText("Comparison microscope observation 13"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Repeat with matched illumination.")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Zoom in comparison images" }),
    );
    expect(screen.getByText("Zoom 125%")).toBeInTheDocument();

    await user.click(
      screen.getByRole("radio", { name: "Visual change recorded" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Review note" }),
      "Color distribution appears different.",
    );
    await user.click(
      screen.getByRole("button", { name: "Save operator review" }),
    );

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        baseline_observation_id: 11,
        comparison_observation_id: 12,
        change_flag: "change_observed",
        notes: "Color distribution appears different.",
      });
    });
    expect(
      await screen.findByText("Operator review saved."),
    ).toBeInTheDocument();
  });

  it("excludes a legacy upload without microscope source confirmation", () => {
    render(
      <LongitudinalReview
        observations={[
          observations[0],
          { ...observations[1], device_id: "upload" },
        ]}
        reviews={[]}
        saving={false}
        onSave={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        /Two source-confirmed, quality-accepted microscope captures/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByAltText("Comparison microscope observation 12"),
    ).not.toBeInTheDocument();
  });

  it("preserves the review after a failed save and retries it", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("Local database is temporarily busy"))
      .mockResolvedValueOnce(undefined);

    render(
      <LongitudinalReview
        observations={observations}
        reviews={[]}
        saving={false}
        onSave={onSave}
      />,
    );

    const flag = screen.getByRole("radio", {
      name: "Visual change recorded",
    });
    const note = screen.getByRole("textbox", { name: "Review note" });
    await user.click(flag);
    await user.type(note, "Pigment pattern needs another review.");
    await user.click(
      screen.getByRole("button", { name: "Save operator review" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Review was not saved");
    expect(alert).toHaveTextContent("Local database is temporarily busy");
    expect(flag).toBeChecked();
    expect(note).toHaveValue("Pigment pattern needs another review.");

    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenLastCalledWith({
      baseline_observation_id: 11,
      comparison_observation_id: 12,
      change_flag: "change_observed",
      notes: "Pigment pattern needs another review.",
    });
    expect(
      await screen.findByText("Operator review saved."),
    ).toBeInTheDocument();
    expect(flag).not.toBeChecked();
    expect(note).toHaveValue("");
    expect(screen.queryByText("Review was not saved")).not.toBeInTheDocument();
  });
});
