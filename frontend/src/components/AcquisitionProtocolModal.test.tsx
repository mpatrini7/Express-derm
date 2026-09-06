import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { AcquisitionSetup } from "../types";
import { AcquisitionProtocolModal } from "./AcquisitionProtocolModal";

vi.mock("../api", () => ({
  api: {
    updateAcquisitionSetup: vi.fn(),
    uploadAcquisitionReference: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("AcquisitionProtocolModal", () => {
  beforeEach(() => {
    vi.mocked(api.updateAcquisitionSetup).mockReset();
    vi.mocked(api.uploadAcquisitionReference).mockReset();
  });

  it("preserves the protocol draft after a failed save and retries it", async () => {
    const user = userEvent.setup();
    const onUpdated = vi.fn();
    const revisedSetup = {
      ...setup,
      revision: 4,
      name: "Updated protocol",
      updated_at: "2026-07-26T15:00:00Z",
    };
    vi.mocked(api.updateAcquisitionSetup)
      .mockRejectedValueOnce(new Error("Local database is temporarily busy"))
      .mockResolvedValueOnce(revisedSetup);

    render(
      <AcquisitionProtocolModal
        setup={setup}
        onClose={vi.fn()}
        onUpdated={onUpdated}
      />,
    );

    const name = screen.getByRole("textbox", { name: "Protocol name" });
    await user.clear(name);
    await user.type(name, "Updated protocol");
    await user.click(
      screen.getByRole("button", { name: "Save new revision" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Local database is temporarily busy",
    );
    expect(name).toHaveValue("Updated protocol");

    await user.click(screen.getByRole("button", { name: "Retry save" }));

    expect(
      await screen.findByText("Protocol revision 4 saved."),
    ).toBeInTheDocument();
    expect(api.updateAcquisitionSetup).toHaveBeenCalledTimes(2);
    expect(api.updateAcquisitionSetup).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Updated protocol" }),
    );
    expect(onUpdated).toHaveBeenCalledWith(revisedSetup);
  });

  it("keeps unsaved field edits when a reference upload updates setup", async () => {
    const user = userEvent.setup();
    const uploadedSetup = {
      ...setup,
      revision: 4,
      scale_reference_path: "references/scale.png",
      updated_at: "2026-07-26T15:05:00Z",
    };
    vi.mocked(api.uploadAcquisitionReference).mockResolvedValue(uploadedSetup);
    let rerenderView!: ReturnType<typeof render>["rerender"];
    const onUpdated = vi.fn((updated: AcquisitionSetup) => {
      rerenderView(
        <AcquisitionProtocolModal
          setup={updated}
          onClose={vi.fn()}
          onUpdated={onUpdated}
        />,
      );
    });
    const view = render(
      <AcquisitionProtocolModal
        setup={setup}
        onClose={vi.fn()}
        onUpdated={onUpdated}
      />,
    );
    rerenderView = view.rerender;

    const name = screen.getByRole("textbox", { name: "Protocol name" });
    await user.clear(name);
    await user.type(name, "Unsaved working draft");
    const file = new File(["scale"], "scale.png", { type: "image/png" });
    await user.upload(
      screen.getByLabelText("Upload millimetre scale reference"),
      file,
    );

    expect(
      await screen.findByText("Scale reference saved."),
    ).toBeInTheDocument();
    expect(name).toHaveValue("Unsaved working draft");
    expect(api.uploadAcquisitionReference).toHaveBeenCalledWith("scale", file);
    expect(
      screen.getByRole("textbox", { name: "Protocol name" }),
    ).toHaveValue("Unsaved working draft");
  });

  it("keeps scale and color upload feedback independent", async () => {
    const user = userEvent.setup();
    const colorSetup = {
      ...setup,
      revision: 4,
      color_reference_path: "references/color.png",
    };
    vi.mocked(api.uploadAcquisitionReference).mockImplementation(
      (referenceType) =>
        referenceType === "scale"
          ? Promise.reject(new Error("Scale image could not be stored"))
          : Promise.resolve(colorSetup),
    );

    render(
      <AcquisitionProtocolModal
        setup={setup}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    await user.upload(
      screen.getByLabelText("Upload millimetre scale reference"),
      new File(["scale"], "scale.png", { type: "image/png" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Scale image could not be stored",
    );

    await user.upload(
      screen.getByLabelText("Upload color reference"),
      new File(["color"], "color.png", { type: "image/png" }),
    );

    expect(await screen.findByText("Color reference saved.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Scale image could not be stored",
    );
  });

  it("blocks controls and every close path while a write is pending", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const pendingSave = deferred<AcquisitionSetup>();
    vi.mocked(api.updateAcquisitionSetup).mockReturnValue(pendingSave.promise);

    render(
      <AcquisitionProtocolModal
        setup={setup}
        onClose={onClose}
        onUpdated={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Save new revision" }),
    );

    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", {
      name: "Close acquisition protocol",
    });
    await waitFor(() => expect(close).toBeDisabled());
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("textbox", { name: "Protocol name" }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText("Upload millimetre scale reference"),
    ).toBeDisabled();

    await user.keyboard("{Escape}");
    fireEvent.click(dialog.parentElement!);
    expect(onClose).not.toHaveBeenCalled();

    pendingSave.resolve({ ...setup, revision: 4 });
    await waitFor(() => expect(close).toBeEnabled());
    expect(dialog).toHaveAttribute("aria-busy", "false");
    await user.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("traps keyboard focus and restores the opening control", async () => {
    const user = userEvent.setup();
    const opener = document.createElement("button");
    opener.textContent = "Configure microscope";
    document.body.append(opener);
    opener.focus();

    const view = render(
      <AcquisitionProtocolModal
        setup={setup}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    const first = screen.getByRole("textbox", { name: "Protocol name" });
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(
      screen.getByRole("button", { name: "Close acquisition protocol" }),
    ).toHaveFocus();
    await user.tab({ shift: true });
    expect(
      screen.getByRole("button", { name: "Save new revision" }),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Close acquisition protocol" }),
    ).toHaveFocus();

    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
