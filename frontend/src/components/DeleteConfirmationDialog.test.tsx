import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";

function renderDialog(
  onConfirm = vi.fn().mockResolvedValue(undefined),
  onCancel = vi.fn(),
) {
  render(
    <DeleteConfirmationDialog
      title="Delete patient ED-0001?"
      recordCode="ED-0001"
      description="This permanently removes the complete local record."
      impacts={[
        { label: "Mapped lesions", value: 3 },
        { label: "Observations", value: 8 },
        { label: "Accepted coverage", value: "2/3" },
      ]}
      confirmLabel="Delete patient"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onCancel, onConfirm };
}

describe("DeleteConfirmationDialog", () => {
  it("requires the exact record code before confirming deletion", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    const input = screen.getByRole("textbox", {
      name: /Type ED-0001 to confirm/,
    });
    const confirm = screen.getByRole("button", { name: "Delete patient" });

    expect(input).toHaveFocus();
    expect(confirm).toBeDisabled();
    await user.type(input, "ed-0001");
    expect(confirm).toBeDisabled();

    await user.clear(input);
    await user.type(input, "ED-0001");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it("keeps the dialog open and reports a failed deletion", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error("Storage is busy"));
    renderDialog(onConfirm);

    await user.type(
      screen.getByRole("textbox", { name: /Type ED-0001 to confirm/ }),
      "ED-0001",
    );
    await user.click(
      screen.getByRole("button", { name: "Delete patient" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Storage is busy",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancels with Escape while idle", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
