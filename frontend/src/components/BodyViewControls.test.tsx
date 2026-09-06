import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BodyViewControls } from "./BodyViewControls";

describe("BodyViewControls", () => {
  it("exposes the active preset and permits repeated recentering", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <BodyViewControls activeView="front" onSelect={onSelect} />,
    );

    const front = screen.getByRole("button", {
      name: "Front",
      pressed: true,
    });
    await user.click(front);
    expect(onSelect).toHaveBeenLastCalledWith("front");

    rerender(<BodyViewControls activeView="back" onSelect={onSelect} />);
    expect(
      screen.getByRole("button", { name: "Back", pressed: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Front", pressed: false }),
    ).toBeInTheDocument();
  });
});
