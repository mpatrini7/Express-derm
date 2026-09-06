const REFERENCE_CAMERA_DISTANCE = 8.4;
const MIN_MARKER_SCALE = 0.18;
const MAX_MARKER_SCALE = 0.9;
const HOVER_SCALE = 1.18;

export function bodyMapMarkerScale(
  cameraDistance: number,
  hovered: boolean,
) {
  const distanceScale = Math.min(
    MAX_MARKER_SCALE,
    Math.max(MIN_MARKER_SCALE, cameraDistance / REFERENCE_CAMERA_DISTANCE),
  );
  return distanceScale * (hovered ? HOVER_SCALE : 1);
}
