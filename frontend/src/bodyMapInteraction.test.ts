import { describe, expect, it } from "vitest";
import {
  BODY_MAP_CLICK_TOLERANCE_PX,
  hasBodyMapCameraMoved,
  isIntentionalBodyMapClick,
} from "./bodyMapInteraction";

describe("isIntentionalBodyMapClick", () => {
  it("accepts a stationary click and small pointer jitter", () => {
    expect(isIntentionalBodyMapClick(0)).toBe(true);
    expect(
      isIntentionalBodyMapClick(BODY_MAP_CLICK_TOLERANCE_PX),
    ).toBe(true);
  });

  it("rejects camera drags and invalid pointer deltas", () => {
    expect(
      isIntentionalBodyMapClick(BODY_MAP_CLICK_TOLERANCE_PX + 0.01),
    ).toBe(false);
    expect(isIntentionalBodyMapClick(-1)).toBe(false);
    expect(isIntentionalBodyMapClick(Number.NaN)).toBe(false);
    expect(isIntentionalBodyMapClick(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("hasBodyMapCameraMoved", () => {
  const camera = { x: 0, y: 0, z: 8 };
  const target = { x: 0, y: 0, z: 0 };

  it("keeps the active preset for a stationary pointer gesture", () => {
    expect(
      hasBodyMapCameraMoved(camera, { ...camera }, target, { ...target }),
    ).toBe(false);
  });

  it("detects orbit, zoom and target movement", () => {
    expect(
      hasBodyMapCameraMoved(
        camera,
        { x: 1, y: 0, z: 7.9 },
        target,
        target,
      ),
    ).toBe(true);
    expect(
      hasBodyMapCameraMoved(
        camera,
        { x: 0, y: 0, z: 7 },
        target,
        target,
      ),
    ).toBe(true);
    expect(
      hasBodyMapCameraMoved(
        camera,
        camera,
        target,
        { x: 0.1, y: 0, z: 0 },
      ),
    ).toBe(true);
  });
});
