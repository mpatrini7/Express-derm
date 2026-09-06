import { describe, expect, it } from "vitest";
import {
  anatomicalRegion,
  formatBodyRegion,
  HUMAN_MODEL_CENTER_Z,
} from "./bodyRegions";

describe("anatomicalRegion", () => {
  it("distinguishes anterior, posterior and lateral torso surfaces", () => {
    expect(anatomicalRegion({ x: 0.1, y: 1, z: 0.31 })).toBe("chest");
    expect(anatomicalRegion({ x: 0.1, y: 1, z: -0.67 })).toBe(
      "upper-back",
    );
    expect(
      anatomicalRegion({ x: -0.55, y: 1, z: HUMAN_MODEL_CENTER_Z }),
    ).toBe("left-ribcage");

    expect(anatomicalRegion({ x: 0.1, y: 0.4, z: 0.31 })).toBe("abdomen");
    expect(anatomicalRegion({ x: 0.1, y: 0.4, z: -0.67 })).toBe(
      "lower-back",
    );
    expect(
      anatomicalRegion({ x: 0.5, y: 0.4, z: HUMAN_MODEL_CENTER_Z }),
    ).toBe("right-flank");

    expect(anatomicalRegion({ x: 0.1, y: 0, z: 0.31 })).toBe("pelvis");
    expect(anatomicalRegion({ x: 0.1, y: 0, z: -0.67 })).toBe(
      "right-buttock",
    );
    expect(
      anatomicalRegion({ x: -0.45, y: 0, z: HUMAN_MODEL_CENTER_Z }),
    ).toBe("left-hip");
  });

  it("keeps head, neck, axillary and limb labels deterministic", () => {
    expect(anatomicalRegion({ x: 0, y: 2.2, z: 0.4 })).toBe("nose");
    expect(anatomicalRegion({ x: 0.15, y: 2.2, z: 0.3 })).toBe("face");
    expect(anatomicalRegion({ x: 0.15, y: 2.2, z: -0.55 })).toBe(
      "back-of-head",
    );
    expect(anatomicalRegion({ x: -0.3, y: 2.2, z: -0.18 })).toBe(
      "left-ear",
    );
    expect(anatomicalRegion({ x: 0.1, y: 1.9, z: -0.55 })).toBe(
      "back-of-neck",
    );
    expect(anatomicalRegion({ x: -0.55, y: 1.5, z: -0.18 })).toBe(
      "left-underarm",
    );
    expect(anatomicalRegion({ x: 1.6, y: 1.5, z: 0.1 })).toBe(
      "right-forearm",
    );
  });
});

describe("formatBodyRegion", () => {
  it("turns stored region keys into readable labels", () => {
    expect(formatBodyRegion("left-underarm")).toBe("left underarm");
    expect(formatBodyRegion("upper-back")).toBe("upper back");
  });
});
