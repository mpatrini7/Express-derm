export interface BodyPoint {
  x: number;
  y: number;
  z: number;
}

export const HUMAN_MODEL_CENTER_Z = -0.18;
const LATERAL_DEPTH_BAND = 0.08;

type BodySurface = "anterior" | "posterior" | "lateral";

function sideName(point: BodyPoint) {
  return point.x < 0 ? "left" : "right";
}

function bodySurface(point: BodyPoint): BodySurface {
  const depth = point.z - HUMAN_MODEL_CENTER_Z;
  if (depth > LATERAL_DEPTH_BAND) return "anterior";
  if (depth < -LATERAL_DEPTH_BAND) return "posterior";
  return "lateral";
}

export function formatBodyRegion(value: string) {
  return value.replaceAll("-", " ");
}

export function anatomicalRegion(point: BodyPoint) {
  const side = sideName(point);
  const surface = bodySurface(point);
  const x = Math.abs(point.x);

  if (point.y > 2.05) {
    if (point.z > 0.31 && x < 0.09) return "nose";
    if (x > 0.23) return `${side}-ear`;
    if (surface === "anterior") return "face";
    if (surface === "posterior") return "back-of-head";
    return `${side}-side-of-head`;
  }

  if (point.y > 1.78 && x < 0.42) {
    if (surface === "anterior") return "front-neck";
    if (surface === "posterior") return "back-of-neck";
    return `${side}-side-of-neck`;
  }

  if (point.y > 1.18) {
    if (x > 2.12) return `${side}-hand`;
    if (x > 1.35) return `${side}-forearm`;
    if (x > 1.14) return `${side}-elbow`;
    if (x > 0.72) return `${side}-upper-arm`;
    if (x > 0.43 && point.y < 1.72) return `${side}-underarm`;
    if (x > 0.43) return `${side}-shoulder`;
  }

  if (point.y > 0.75) {
    if (surface === "anterior") return "chest";
    if (surface === "posterior") return "upper-back";
    return `${side}-ribcage`;
  }
  if (point.y > 0.08) {
    if (surface === "anterior") return "abdomen";
    if (surface === "posterior") return "lower-back";
    return `${side}-flank`;
  }
  if (point.y > -0.42) {
    if (surface === "anterior") return "pelvis";
    if (surface === "posterior") return `${side}-buttock`;
    return `${side}-hip`;
  }
  if (point.y > -1.35) return `${side}-thigh`;
  if (point.y > -1.62) return `${side}-knee`;
  if (point.y > -2.32) return `${side}-lower-leg`;
  return `${side}-foot`;
}
