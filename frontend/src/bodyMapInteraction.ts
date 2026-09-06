export const BODY_MAP_CLICK_TOLERANCE_PX = 5;
const BODY_MAP_CAMERA_MOVEMENT_EPSILON = 0.000001;

interface Point3D {
  x: number;
  y: number;
  z: number;
}

export function isIntentionalBodyMapClick(pointerDelta: number) {
  return (
    Number.isFinite(pointerDelta) &&
    pointerDelta >= 0 &&
    pointerDelta <= BODY_MAP_CLICK_TOLERANCE_PX
  );
}

function squaredDistance(start: Point3D, end: Point3D) {
  const x = end.x - start.x;
  const y = end.y - start.y;
  const z = end.z - start.z;
  return x * x + y * y + z * z;
}

export function hasBodyMapCameraMoved(
  startPosition: Point3D,
  endPosition: Point3D,
  startTarget: Point3D,
  endTarget: Point3D,
) {
  const threshold = BODY_MAP_CAMERA_MOVEMENT_EPSILON ** 2;
  return (
    squaredDistance(startPosition, endPosition) > threshold ||
    squaredDistance(startTarget, endTarget) > threshold
  );
}
