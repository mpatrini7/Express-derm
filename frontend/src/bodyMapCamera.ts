import { HUMAN_MODEL_CENTER_Z, type BodyPoint } from "./bodyRegions";

const FOCUS_DISTANCE = 1.75;
const LATERAL_X_THRESHOLD = 0.42;
const LATERAL_DEPTH_BAND = 0.16;

export interface BodyMapFocusPose {
  target: [number, number, number];
  position: [number, number, number];
}

export function bodyMapFocusPose(point: BodyPoint): BodyMapFocusPose {
  const target: [number, number, number] = [point.x, point.y, point.z];
  const depth = point.z - HUMAN_MODEL_CENTER_Z;
  const lateral =
    Math.abs(point.x) > LATERAL_X_THRESHOLD &&
    Math.abs(depth) < LATERAL_DEPTH_BAND;

  if (lateral) {
    const direction = point.x < 0 ? -1 : 1;
    return {
      target,
      position: [
        point.x + direction * FOCUS_DISTANCE,
        point.y,
        point.z,
      ],
    };
  }

  const direction = depth < 0 ? -1 : 1;
  return {
    target,
    position: [
      point.x,
      point.y,
      point.z + direction * FOCUS_DISTANCE,
    ],
  };
}
