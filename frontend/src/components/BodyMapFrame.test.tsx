import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BodyMapFrame } from "./BodyMapFrame";

function renderFrame(
  repositioningCode: string | null = null,
  onCancelReposition = vi.fn(),
  selectedLesionCode: string | null = null,
  onFocusSelected = vi.fn(),
) {
  render(
    <BodyMapFrame
      status={
        repositioningCode
          ? `Repositioning ${repositioningCode}`
          : "Click body to add lesion"
      }
      repositioningCode={repositioningCode}
      selectedLesionCode={selectedLesionCode}
      busy={false}
      onCancelReposition={onCancelReposition}
      onFocusSelected={onFocusSelected}
      footer={<footer>Marker legend</footer>}
    >
      <div>
        Body canvas
        <button type="button">Last map control</button>
      </div>
    </BodyMapFrame>,
  );
  return { onCancelReposition, onFocusSelected };
}

describe("BodyMapFrame", () => {
  it("opens an accessible expanded view and restores the normal view", async () => {
    const user = userEvent.setup();
    renderFrame();

    const expand = screen.getByRole("button", { name: "Expand BodyMap" });
    await user.click(expand);

    const dialog = screen.getByRole("dialog", { name: "3D BodyMap" });
    const exit = screen.getByRole("button", {
      name: "Exit expanded BodyMap",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(exit).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    await user.tab({ shift: true });
    expect(
      screen.getByRole("button", { name: "Last map control" }),
    ).toHaveFocus();
    await user.tab();
    expect(exit).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand BodyMap" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes from the backdrop and preserves repositioning controls", async () => {
    const user = userEvent.setup();
    const { onCancelReposition } = renderFrame("L-0004");

    await user.click(
      screen.getByRole("button", { name: "Cancel marker repositioning" }),
    );
    expect(onCancelReposition).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Expand BodyMap" }));
    const backdrop = document.querySelector<HTMLElement>(
      ".bodymap-focus-backdrop",
    );
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers a focus command only for the selected lesion", async () => {
    const user = userEvent.setup();
    const onFocusSelected = vi.fn();
    const { rerender } = render(
      <BodyMapFrame
        status="Click body to add lesion"
        repositioningCode={null}
        selectedLesionCode="L-0003"
        busy={false}
        onCancelReposition={vi.fn()}
        onFocusSelected={onFocusSelected}
        footer={<footer>Marker legend</footer>}
      >
        <div>Body canvas</div>
      </BodyMapFrame>,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Focus BodyMap on L-0003",
      }),
    );
    expect(onFocusSelected).toHaveBeenCalledOnce();

    rerender(
      <BodyMapFrame
        status="Click body to add lesion"
        repositioningCode={null}
        selectedLesionCode={null}
        busy={false}
        onCancelReposition={vi.fn()}
        onFocusSelected={onFocusSelected}
        footer={<footer>Marker legend</footer>}
      >
        <div>Body canvas</div>
      </BodyMapFrame>,
    );
    expect(
      screen.queryByRole("button", {
        name: "Focus BodyMap on L-0003",
      }),
    ).not.toBeInTheDocument();
  });
});
