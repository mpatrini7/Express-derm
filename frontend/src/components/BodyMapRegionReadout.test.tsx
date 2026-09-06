import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BodyMapRegionReadout } from "./BodyMapRegionReadout";

describe("BodyMapRegionReadout", () => {
  it("shows a readable live target only while a region is available", () => {
    const { rerender } = render(
      <BodyMapRegionReadout region="left-underarm" />,
    );

    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Target: left underarm",
    );

    rerender(<BodyMapRegionReadout region={null} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
