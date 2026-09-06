import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import {
  lesionFixture,
  relocationEventFixture,
} from "../test/fixtures";
import type { LongitudinalReview, Observation } from "../types";
import { LesionDetailModal } from "./LesionDetailModal";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const longitudinalObservations: Observation[] = [
  {
    id: 11,
    lesion_id: lesionFixture.id,
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
    notes: null,
    created_at: "2026-06-20T10:00:00Z",
    acquisition: null,
  },
  {
    id: 12,
    lesion_id: lesionFixture.id,
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
    notes: null,
    created_at: "2026-07-20T10:00:00Z",
    acquisition: null,
  },
];

vi.mock("../api", () => ({
  api: {
    listObservations: vi.fn(),
    listLesionAuditEvents: vi.fn(),
    listLongitudinalReviews: vi.fn(),
    createLongitudinalReview: vi.fn(),
    deleteObservation: vi.fn(),
  },
}));

describe("LesionDetailModal", () => {
  beforeEach(() => {
    vi.mocked(api.listObservations).mockResolvedValue([]);
    vi.mocked(api.listLesionAuditEvents).mockResolvedValue([
      relocationEventFixture,
    ]);
    vi.mocked(api.listLongitudinalReviews).mockResolvedValue([]);
    vi.mocked(api.createLongitudinalReview).mockReset();
    vi.mocked(api.deleteObservation).mockReset();
  });

  it("shows immutable marker relocation history", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const currentLesion = {
      ...lesionFixture,
      ...relocationEventFixture.current_state,
      last_activity_at: relocationEventFixture.created_at,
    };

    render(
      <LesionDetailModal
        lesion={currentLesion}
        onClose={onClose}
        onChanged={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Lesion changes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Marker repositioned")).toBeInTheDocument();
    expect(screen.getByText("chest → left underarm")).toBeInTheDocument();
    expect(
      screen.getByText("Initial marker was too low."),
    ).toBeInTheDocument();
    expect(api.listObservations).toHaveBeenCalledWith(lesionFixture.id);
    expect(api.listLesionAuditEvents).toHaveBeenCalledWith(
      lesionFixture.id,
    );
    expect(api.listLongitudinalReviews).toHaveBeenCalledWith(
      lesionFixture.id,
    );

    const close = screen.getByRole("button", {
      name: "Close lesion details",
    });
    expect(close).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("distinguishes unavailable history from an empty history and retries", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listObservations)
      .mockRejectedValueOnce(new Error("Microscope history unavailable"))
      .mockResolvedValueOnce([]);

    render(
      <LesionDetailModal
        lesion={lesionFixture}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Lesion history could not be loaded");
    expect(alert).toHaveTextContent("Microscope history unavailable");
    expect(
      within(screen.getByText("Recorded edits").closest("div")!).getByText(
        "Unavailable",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Microscope history is unavailable."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Lesion history must load before AI evaluation is available.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No microscope images saved."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "An accepted microscope capture is required before AI evaluation.",
      ),
    ).not.toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByText("No microscope images saved."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Lesion history could not be loaded"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByText("Recorded edits").closest("div")!).getByText("1"),
    ).toBeInTheDocument();
    expect(api.listObservations).toHaveBeenCalledTimes(2);
    expect(api.listLesionAuditEvents).toHaveBeenCalledTimes(2);
    expect(api.listLongitudinalReviews).toHaveBeenCalledTimes(2);
  });

  it("ignores history returned for a previously open lesion", async () => {
    const firstAuditResponse = deferred<
      Array<typeof relocationEventFixture>
    >();
    const secondLesion = {
      ...lesionFixture,
      id: 8,
      lesion_code: "L-0002",
      body_part: "left-forearm",
      label: "Second marker",
    };
    vi.mocked(api.listLesionAuditEvents).mockImplementation((lesionId) =>
      lesionId === lesionFixture.id
        ? firstAuditResponse.promise
        : Promise.resolve([]),
    );

    const { rerender } = render(
      <LesionDetailModal
        lesion={lesionFixture}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(api.listLesionAuditEvents).toHaveBeenCalledWith(lesionFixture.id);
    });

    rerender(
      <LesionDetailModal
        lesion={secondLesion}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "L-0002" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("No microscope images saved."),
    ).toBeInTheDocument();

    firstAuditResponse.resolve([relocationEventFixture]);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "L-0002" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Marker repositioned")).not.toBeInTheDocument();
    });
  });

  it("prevents closing while an operator review is being saved", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const pendingReview = deferred<LongitudinalReview>();
    vi.mocked(api.listObservations).mockResolvedValue(longitudinalObservations);
    vi.mocked(api.createLongitudinalReview).mockReturnValue(
      pendingReview.promise,
    );

    render(
      <LesionDetailModal
        lesion={lesionFixture}
        onClose={onClose}
        onChanged={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("radio", { name: "Uncertain" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save operator review" }),
    );

    const close = screen.getByRole("button", {
      name: "Close lesion details",
    });
    await waitFor(() => expect(close).toBeDisabled());
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).not.toHaveBeenCalled();

    pendingReview.resolve({
      id: 3,
      lesion_id: lesionFixture.id,
      baseline_observation_id: 11,
      comparison_observation_id: 12,
      change_flag: "uncertain",
      notes: null,
      created_at: "2026-07-26T14:00:00Z",
    });

    await waitFor(() => expect(close).toBeEnabled());
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "false");
    await user.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("removes one image from detail history without closing the lesion", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.listObservations).mockResolvedValue(longitudinalObservations);
    vi.mocked(api.deleteObservation).mockResolvedValue(undefined);

    render(
      <LesionDetailModal
        lesion={lesionFixture}
        onClose={vi.fn()}
        onChanged={onChanged}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Delete microscope observation 11",
      }),
    );
    await user.type(
      screen.getByLabelText(/Type IMG-0011 to confirm/),
      "IMG-0011",
    );
    await user.click(screen.getByRole("button", { name: "Delete image" }));

    expect(
      await screen.findByText("Microscope image deleted. Lesion retained."),
    ).toBeInTheDocument();
    expect(api.deleteObservation).toHaveBeenCalledWith(11);
    expect(onChanged).toHaveBeenCalledOnce();
    expect(
      screen.queryByAltText("Microscope observation 11"),
    ).not.toBeInTheDocument();
    expect(screen.getByAltText("Microscope observation 12")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: lesionFixture.lesion_code }),
    ).toBeInTheDocument();
  });
});
