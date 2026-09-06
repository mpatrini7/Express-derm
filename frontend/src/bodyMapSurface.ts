import { DoubleSide, Mesh, Object3D, Raycaster, Vector3 } from "three";
import type { BodyPoint } from "./bodyRegions";

const MARKER_SURFACE_OFFSET = 0.006;

export function createBodySurfaceProjector(
  scene: Object3D,
  modelPosition: readonly [number, number, number],
  modelScale: number,
) {
  const surfaceModel = scene.clone(true);
  surfaceModel.position.set(...modelPosition);
  surfaceModel.scale.setScalar(modelScale);
  surfaceModel.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => {
          const clone = material.clone();
          clone.side = DoubleSide;
          return clone;
        })
      : (() => {
          const clone = child.material.clone();
          clone.side = DoubleSide;
          return clone;
        })();
  });
  surfaceModel.updateMatrixWorld(true);

  const center = new Vector3(...modelPosition);
  const rayOrigin = new Vector3();
  const direction = new Vector3();
  const inwardDirection = new Vector3();
  const raycaster = new Raycaster();

  return (point: BodyPoint): BodyPoint => {
    direction.set(
      point.x - center.x,
      point.y - center.y,
      point.z - center.z,
    );

    if (direction.lengthSq() < Number.EPSILON) return point;

    direction.normalize();
    // Start outside the body and trace inward. This remains reliable when the
    // saved marker is inside the new mesh or came from an older body model.
    rayOrigin.copy(center).addScaledVector(direction, 20);
    inwardDirection.copy(direction).negate();
    raycaster.set(rayOrigin, inwardDirection);
    const intersections = raycaster
      .intersectObject(surfaceModel, true)
      .filter((intersection) => intersection.object instanceof Mesh);
    const hit = intersections[0];

    if (!hit) return point;

    const surfacePoint = hit.point
      .clone()
      .addScaledVector(direction, MARKER_SURFACE_OFFSET);
    return {
      x: surfacePoint.x,
      y: surfacePoint.y,
      z: surfacePoint.z,
    };
  };
}
