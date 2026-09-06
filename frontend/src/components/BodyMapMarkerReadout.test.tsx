import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BodyMapMarkerReadout } from "./BodyMapMarkerReadout";

describe("BodyMapMarkerReadout", () => {
  it("announces marker identity, location and attention status", () => {
    const { rerender } = render(
      <BodyMapMarkerReadout
        lesion={{
          lesion_code: "L-0007",
          body_part: "left-underarm",
          attention_level: "high",
          risk_status: "experimental",
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Marker L-0007: left underarm, High · experimental",
    );

    rerender(<BodyMapMarkerReadout lesion={null} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
