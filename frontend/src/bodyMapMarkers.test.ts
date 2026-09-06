import { describe, expect, it } from "vitest";
import { bodyMapMarkerScale } from "./bodyMapMarkers";

describe("bodyMapMarkerScale", () => {
  it("keeps overview markers near their authored size", () => {
    expect(bodyMapMarkerScale(8.4, false)).toBe(0.9);
    expect(bodyMapMarkerScale(20, false)).toBe(0.9);
  });

  it("shrinks close markers and retains a restrained hover target", () => {
    expect(bodyMapMarkerScale(1.75, false)).toBeCloseTo(1.75 / 8.4);
    expect(bodyMapMarkerScale(0.7, false)).toBe(0.18);
    expect(bodyMapMarkerScale(1.75, true)).toBeCloseTo((1.75 / 8.4) * 1.18);
  });
});
