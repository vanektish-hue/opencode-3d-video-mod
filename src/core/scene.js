// JSON-serializable scene graph. Geometry is stored as a compact spec and the
// actual mesh is built (and cached) on demand, so scenes stay small and
// diff-friendly while remaining fully renderable in headless mode.
import {
  makeEllipsoid, makeSphere, makeBox, makeRoundedBox, makeCylinder,
  makeTorus, makeCapsule, makeTube, makeDisk, meshStats,
} from "./mesh.js";
import { bakeScene } from "./raster.js";

let COUNTER = 0;
export function newId(prefix = "node") {
  COUNTER += 1;
  return `${prefix}_${Date.now().toString(36)}_${COUNTER}`;
}

export function buildGeometry(geom) {
  if (!geom) return null;
  const p = geom.params || {};
  switch (geom.kind) {
    case "ellipsoid": return makeEllipsoid(p.rx ?? 1, p.ry ?? 1, p.rz ?? 1, p.seg ?? 48, p.rings ?? 24);
    case "sphere": return makeSphere(p.r ?? 1, p.seg ?? 48, p.rings ?? 24);
    case "box": return makeBox(p.w ?? 1, p.h ?? 1, p.d ?? 1);
    case "roundedBox": return makeRoundedBox(p.w ?? 1, p.h ?? 1, p.d ?? 1, p.radius ?? 0.2, p.seg ?? 48, p.rings ?? 32);
    case "cylinder": return makeCylinder(p.rTop ?? p.r ?? 1, p.rBottom ?? p.r ?? 1, p.h ?? 2, p.seg ?? 48, p.capped !== false);
    case "torus": return makeTorus(p.majorRadius ?? 1, p.minorRadius ?? 0.3, p.seg ?? 48, p.sides ?? 24);
    case "capsule": return makeCapsule(p.r ?? 0.5, p.cyl ?? 1, p.seg ?? 48, p.rings ?? 24);
    case "tube": return makeTube(p.points || [], p.radius ?? 0.1, p.seg ?? 24, p.sides ?? 12);
    case "disk": return makeDisk(p.r ?? 1, p.seg ?? 48, p.y ?? 0, !!p.flip);
    default: throw new Error(`Unknown geometry kind: ${geom.kind}`);
  }
}

const meshCache = new Map();
export function getMesh(geom) {
  if (!geom) return null;
  const key = JSON.stringify(geom);
  if (!meshCache.has(key)) meshCache.set(key, buildGeometry(geom));
  return meshCache.get(key);
}

const DEFAULT_MATERIALS = {
  shell: { color: "#e9edf5", metallic: 0.25, roughness: 0.32 },
};

export function createScene(name = "untitled") {
  return {
    version: 1,
    name,
    root: { id: "root", name: "Root", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], children: [] },
    materials: { ...DEFAULT_MATERIALS },
    lights: [
      { type: "directional", direction: [-1.1, -1.7, -1.2], color: "#fff4e6", intensity: 1.5 },
      { type: "directional", direction: [1.4, -0.4, 0.9], color: "#6fa8ff", intensity: 0.5 },
      { type: "point", position: [2.4, 2.6, 2.2], color: "#ffffff", intensity: 12, falloff: 0.35 },
    ],
    camera: { position: [3.4, 2.5, 4.2], target: [0, 0.35, 0], up: [0, 1, 0], fov: 42, near: 0.05, far: 200 },
    ground: { y: 0, color: "#232833", size: 30 },
    background: { top: "#0a0d17", bottom: "#182036" },
    meta: { createdAt: new Date().toISOString() },
  };
}

export function findNode(scene, id, node = scene.root) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNode(scene, id, child);
    if (found) return found;
  }
  return null;
}

export function findParent(scene, id, node = scene.root) {
  for (const child of node.children || []) {
    if (child.id === id) return node;
    const found = findParent(scene, id, child);
    if (found) return found;
  }
  return null;
}

export function makeNode(opts = {}) {
  return {
    id: opts.id || newId(opts.geometry?.kind || "node"),
    name: opts.name || opts.geometry?.kind || "node",
    geometry: opts.geometry || null,
    material: opts.material || "shell",
    position: opts.position || [0, 0, 0],
    rotation: opts.rotation || [0, 0, 0],
    scale: opts.scale || [1, 1, 1],
    visible: opts.visible !== false,
    children: [],
    meta: opts.meta || {},
  };
}

export function addNode(scene, opts = {}, parentId = "root") {
  const parent = parentId === "root" ? scene.root : findNode(scene, parentId);
  if (!parent) throw new Error(`Parent not found: ${parentId}`);
  const node = makeNode(opts);
  parent.children.push(node);
  return node;
}

export function removeNode(scene, id) {
  const parent = findParent(scene, id);
  if (!parent) return false;
  const i = parent.children.findIndex((c) => c.id === id);
  if (i < 0) return false;
  parent.children.splice(i, 1);
  return true;
}

export function resolveMaterial(scene, node) {
  if (!node.material) return {};
  if (typeof node.material === "string") return scene.materials[node.material] || {};
  return node.material;
}

/** Produce a shallow copy of the scene with material ids resolved inline. */
export function bakedItems(scene) {
  const shallow = {
    root: resolveTree(scene, scene.root),
  };
  return bakeScene(shallow);
}

function resolveTree(scene, node) {
  const mesh = getMesh(node.geometry);
  return {
    ...node,
    mesh: mesh ? { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices } : null,
    material: resolveMaterial(scene, node),
    children: (node.children || []).map((c) => resolveTree(scene, c)),
  };
}

export function listNodes(scene) {
  const out = [];
  const walk = (node, depth) => {
    out.push({ id: node.id, name: node.name, depth, kind: node.geometry?.kind || (node.id === "root" ? "root" : "group"), visible: node.visible !== false, children: (node.children || []).length });
    for (const c of node.children || []) walk(c, depth + 1);
  };
  walk(scene.root, 0);
  return out;
}

export function sceneStats(scene) {
  let tris = 0;
  let nodes = 0;
  const walk = (node) => {
    nodes += 1;
    const mesh = getMesh(node.geometry);
    if (mesh) tris += mesh.indices.length / 3;
    for (const c of node.children || []) walk(c);
  };
  walk(scene.root);
  return { nodes, tris, lights: scene.lights.length, materials: Object.keys(scene.materials).length };
}

export { meshStats };
