import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const CLERESTORY_Z = [-5.5, 0, 5.5] as const;
export const SKYLIGHT = { width: 2.38, length: 18.6, wellDepth: 0.5 };
type Hole = { x: number; y: number; width: number; height: number };

export function panelWithOpenings(
  width: number,
  height: number,
  holes: readonly Hole[],
) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height / 2);
  shape.lineTo(-width / 2, height / 2);
  shape.closePath();
  for (const hole of holes) {
    const path = new THREE.Path(),
      x = hole.x - hole.width / 2,
      y = hole.y - hole.height / 2;
    path.moveTo(x, y);
    path.lineTo(x, y + hole.height);
    path.lineTo(x + hole.width, y + hole.height);
    path.lineTo(x + hole.width, y);
    path.closePath();
    shape.holes.push(path);
  }
  const geometry = new THREE.ShapeGeometry(shape);
  // ShapeGeometry's default metre UVs would change the plaster's scale.
  const positions = geometry.getAttribute("position"),
    uv = geometry.getAttribute("uv");
  for (let i = 0; i < positions.count; i++)
    uv.setXY(
      i,
      positions.getX(i) / width + 0.5,
      positions.getY(i) / height + 0.5,
    );
  return geometry;
}

function mergedMesh(
  scene: THREE.Scene,
  name: string,
  parts: THREE.BufferGeometry[],
  material: THREE.Material,
) {
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error("Could not merge " + name);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  scene.add(mesh);
  return mesh;
}
function plane(
  width: number,
  height: number,
  x: number,
  y: number,
  z: number,
  ry = 0,
  rx = 0,
) {
  const g = new THREE.PlaneGeometry(width, height);
  g.rotateX(rx);
  g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export function addOpeningDetails(
  scene: THREE.Scene,
  wallMaterial: THREE.Material,
  ceilingMaterial: THREE.Material,
  barsMaterial: THREE.Material,
  ceilingHeight: number,
) {
  const { width, length, wellDepth } = SKYLIGHT,
    y = ceilingHeight + wellDepth / 2;
  mergedMesh(
    scene,
    "Skylight light well",
    [
      plane(length, wellDepth, -width / 2, y, 0, Math.PI / 2),
      plane(length, wellDepth, width / 2, y, 0, -Math.PI / 2),
      plane(width, wellDepth, 0, y, -length / 2),
      plane(width, wellDepth, 0, y, length / 2, Math.PI),
    ],
    ceilingMaterial,
  );
  const bars = [box(0.025, 0.035, length, 0, ceilingHeight + wellDepth, 0)];
  for (let z = -8.4; z <= 8.401; z += 1.2)
    bars.push(box(width, 0.035, 0.025, 0, ceilingHeight + wellDepth, z));
  mergedMesh(scene, "Skylight glazing bars", bars, barsMaterial);
  for (const side of [-1, 1]) {
    const x = side * 4.5,
      outward = x + side * 0.125,
      reveals: THREE.BufferGeometry[] = [],
      mullions: THREE.BufferGeometry[] = [];
    for (const z of CLERESTORY_Z) {
      // All reveal depth is outside the existing collision boundary.
      reveals.push(
        plane(0.25, 0.8, outward, 3.55, z - 1.3),
        plane(0.25, 0.8, outward, 3.55, z + 1.3, Math.PI),
      );
      reveals.push(
        plane(0.25, 2.6, outward, 3.15, z, 0, -Math.PI / 2),
        plane(0.25, 2.6, outward, 3.95, z, 0, Math.PI / 2),
      );
      for (const offset of [-2.6 / 6, 2.6 / 6])
        mullions.push(
          box(0.035, 0.8, 0.025, x + side * 0.22, 3.55, z + offset),
        );
    }
    mergedMesh(
      scene,
      side > 0 ? "East window reveals" : "West window reveals",
      reveals,
      wallMaterial,
    );
    mergedMesh(
      scene,
      side > 0 ? "East mullions" : "West mullions",
      mullions,
      barsMaterial,
    );
  }
}
