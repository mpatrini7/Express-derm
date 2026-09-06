import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import { createBodySurfaceProjector } from "./bodyMapSurface";

describe("createBodySurfaceProjector", () => {
  it("anchors a marker to the outward surface of the model", () => {
    const scene = new Group();
    scene.add(new Mesh(new SphereGeometry(1), new MeshBasicMaterial()));
    const project = createBodySurfaceProjector(
      scene,
      [0, 0, 0],
      1,
    );

    expect(project({ x: 0.13, y: 0, z: 3 }).z).toBeCloseTo(1.002, 3);
  });

  it("keeps an unusable center point unchanged", () => {
    const scene = new Group();
    scene.add(new Mesh(new SphereGeometry(1), new MeshBasicMaterial()));
    const project = createBodySurfaceProjector(
      scene,
      [0, 0, 0],
      1,
    );

    expect(project({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});
