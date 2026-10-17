// Procedural mesh generation. Dependency-free.
// A Mesh is: { positions: Float32Array, normals: Float32Array, indices: Uint32Array }
import { V3, M4 } from "./mat.js";

const EPS = 1e-4;

/** Build a mesh from a parametric surface fn(u,v)->[x,y,z], u,v in [0,1]. */
export function paramSurface(fn, uSeg = 48, vSeg = 24, opts = {}) {
  const { uClosed = false, vClosed = false, flipNormals = false } = opts;
  const positions = [];
  const normals = [];
  const indices = [];

  // sample grid (add one extra ring/row when closed to stitch seams cleanly)
  const uCount = uSeg + 1;
  const vCount = vSeg + 1;
  for (let j = 0; j < vCount; j++) {
    const v = j / vSeg;
    for (let i = 0; i < uCount; i++) {
      const u = i / uSeg;
      const p = fn(u, v);
      positions.push(p[0], p[1], p[2]);
      // numeric normal via central differences
      const du = EPS;
      const dv = EPS;
      const pu = fn(Math.min(u + du, 1), v);
      const pv = fn(u, Math.min(v + dv, 1));
      const pu0 = fn(Math.max(u - du, 0), v);
      const pv0 = fn(u, Math.max(v - dv, 0));
      const tu = V3.sub(pu, pu0);
      const tv = V3.sub(pv, pv0);
      let n = V3.cross(tu, tv);
      if (V3.len(n) < 1e-9) n = p;
      n = V3.norm(n);
      if (flipNormals) n = V3.scale(n, -1);
      normals.push(n[0], n[1], n[2]);
    }
  }

  for (let j = 0; j < vSeg; j++) {
    for (let i = 0; i < uSeg; i++) {
      const a = j * uCount + i;
      const b = a + 1;
      const c = a + uCount;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const mesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
  if (flipNormals) reverseWinding(mesh);
  if (uClosed || vClosed) void 0;
  return mesh;
}

export function makeEllipsoid(rx = 1, ry = 1, rz = 1, seg = 48, rings = 24) {
  return paramSurface(
    (u, v) => {
      const theta = u * Math.PI * 2;
      const phi = v * Math.PI;
      return [
        rx * Math.sin(phi) * Math.cos(theta),
        ry * Math.cos(phi),
        rz * Math.sin(phi) * Math.sin(theta),
      ];
    },
    seg,
    rings,
  );
}

export function makeSphere(r = 1, seg = 48, rings = 24) {
  return makeEllipsoid(r, r, r, seg, rings);
}

export function makeCylinder(rTop = 1, rBottom = 1, height = 2, seg = 48, capped = true) {
  const sides = paramSurface(
    (u, v) => {
      const theta = u * Math.PI * 2;
      const r = rBottom + (rTop - rBottom) * v;
      const y = (v - 0.5) * height;
      return [r * Math.cos(theta), y, r * Math.sin(theta)];
    },
    seg,
    2,
    { flipNormals: true },
  );
  const parts = [sides];
  if (capped) {
    parts.push(makeDisk(rBottom, seg, -height / 2, true));
    parts.push(makeDisk(rTop, seg, height / 2, false));
  }
  return mergeMeshes(parts);
}

export function makeDisk(radius = 1, seg = 48, y = 0, flip = false) {
  return paramSurface(
    (u, v) => {
      const theta = u * Math.PI * 2;
      return [radius * v * Math.cos(theta), y, radius * v * Math.sin(theta)];
    },
    seg,
    1,
    { flipNormals: flip },
  );
}

export function makeBox(w = 1, h = 1, d = 1) {
  const x = w / 2, y = h / 2, z = d / 2;
  const positions = [
    -x, -y, z, x, -y, z, x, y, z, -x, y, z, // front +z
    x, -y, -z, -x, -y, -z, -x, y, -z, x, y, -z, // back -z
    -x, y, z, x, y, z, x, y, -z, -x, y, -z, // top +y
    -x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z, // bottom
    x, -y, z, x, -y, -z, x, y, -z, x, y, z, // right +x
    -x, -y, -z, -x, -y, z, -x, y, z, -x, y, -z, // left -x
  ];
  const normals = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ];
  const indices = [];
  for (let f = 0; f < 6; f++) {
    const o = f * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

/**
 * Rounded box (superellipsoid-ish) — great for smooth shells like a mouse body.
 * `roundness` 0..1 blends between a cube and a sphere.
 */
export function makeRoundedBox(w = 1, h = 1, d = 1, radius = 0.2, seg = 48, rings = 32) {
  const hx = Math.max(w / 2 - radius, 0);
  const hy = Math.max(h / 2 - radius, 0);
  const hz = Math.max(d / 2 - radius, 0);
  // Parametric rounded box: spherical cap swept over a rounded-rect profile.
  return paramSurface(
    (u, v) => {
      const theta = u * Math.PI * 2; // around
      const phi = v * Math.PI; // top->bottom
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      const px = hx * Math.sign(nx) + radius * nx;
      const py = hy * Math.sign(ny) + radius * ny;
      const pz = hz * Math.sign(nz) + radius * nz;
      return [px, py, pz];
    },
    seg,
    rings,
  );
}

export function makeTorus(majorRadius = 1, minorRadius = 0.3, seg = 48, sides = 24) {
  return paramSurface(
    (u, v) => {
      const a = u * Math.PI * 2;
      const b = v * Math.PI * 2;
      const cx = Math.cos(a) * majorRadius;
      const cz = Math.sin(a) * majorRadius;
      return [
        cx + Math.cos(a) * minorRadius * Math.cos(b),
        minorRadius * Math.sin(b),
        cz + Math.sin(a) * minorRadius * Math.cos(b),
      ];
    },
    seg,
    sides,
  );
}

export function makeCapsule(radius = 0.5, cylinderLength = 1, seg = 48, rings = 24) {
  const half = cylinderLength / 2;
  return paramSurface(
    (u, v) => {
      const theta = u * Math.PI * 2;
      const phi = v * Math.PI;
      const y = radius * Math.cos(phi);
      const r = radius * Math.sin(phi);
      const yShift = y > 0 ? half : -half;
      return [r * Math.cos(theta), y + yShift, r * Math.sin(theta)];
    },
    seg,
    rings,
  );
}

/** Sweep a circular tube along a polyline. */
export function makeTube(points, radius = 0.1, seg = 24, sides = 12) {
  const pts = points.map((p) => (Array.isArray(p) ? p : [p[0], p[1], p[2]]));
  const tangents = pts.map((_, i) => {
    if (i === 0) return V3.norm(V3.sub(pts[1], pts[0]));
    if (i === pts.length - 1) return V3.norm(V3.sub(pts[i], pts[i - 1]));
    return V3.norm(V3.sub(pts[i + 1], pts[i - 1]));
  });
  // parallel transport frame
  let normal = Math.abs(tangents[0][1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  normal = V3.norm(V3.sub(normal, V3.scale(tangents[0], V3.dot(normal, tangents[0]))));
  const frames = [];
  for (let i = 0; i < pts.length; i++) {
    const t = tangents[i];
    normal = V3.norm(V3.sub(normal, V3.scale(t, V3.dot(normal, t))));
    const binormal = V3.cross(t, normal);
    frames.push({ n: normal, b: binormal });
  }
  return paramSurface(
    (u, v) => {
      const theta = u * Math.PI * 2;
      const idx = Math.min(Math.floor(v * (pts.length - 1)), pts.length - 2);
      const local = v * (pts.length - 1) - idx;
      const p = V3.lerp(pts[idx], pts[idx + 1], local);
      const f = frames[idx];
      const off = V3.add(V3.scale(f.n, Math.cos(theta) * radius), V3.scale(f.b, Math.sin(theta) * radius));
      return V3.add(p, off);
    },
    seg,
    pts.length - 1,
  );
}

export function transformMesh(mesh, matrix) {
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = M4.transformPoint(matrix, [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
    positions[i] = p[0];
    positions[i + 1] = p[1];
    positions[i + 2] = p[2];
    const n = V3.norm(M4.transformDir(matrix, [mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]]));
    normals[i] = n[0];
    normals[i + 1] = n[1];
    normals[i + 2] = n[2];
  }
  return { positions, normals, indices: new Uint32Array(mesh.indices) };
}

export function reverseWinding(mesh) {
  const idx = mesh.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  return mesh;
}

export function mergeMeshes(meshes) {
  let vCount = 0;
  let iCount = 0;
  for (const m of meshes) {
    vCount += m.positions.length;
    iCount += m.indices.length;
  }
  const positions = new Float32Array(vCount);
  const normals = new Float32Array(vCount);
  const indices = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  let base = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo);
    normals.set(m.normals, vo);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + base;
    base += m.positions.length / 3;
    vo += m.positions.length;
    io += m.indices.length;
  }
  return { positions, normals, indices };
}

export function meshStats(mesh) {
  const tris = mesh.indices.length / 3;
  const verts = mesh.positions.length / 3;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], mesh.positions[i + k]);
      max[k] = Math.max(max[k], mesh.positions[i + k]);
    }
  }
  return { tris, verts, min, max, size: V3.sub(max, min) };
}

export function recomputeNormals(mesh) {
  const normals = new Float32Array(mesh.positions.length);
  const { positions, indices } = mesh;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const n = V3.cross(e1, e2);
    for (const o of [a, b, c]) {
      normals[o] += n[0];
      normals[o + 1] += n[1];
      normals[o + 2] += n[2];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const n = V3.norm([normals[i], normals[i + 1], normals[i + 2]]);
    normals[i] = n[0];
    normals[i + 1] = n[1];
    normals[i + 2] = n[2];
  }
  mesh.normals = normals;
  return mesh;
}
