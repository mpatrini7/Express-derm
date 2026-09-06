import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PatientProfileModal } from "./PatientProfileModal";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("PatientProfileModal", () => {
  it("creates a patient profile with optional structured fields", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <PatientProfileModal
        patient={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Display label" }),
      "Study alias",
    );
    await user.type(
      screen.getByRole("spinbutton", { name: "Birth year" }),
      "1975",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Notes" }),
      "Non-identifying intake note.",
    );
    await user.click(
      screen.getByRole("button", { name: "Create patient" }),
    );

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        display_name: "Study alias",
        birth_year: 1975,
        notes: "Non-identifying intake note.",
      });
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves the complete draft after failure and retries the same profile", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Local patient store is busy"))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();

    render(
      <PatientProfileModal
        patient={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    const displayName = screen.getByRole("textbox", {
      name: "Display label",
    });
    const birthYear = screen.getByRole("spinbutton", { name: "Birth year" });
    const notes = screen.getByRole("textbox", { name: "Notes" });
    await user.type(displayName, "Retry alias");
    await user.type(birthYear, "1982");
    await user.type(notes, "Draft retained locally.");
    await user.click(screen.getByRole("button", { name: "Create patient" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Local patient store is busy",
    );
    expect(displayName).toHaveValue("Retry alias");
    expect(birthYear).toHaveValue(1982);
    expect(notes).toHaveValue("Draft retained locally.");

    await user.click(screen.getByRole("button", { name: "Create patient" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith({
      display_name: "Retry alias",
      birth_year: 1982,
      notes: "Draft retained locally.",
    });
  });

  it("blocks duplicate submission and every close path while saving", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    const pendingSave = deferred<void>();
    onSubmit.mockReturnValue(pendingSave.promise);

    render(
      <PatientProfileModal
        patient={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.submit(dialog);
    fireEvent.submit(dialog);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Close patient profile" }),
      ).toBeDisabled(),
    );
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("textbox", { name: "Display label" }),
    ).toBeDisabled();

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(dialog.parentElement!);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      pendingSave.resolve(undefined);
      await pendingSave.promise;
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("traps keyboard focus and restores the opening control", async () => {
    const user = userEvent.setup();
    const opener = document.createElement("button");
    opener.textContent = "Edit patient";
    document.body.append(opener);
    opener.focus();

    const view = render(
      <PatientProfileModal
        patient={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const firstField = screen.getByRole("textbox", {
      name: "Display label",
    });
    const close = screen.getByRole("button", {
      name: "Close patient profile",
    });
    const submit = screen.getByRole("button", { name: "Create patient" });
    expect(firstField).toHaveFocus();

    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(submit).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("ignores a successful response after the dialog unmounts", async () => {
    const pendingSave = deferred<void>();
    const onSubmit = vi.fn().mockReturnValue(pendingSave.promise);
    const onClose = vi.fn();
    const view = render(
      <PatientProfileModal
        patient={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    view.unmount();

    await act(async () => {
      pendingSave.resolve(undefined);
      await pendingSave.promise;
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
