import { describe, expect, it } from "vitest";
import { HUMAN_MODEL_CENTER_Z } from "./bodyRegions";
import { bodyMapFocusPose } from "./bodyMapCamera";

describe("bodyMapFocusPose", () => {
  it("approaches anterior and posterior markers from the visible surface", () => {
    expect(bodyMapFocusPose({ x: 0.1, y: 1, z: 0.3 })).toEqual({
      target: [0.1, 1, 0.3],
      position: [0.1, 1, 2.05],
    });
    expect(bodyMapFocusPose({ x: 0.1, y: 1, z: -0.6 })).toEqual({
      target: [0.1, 1, -0.6],
      position: [0.1, 1, -2.35],
    });
  });

  it("approaches underarm markers from the corresponding side", () => {
    expect(
      bodyMapFocusPose({
        x: -0.55,
        y: 1.5,
        z: HUMAN_MODEL_CENTER_Z,
      }),
    ).toEqual({
      target: [-0.55, 1.5, HUMAN_MODEL_CENTER_Z],
      position: [-2.3, 1.5, HUMAN_MODEL_CENTER_Z],
    });
    expect(
      bodyMapFocusPose({
        x: 0.55,
        y: 1.5,
        z: HUMAN_MODEL_CENTER_Z,
      }),
    ).toEqual({
      target: [0.55, 1.5, HUMAN_MODEL_CENTER_Z],
      position: [2.3, 1.5, HUMAN_MODEL_CENTER_Z],
    });
  });
});
