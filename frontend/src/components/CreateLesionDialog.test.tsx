import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreateLesionDialog } from "./CreateLesionDialog";

function renderDialog(
  onConfirm = vi.fn().mockResolvedValue(undefined),
  onCancel = vi.fn(),
) {
  render(
    <CreateLesionDialog
      bodyPart="left-underarm"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onCancel, onConfirm };
}

describe("CreateLesionDialog", () => {
  it("shows the proposed location and submits a trimmed optional label", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    const label = screen.getByRole("textbox", {
      name: "Display label (optional)",
    });

    expect(screen.getByText("left underarm")).toBeInTheDocument();
    expect(label).toHaveFocus();
    await user.type(label, "  Axillary baseline  ");
    await user.click(screen.getByRole("button", { name: "Add marker" }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith("Axillary baseline"),
    );
  });

  it("submits a blank label as null", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Add marker" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(null));
  });

  it("stays open and reports a failed marker creation", async () => {
    const user = userEvent.setup();
    renderDialog(vi.fn().mockRejectedValue(new Error("Storage is busy")));

    await user.click(screen.getByRole("button", { name: "Add marker" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is busy");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancels with Escape or a backdrop click while idle", async () => {
    const user = userEvent.setup();
    const first = renderDialog();

    await user.keyboard("{Escape}");
    expect(first.onCancel).toHaveBeenCalledOnce();

    first.onCancel.mockClear();
    const backdrop = document.querySelector<HTMLElement>(
      ".create-lesion-backdrop",
    );
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(first.onCancel).toHaveBeenCalledOnce();
  });
});
