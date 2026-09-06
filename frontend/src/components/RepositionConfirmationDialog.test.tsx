import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RepositionConfirmationDialog } from "./RepositionConfirmationDialog";

function renderDialog(
  onConfirm = vi.fn().mockResolvedValue(undefined),
  onCancel = vi.fn(),
) {
  render(
    <RepositionConfirmationDialog
      lesionCode="L-0001"
      currentBodyPart="chest"
      proposedBodyPart="left-underarm"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onCancel, onConfirm };
}

describe("RepositionConfirmationDialog", () => {
  it("shows the proposed move and contains keyboard focus", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Move marker" });

    expect(screen.getByText("chest")).toBeInTheDocument();
    expect(screen.getByText("left underarm")).toBeInTheDocument();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", {
        name: "Close marker move confirmation",
      }),
    ).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it("stays open and reports a failed marker update", async () => {
    const user = userEvent.setup();
    renderDialog(vi.fn().mockRejectedValue(new Error("Storage is busy")));

    await user.click(screen.getByRole("button", { name: "Move marker" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is busy");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancels with Escape while idle", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels from the backdrop while idle", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();
    const backdrop = document.querySelector<HTMLElement>(
      ".reposition-confirmation-backdrop",
    );

    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
