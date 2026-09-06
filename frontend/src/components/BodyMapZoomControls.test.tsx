import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BodyMapZoomControls } from "./BodyMapZoomControls";

describe("BodyMapZoomControls", () => {
  it("exposes separate accessible zoom commands", async () => {
    const user = userEvent.setup();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    render(
      <BodyMapZoomControls
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Zoom in on BodyMap" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Zoom out from BodyMap" }),
    );

    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
  });
});
