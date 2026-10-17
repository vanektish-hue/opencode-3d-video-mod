// Extra procedural 3D models for the movie gallery. Each builder returns a
// ready-to-render scene (same node/material format as the mouse), so the CPU
// renderer, the exporter and the web viewport all understand them.
import { createScene, addNode } from "../core/scene.js";
import { createMouseScene } from "../core/mouse.js";

function base(name, materials) {
  const scene = createScene(name);
  Object.assign(scene.materials, materials);
  return scene;
}

/** A mug with a tube handle and coffee inside. */
export function makeMugScene() {
  const scene = base("mug", {
    ceramic: { color: "#f2f4f8", metallic: 0.05, roughness: 0.25 },
    coffee: { color: "#3a1f0f", metallic: 0.0, roughness: 0.35 },
    accent: { color: "#ff5d6c", metallic: 0.1, roughness: 0.4 },
  });
  const g = addNode(scene, { name: "mug", meta: { model: "mug" } });
  addNode(scene, { name: "body", geometry: { kind: "cylinder", params: { rTop: 0.62, rBottom: 0.55, h: 1.1, seg: 56 } }, material: "ceramic", position: [0, 0.55, 0] }, g.id);
  addNode(scene, { name: "rim", geometry: { kind: "torus", params: { majorRadius: 0.62, minorRadius: 0.045, seg: 48, sides: 14 } }, material: "ceramic", position: [0, 1.1, 0] }, g.id);
  addNode(scene, { name: "coffee", geometry: { kind: "disk", params: { r: 0.56, seg: 48, y: 0 } }, material: "coffee", position: [0, 1.03, 0] }, g.id);
  addNode(scene, { name: "stripe", geometry: { kind: "cylinder", params: { rTop: 0.635, rBottom: 0.632, h: 0.12, seg: 56 } }, material: "accent", position: [0, 0.62, 0] }, g.id);
  addNode(scene, {
    name: "handle",
    geometry: { kind: "tube", params: { radius: 0.055, seg: 40, sides: 12, points: [[0.55, 0.95, 0], [0.85, 0.88, 0], [0.95, 0.62, 0], [0.9, 0.36, 0], [0.6, 0.3, 0]] } },
    material: "ceramic",
  }, g.id);
  scene.camera = { position: [2.2, 1.8, 3.0], target: [0, 0.6, 0], up: [0, 1, 0], fov: 38, near: 0.05, far: 100 };
  scene.meta.orbit = { center: [0, 0.6, 0], radius: 3.6, height: 1.9, targetY: 0.6, fov: 38 };
  return scene;
}

/** A game controller. */
export function makeControllerScene() {
  const scene = base("controller", {
    body: { color: "#2b2f3a", metallic: 0.2, roughness: 0.45 },
    face: { color: "#e8ecf5", metallic: 0.1, roughness: 0.3 },
    stick: { color: "#15171d", metallic: 0.1, roughness: 0.5 },
    btn: { color: "#ff5d6c", metallic: 0.1, roughness: 0.35 },
    btn2: { color: "#37f2ff", metallic: 0.1, roughness: 0.35, emissive: "#37f2ff", emissiveIntensity: 0.8 },
    led: { color: "#101820", metallic: 0, roughness: 0.3, emissive: "#3dff8f", emissiveIntensity: 2.0 },
  });
  const g = addNode(scene, { name: "controller", meta: { model: "controller" } });
  addNode(scene, { name: "body", geometry: { kind: "roundedBox", params: { w: 1.9, h: 0.42, d: 0.86, radius: 0.2, seg: 52, rings: 26 } }, material: "body", position: [0, 0.4, 0] }, g.id);
  addNode(scene, { name: "face", geometry: { kind: "roundedBox", params: { w: 0.72, h: 0.2, d: 0.5, radius: 0.08, seg: 36, rings: 18 } }, material: "face", position: [0, 0.58, 0.05] }, g.id);
  for (const [lbl, x] of [["l", -0.78], ["r", 0.78]]) {
    addNode(scene, { name: `grip-${lbl}`, geometry: { kind: "capsule", params: { r: 0.24, cyl: 0.7, seg: 36, rings: 20 } }, material: "body", position: [x, 0.28, -0.05], rotation: [0.35, 0, x < 0 ? 0.5 : -0.5] }, g.id);
    addNode(scene, { name: `stick-${lbl}`, geometry: { kind: "cylinder", params: { r: 0.17, h: 0.16, seg: 32 } }, material: "stick", position: [x * 0.55, 0.6, 0.28] }, g.id);
    addNode(scene, { name: `stickcap-${lbl}`, geometry: { kind: "cylinder", params: { r: 0.2, h: 0.06, seg: 32 } }, material: "stick", position: [x * 0.55, 0.69, 0.28] }, g.id);
  }
  // d-pad cross
  addNode(scene, { name: "dpad-h", geometry: { kind: "roundedBox", params: { w: 0.42, h: 0.1, d: 0.14, radius: 0.04, seg: 20, rings: 10 } }, material: "stick", position: [-0.5, 0.6, -0.24] }, g.id);
  addNode(scene, { name: "dpad-v", geometry: { kind: "roundedBox", params: { w: 0.14, h: 0.1, d: 0.42, radius: 0.04, seg: 20, rings: 10 } }, material: "stick", position: [-0.5, 0.6, -0.24] }, g.id);
  const btnPos = [[0.42, 0.3], [0.6, 0.06], [0.42, -0.16], [0.24, 0.06]];
  btnPos.forEach(([bx, bz], i) => {
    addNode(scene, { name: `btn-${i}`, geometry: { kind: "cylinder", params: { r: 0.09, h: 0.08, seg: 24 } }, material: i % 2 ? "btn2" : "btn", position: [bx + 0.03, 0.62, bz - 0.02] }, g.id);
  });
  addNode(scene, { name: "led", geometry: { kind: "roundedBox", params: { w: 0.28, h: 0.05, d: 0.06, radius: 0.02, seg: 16, rings: 8 } }, material: "led", position: [0, 0.6, 0.32] }, g.id);
  scene.camera = { position: [0, 2.4, 3.4], target: [0, 0.4, 0], up: [0, 1, 0], fov: 40, near: 0.05, far: 100 };
  scene.meta.orbit = { center: [0, 0.4, 0], radius: 3.8, height: 2.0, targetY: 0.42, fov: 40 };
  return scene;
}

/** Over-ear headphones. */
export function makeHeadphonesScene() {
  const scene = base("headphones", {
    band: { color: "#23262e", metallic: 0.25, roughness: 0.4 },
    cup: { color: "#31353f", metallic: 0.3, roughness: 0.35 },
    pad: { color: "#0d0f14", metallic: 0.02, roughness: 0.85 },
    accent: { color: "#ff5d6c", metallic: 0.15, roughness: 0.35 },
    logo: { color: "#8b95ad", metallic: 0.6, roughness: 0.3 },
  });
  const g = addNode(scene, { name: "headphones", meta: { model: "headphones" } });
  addNode(scene, {
    name: "band",
    geometry: { kind: "tube", params: { radius: 0.07, seg: 48, sides: 12, points: (() => { const a = []; for (let i = 0; i <= 12; i++) { const t = i / 12; const ang = Math.PI * (1 - t); a.push([Math.cos(ang) * 0.95, Math.sin(ang) * 0.95 + 0.2, 0]); } return a; })() } },
    material: "band",
  }, g.id);
  for (const [lbl, x] of [["l", -0.95], ["r", 0.95]]) {
    addNode(scene, { name: `cup-${lbl}`, geometry: { kind: "cylinder", params: { r: 0.5, h: 0.34, seg: 44 } }, material: "cup", position: [x, 0.2, 0], rotation: [0, 0, Math.PI / 2] }, g.id);
    addNode(scene, { name: `pad-${lbl}`, geometry: { kind: "torus", params: { majorRadius: 0.44, minorRadius: 0.13, seg: 40, sides: 18 } }, material: "pad", position: [x + (x < 0 ? 0.17 : -0.17), 0.2, 0], rotation: [0, Math.PI / 2, 0] }, g.id);
    addNode(scene, { name: `ring-${lbl}`, geometry: { kind: "torus", params: { majorRadius: 0.3, minorRadius: 0.035, seg: 32, sides: 12 } }, material: "accent", position: [x + (x < 0 ? -0.18 : 0.18), 0.2, 0], rotation: [0, Math.PI / 2, 0] }, g.id);
  }
  scene.camera = { position: [2.8, 1.6, 2.8], target: [0, 0.3, 0], up: [0, 1, 0], fov: 40, near: 0.05, far: 100 };
  scene.meta.orbit = { center: [0, 0.3, 0], radius: 3.8, height: 1.6, targetY: 0.3, fov: 40 };
  return scene;
}

/** A smartphone. */
export function makePhoneScene() {
  const scene = base("phone", {
    body: { color: "#1b1e26", metallic: 0.55, roughness: 0.25 },
    screen: { color: "#0a2a3a", metallic: 0.0, roughness: 0.15, emissive: "#1e88e5", emissiveIntensity: 1.05 },
    glass: { color: "#101319", metallic: 0.2, roughness: 0.05 },
    cam: { color: "#0a0b0f", metallic: 0.2, roughness: 0.3 },
    lens: { color: "#223", metallic: 0.7, roughness: 0.1, emissive: "#37f2ff", emissiveIntensity: 0.6 },
  });
  const g = addNode(scene, { name: "phone", meta: { model: "phone" } });
  addNode(scene, { name: "body", geometry: { kind: "roundedBox", params: { w: 1.0, h: 2.05, d: 0.14, radius: 0.16, seg: 44, rings: 40 } }, material: "body", position: [0, 1.03, 0] }, g.id);
  addNode(scene, { name: "screen", geometry: { kind: "roundedBox", params: { w: 0.86, h: 1.82, d: 0.02, radius: 0.11, seg: 40, rings: 36 } }, material: "screen", position: [0, 1.02, 0.075] }, g.id);
  addNode(scene, { name: "notch", geometry: { kind: "roundedBox", params: { w: 0.26, h: 0.06, d: 0.03, radius: 0.02, seg: 16, rings: 8 } }, material: "glass", position: [0, 1.83, 0.078] }, g.id);
  for (const c of [[-0.34, 0, -0.02], [-0.34, 0.2, -0.02], [-0.34, 0.4, -0.02]]) {
    addNode(scene, { name: "cam", geometry: { kind: "cylinder", params: { r: 0.1, h: 0.03, seg: 24 } }, material: "cam", position: [c[0], 1.72 + c[1], -c[2] - 0.075], rotation: [Math.PI / 2, 0, 0] }, g.id);
    addNode(scene, { name: "lens", geometry: { kind: "cylinder", params: { r: 0.05, h: 0.02, seg: 20 } }, material: "lens", position: [c[0], 1.72 + c[1], -c[2] - 0.095], rotation: [Math.PI / 2, 0, 0] }, g.id);
  }
  scene.camera = { position: [1.6, 1.7, 3.2], target: [0, 1.0, 0], up: [0, 1, 0], fov: 36, near: 0.05, far: 100 };
  scene.meta.orbit = { center: [0, 1.0, 0], radius: 3.6, height: 1.5, targetY: 1.0, fov: 36 };
  return scene;
}

/** A friendly little robot. */
export function makeRobotScene() {
  const scene = base("robot", {
    metal: { color: "#c9d1de", metallic: 0.6, roughness: 0.3 },
    dark: { color: "#3a4250", metallic: 0.4, roughness: 0.45 },
    eye: { color: "#0b1a1f", metallic: 0, roughness: 0.2, emissive: "#37f2ff", emissiveIntensity: 2.4 },
    led: { color: "#101820", metallic: 0, roughness: 0.3, emissive: "#ff5d6c", emissiveIntensity: 1.6 },
  });
  const g = addNode(scene, { name: "robot", meta: { model: "robot" } });
  addNode(scene, { name: "torso", geometry: { kind: "roundedBox", params: { w: 0.9, h: 1.0, d: 0.62, radius: 0.16, seg: 40, rings: 28 } }, material: "metal", position: [0, 1.05, 0] }, g.id);
  addNode(scene, { name: "chest", geometry: { kind: "cylinder", params: { r: 0.2, h: 0.06, seg: 28 } }, material: "led", position: [0, 1.15, 0.33], rotation: [Math.PI / 2, 0, 0] }, g.id);
  addNode(scene, { name: "head", geometry: { kind: "roundedBox", params: { w: 0.72, h: 0.6, d: 0.6, radius: 0.18, seg: 40, rings: 26 } }, material: "metal", position: [0, 1.95, 0] }, g.id);
  for (const x of [-0.18, 0.18]) addNode(scene, { name: "eye", geometry: { kind: "sphere", params: { r: 0.09, seg: 24, rings: 14 } }, material: "eye", position: [x, 1.98, 0.28] }, g.id);
  addNode(scene, { name: "antenna", geometry: { kind: "cylinder", params: { r: 0.02, rTop: 0.02, h: 0.34, seg: 12 } }, material: "dark", position: [0, 2.4, 0] }, g.id);
  addNode(scene, { name: "bulb", geometry: { kind: "sphere", params: { r: 0.07, seg: 20, rings: 12 } }, material: "eye", position: [0, 2.6, 0] }, g.id);
  for (const [lbl, x] of [["l", -0.62], ["r", 0.62]]) {
    addNode(scene, { name: `arm-${lbl}`, geometry: { kind: "capsule", params: { r: 0.1, cyl: 0.6, seg: 24, rings: 14 } }, material: "metal", position: [x, 1.0, 0], rotation: [0, 0, x < 0 ? 0.35 : -0.35] }, g.id);
    addNode(scene, { name: `hand-${lbl}`, geometry: { kind: "sphere", params: { r: 0.13, seg: 20, rings: 12 } }, material: "dark", position: [x * 1.15, 0.66, 0] }, g.id);
    addNode(scene, { name: `leg-${lbl}`, geometry: { kind: "capsule", params: { r: 0.12, cyl: 0.4, seg: 24, rings: 14 } }, material: "dark", position: [x * 0.6, 0.36, 0] }, g.id);
    addNode(scene, { name: `foot-${lbl}`, geometry: { kind: "roundedBox", params: { w: 0.28, h: 0.14, d: 0.4, radius: 0.06, seg: 20, rings: 10 } }, material: "dark", position: [x * 0.6, 0.07, 0.05] }, g.id);
  }
  scene.camera = { position: [2.4, 1.9, 3.2], target: [0, 1.1, 0], up: [0, 1, 0], fov: 40, near: 0.05, far: 100 };
  scene.meta.orbit = { center: [0, 1.1, 0], radius: 4.0, height: 2.2, targetY: 1.15, fov: 40 };
  return scene;
}

/** A retro rocket. */
export function makeRocketScene() {
  const scene = base("rocket", {
    body: { color: "#f2f4f8", metallic: 0.25, roughness: 0.3 },
    accent: { color: "#ff5d6c", metallic: 0.2, roughness: 0.35 },
    glass: { color: "#0a2a3a", metallic: 0.1, roughness: 0.1, emissive: "#37f2ff", emissiveIntensity: 0.9 },
    fin: { color: "#e33d4e", metallic: 0.2, roughness: 0.4 },
    flame: { color: "#241005", metallic: 0, roughness: 0.4, emissive: "#ffb020", emissiveIntensity: 2.8 },
  });
  const g = addNode(scene, { name: "rocket", meta: { model: "rocket" } });
  addNode(scene, { name: "body", geometry: { kind: "cylinder", params: { rTop: 0.42, rBottom: 0.42, h: 1.7, seg: 48 } }, material: "body", position: [0, 1.35, 0] }, g.id);
  addNode(scene, { name: "nose", geometry: { kind: "cylinder", params: { rTop: 0.001, rBottom: 0.42, h: 0.7, seg: 48 } }, material: "accent", position: [0, 2.55, 0] }, g.id);
  addNode(scene, { name: "stripe", geometry: { kind: "cylinder", params: { rTop: 0.435, rBottom: 0.435, h: 0.16, seg: 48 } }, material: "accent", position: [0, 0.75, 0] }, g.id);
  addNode(scene, { name: "window", geometry: { kind: "torus", params: { majorRadius: 0.16, minorRadius: 0.045, seg: 28, sides: 14 } }, material: "glass", position: [0, 1.7, 0.42] }, g.id);
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    addNode(scene, { name: `fin-${i}`, geometry: { kind: "box", params: { w: 0.5, h: 0.6, d: 0.06 } }, material: "fin", position: [Math.cos(ang) * 0.5, 0.6, Math.sin(ang) * 0.5], rotation: [0, -ang, 0] }, g.id);
  }
  addNode(scene, { name: "engine", geometry: { kind: "cylinder", params: { rTop: 0.36, rBottom: 0.44, h: 0.24, seg: 40 } }, material: "accent", position: [0, 0.42, 0] }, g.id);
  addNode(scene, { name: "flame", geometry: { kind: "cylinder", params: { rTop: 0.36, rBottom: 0.001, h: 0.9, seg: 40 } }, material: "flame", position: [0, -0.08, 0], rotation: [Math.PI, 0, 0] }, g.id);
  scene.camera = { position: [2.6, 1.8, 3.2], target: [0, 1.4, 0], up: [0, 1, 0], fov: 40, near: 0.05, far: 100 };
  scene.meta.orbit = { center: [0, 1.4, 0], radius: 4.6, height: 2.0, targetY: 1.4, fov: 40 };
  return scene;
}

/** A toy house. */
export function makeHouseScene() {
  const scene = base("house", {
    wall: { color: "#f0e6d2", metallic: 0.05, roughness: 0.7 },
    roof: { color: "#c0392b", metallic: 0.1, roughness: 0.55 },
    door: { color: "#6b4a2b", metallic: 0.05, roughness: 0.6 },
    glass: { color: "#0a2a3a", metallic: 0.1, roughness: 0.15, emissive: "#ffd166", emissiveIntensity: 0.7 },
    base: { color: "#2fbf71", metallic: 0.02, roughness: 0.8 },
  });
  const g = addNode(scene, { name: "house", meta: { model: "house" } });
  addNode(scene, { name: "ground", geometry: { kind: "cylinder", params: { r: 1.9, h: 0.16, seg: 56 } }, material: "base", position: [0, 0.08, 0] }, g.id);
  addNode(scene, { name: "walls", geometry: { kind: "box", params: { w: 1.8, h: 1.2, d: 1.5 } }, material: "wall", position: [0, 0.76, 0] }, g.id);
  addNode(scene, { name: "roof", geometry: { kind: "cylinder", params: { rTop: 0.001, rBottom: 1.5, h: 0.9, seg: 4 } }, material: "roof", position: [0, 1.8, 0], rotation: [0, Math.PI / 4, 0] }, g.id);
  addNode(scene, { name: "door", geometry: { kind: "box", params: { w: 0.4, h: 0.7, d: 0.06 } }, material: "door", position: [0, 0.5, 0.78] }, g.id);
  for (const x of [-0.55, 0.55]) addNode(scene, { name: "win", geometry: { kind: "box", params: { w: 0.34, h: 0.34, d: 0.06 } }, material: "glass", position: [x, 0.95, 0.78] }, g.id);
  addNode(scene, { name: "chimney", geometry: { kind: "box", params: { w: 0.26, h: 0.6, d: 0.26 } }, material: "roof", position: [0.55, 1.75, -0.3] }, g.id);
  scene.camera = { position: [2.6, 2.2, 3.4], target: [0, 0.9, 0], up: [0, 1, 0], fov: 40, near: 0.05, far: 100 };
  scene.meta.orbit = { center: [0, 0.9, 0], radius: 4.4, height: 2.3, targetY: 0.9, fov: 40 };
  return scene;
}

/** A pair of dice. */
export function makeDiceScene() {
  const scene = base("dice", {
    dice: { color: "#f7f9fc", metallic: 0.05, roughness: 0.25 },
    pip: { color: "#1b1e26", metallic: 0.1, roughness: 0.4 },
    dice2: { color: "#ff5d6c", metallic: 0.05, roughness: 0.3 },
  });
  const g = addNode(scene, { name: "dice", meta: { model: "dice" } });
  const pipDirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function die(mat, size, pos, rot) {
    const d = addNode(scene, { name: "die", geometry: { kind: "roundedBox", params: { w: size, h: size, d: size, radius: size * 0.16, seg: 32, rings: 28 } }, material: mat, position: pos, rotation: rot }, g.id);
    const faces = [[1], [1, 2, 3], [1, 2, 3, 4, 5], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6]];
    pipDirs.forEach((dir, fi) => {
      const count = faces[fi % faces.length].length;
      const r = size * 0.5 - 0.001;
      const centers = count === 1 ? [[0, 0]] : count === 2 ? [[-0.28, -0.28], [0.28, 0.28]] : count === 3 ? [[-0.3, -0.3], [0, 0], [0.3, 0.3]] : [[-0.3, -0.3], [-0.3, 0.3], [0.3, -0.3], [0.3, 0.3]];
      centers.forEach((c) => {
        const ox = (fi === 0 || fi === 1) ? dir[0] * r : c[0] * size;
        const oy = (fi === 2 || fi === 3) ? dir[1] * r : c[1] * size;
        const oz = (fi === 4 || fi === 5) ? dir[2] * r : 0;
        addNode(scene, { name: "pip", geometry: { kind: "sphere", params: { r: size * 0.09, seg: 16, rings: 10 } }, material: "pip", position: [pos[0] + ox + ((fi === 0 || fi === 1) ? 0 : c[0] * 0), pos[1] + oy + ((fi === 0 || fi === 1) ? c[1] * size : 0) * 0, pos[2] + oz] }, g.id);
      });
    });
    return d;
  }
  die("dice", 0.9, [-0.5, 0.45, 0], [0.3, 0.5, 0.1]);
  die("dice2", 0.82, [0.62, 0.41, 0.18], [0.5, -0.4, 0.6]);
  scene.camera = { position: [2.2, 2.0, 3.0], target: [0, 0.4, 0], up: [0, 1, 0], fov: 40, near: 0.05, far: 100 };
  scene.meta.orbit = { center: [0, 0.4, 0], radius: 4.0, height: 2.2, targetY: 0.42, fov: 40 };
  return scene;
}

/** A ringed planet with a moon. */
export function makePlanetScene() {
  const scene = base("planet", {
    planet: { color: "#2a6fdb", metallic: 0.05, roughness: 0.5 },
    land: { color: "#2fbf71", metallic: 0.0, roughness: 0.6 },
    ring: { color: "#d9b26b", metallic: 0.2, roughness: 0.5 },
    moon: { color: "#cfd6e2", metallic: 0.1, roughness: 0.6 },
  });
  const g = addNode(scene, { name: "planet", meta: { model: "planet" } });
  addNode(scene, { name: "sphere", geometry: { kind: "sphere", params: { r: 1.0, seg: 56, rings: 32 } }, material: "planet", position: [0, 1.0, 0] }, g.id);
  addNode(scene, { name: "land", geometry: { kind: "ellipsoid", params: { rx: 0.5, ry: 0.32, rz: 0.42, seg: 32, rings: 20 } }, material: "land", position: [0.35, 1.25, 0.8] }, g.id);
  addNode(scene, { name: "land2", geometry: { kind: "ellipsoid", params: { rx: 0.36, ry: 0.3, rz: 0.5, seg: 32, rings: 20 } }, material: "land", position: [-0.5, 0.8, 0.7] }, g.id);
  addNode(scene, { name: "ring", geometry: { kind: "cylinder", params: { rTop: 1.7, rBottom: 1.7, h: 0.02, seg: 64 } }, material: "ring", position: [0, 1.0, 0], rotation: [0.45, 0, 0.2] }, g.id);
  addNode(scene, { name: "moon", geometry: { kind: "sphere", params: { r: 0.22, seg: 28, rings: 16 } }, material: "moon", position: [1.9, 1.9, 0.4] }, g.id);
  scene.camera = { position: [3.0, 2.2, 3.4], target: [0, 1.0, 0], up: [0, 1, 0], fov: 42, near: 0.05, far: 200 };
  scene.meta.orbit = { center: [0, 1.0, 0], radius: 5.0, height: 2.6, targetY: 1.0, fov: 42 };
  return scene;
}

/** The original computer mouse (reused from the core module). */
export function makeMouseModelScene() {
  const scene = createMouseScene();
  scene.meta.orbit = { center: [0, 0.5, -0.15], radius: 5.0, height: 2.7, targetY: 0.5, fov: 42 };
  return scene;
}

export const MODELS = {
  mouse: makeMouseModelScene,
  mug: makeMugScene,
  controller: makeControllerScene,
  headphones: makeHeadphonesScene,
  phone: makePhoneScene,
  robot: makeRobotScene,
  rocket: makeRocketScene,
  house: makeHouseScene,
  dice: makeDiceScene,
  planet: makePlanetScene,
};

export function buildModelScene(key) {
  const fn = MODELS[key];
  if (!fn) throw new Error(`Unknown model: ${key}`);
  return fn();
}
