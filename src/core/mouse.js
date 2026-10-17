// Procedural "computer mouse" model, built from primitives + transforms.
// Everything is expressed as scene nodes so the same model renders in the
// headless CPU renderer, exports to GLB, and shows up in the web viewport.
import { createScene, addNode, sceneStats } from "./scene.js";

export const MOUSE_MATERIALS = {
  shell: { color: "#eef1f7", metallic: 0.18, roughness: 0.34 },
  shellMid: { color: "#d7dde9", metallic: 0.15, roughness: 0.42 },
  rubber: { color: "#23262e", metallic: 0.05, roughness: 0.82 },
  wheel: { color: "#3c4250", metallic: 0.1, roughness: 0.55 },
  groove: { color: "#0e1016", metallic: 0.0, roughness: 0.9 },
  led: { color: "#0b1a1f", metallic: 0.0, roughness: 0.3, emissive: "#37f2ff", emissiveIntensity: 2.6 },
  cable: { color: "#1c1f27", metallic: 0.0, roughness: 0.7 },
  brand: { color: "#8b95ad", metallic: 0.5, roughness: 0.35 },
};

/**
 * Add a computer mouse to the scene under a new "mouse" group.
 * The mouse is centered at `origin`, its base resting on the local ground.
 */
export function addMouse(scene, opts = {}) {
  const origin = opts.origin || [0, 0, 0];
  const name = opts.name || "mouse";
  Object.assign(scene.materials, MOUSE_MATERIALS);

  const group = addNode(scene, { name, position: origin, meta: { role: "model", model: "computer-mouse" } });

  // --- main body shell (dome) ---
  addNode(scene, {
    name: "body",
    geometry: { kind: "roundedBox", params: { w: 1.34, h: 0.86, d: 2.5, radius: 0.34, seg: 56, rings: 40 } },
    material: "shell",
    position: [0, 0.40, 0],
  }, group.id);

  // --- rounded bottom base plate ---
  addNode(scene, {
    name: "base",
    geometry: { kind: "roundedBox", params: { w: 1.18, h: 0.16, d: 2.28, radius: 0.16, seg: 48, rings: 24 } },
    material: "shellMid",
    position: [0, 0.07, 0],
  }, group.id);

  // --- rear palm hump (makes the classic mouse silhouette) ---
  addNode(scene, {
    name: "palm",
    geometry: { kind: "ellipsoid", params: { rx: 0.6, ry: 0.36, rz: 0.86, seg: 48, rings: 28 } },
    material: "shell",
    position: [0, 0.5, -0.55],
  }, group.id);

  // --- button seam (vertical groove splitting left/right clicks) ---
  addNode(scene, {
    name: "seam-center",
    geometry: { kind: "box", params: { w: 0.032, h: 0.12, d: 0.86 } },
    material: "groove",
    position: [0, 0.845, 0.5],
  }, group.id);

  // --- button plate (raised, split in two by the centre seam) ---
  addNode(scene, {
    name: "button-plate",
    geometry: { kind: "roundedBox", params: { w: 1.12, h: 0.16, d: 0.86, radius: 0.07, seg: 40, rings: 20 } },
    material: "shellMid",
    position: [0, 0.8, 0.5],
  }, group.id);

  // --- button seam (horizontal groove between the plate and the body) ---
  addNode(scene, {
    name: "seam-front",
    geometry: { kind: "box", params: { w: 1.06, h: 0.05, d: 0.05 } },
    material: "groove",
    position: [0, 0.81, 0.928],
  }, group.id);

  // --- scroll wheel well + wheel ---
  addNode(scene, {
    name: "wheel-well",
    geometry: { kind: "box", params: { w: 0.34, h: 0.4, d: 0.66 } },
    material: "groove",
    position: [0, 0.66, 0.1],
  }, group.id);

  addNode(scene, {
    name: "wheel",
    geometry: { kind: "cylinder", params: { r: 0.145, h: 0.19, seg: 40, capped: true } },
    material: "wheel",
    position: [0, 0.82, 0.12],
    rotation: [0, 0, Math.PI / 2],
  }, group.id);

  // wheel ridges
  for (let i = -2; i <= 2; i++) {
    addNode(scene, {
      name: `wheel-ridge-${i}`,
      geometry: { kind: "torus", params: { majorRadius: 0.147, minorRadius: 0.022, seg: 32, sides: 10 } },
      material: "groove",
      position: [i * 0.038, 0.82, 0.12],
      rotation: [0, Math.PI / 2, 0],
    }, group.id);
  }

  // --- DPI button behind the wheel ---
  addNode(scene, {
    name: "dpi-button",
    geometry: { kind: "box", params: { w: 0.15, h: 0.07, d: 0.24 } },
    material: "shellMid",
    position: [0, 0.82, -0.34],
  }, group.id);

  // --- side grips (rubber) ---
  for (const [label, sx] of [["left", -1], ["right", 1]]) {
    addNode(scene, {
      name: `grip-${label}`,
      geometry: { kind: "ellipsoid", params: { rx: 0.09, ry: 0.3, rz: 0.62, seg: 32, rings: 20 } },
      material: "rubber",
      position: [sx * 0.66, 0.36, -0.18],
    }, group.id);
  }

  // --- rear LED (emissive) ---
  addNode(scene, {
    name: "led",
    geometry: { kind: "ellipsoid", params: { rx: 0.16, ry: 0.05, rz: 0.05, seg: 24, rings: 12 } },
    material: "led",
    position: [0, 0.06, -1.26],
  }, group.id);

  // --- brand stripe on the palm ---
  addNode(scene, {
    name: "brand-stripe",
    geometry: { kind: "roundedBox", params: { w: 0.3, h: 0.03, d: 0.3, radius: 0.02, seg: 24, rings: 12 } },
    material: "brand",
    position: [0, 0.63, -0.62],
  }, group.id);

  // --- braided cable curving off the back ---
  if (opts.cable !== false) {
    addNode(scene, {
      name: "cable",
      geometry: {
        kind: "tube",
        params: {
          radius: 0.045,
          seg: 40,
          sides: 12,
          points: [
            [0, 0.3, -1.24],
            [0.05, 0.55, -1.75],
            [0.2, 1.1, -2.3],
            [0.45, 1.9, -2.75],
            [0.7, 2.7, -3.0],
            [0.95, 3.4, -3.05],
          ],
        },
      },
      material: "cable",
    }, group.id);
  }

  return group;
}

/** A ready-to-render scene containing just the mouse. */
export function createMouseScene(opts = {}) {
  const scene = createScene("computer-mouse");
  addMouse(scene, opts);
  scene.camera = { position: [3.2, 2.3, 3.9], target: [0, 0.45, -0.1], up: [0, 1, 0], fov: 40, near: 0.05, far: 200 };
  scene.meta.stats = sceneStats(scene);
  return scene;
}
