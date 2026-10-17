// A compact CPU rasterizer: z-buffered, perspective-correct, Blinn-Phong-ish
// shading with metallic/roughness, emissive, gradient sky, ground plane and
// planar soft shadows. Produces RGBA buffers suitable for PNG encoding.
// Hot loops use scalar math (no per-pixel allocations) for speed.
import { V3, M4, lookAt, perspective } from "./mat.js";

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const srgbToLinear = (c) => Math.pow(c, 2.2);

function hexToRgb(hex) {
  if (Array.isArray(hex)) return hex;
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const SRGB_LUT = new Float32Array(4098);
for (let i = 0; i <= 4097; i++) SRGB_LUT[i] = Math.pow(Math.min(i, 4096) / 4096, 1 / 2.2) * 255;
function srgbEncode(c) {
  const x = c < 0 ? 0 : c > 1 ? 1 : c;
  const f = x * 4096;
  const i = f | 0;
  if (i >= 4096) return 255;
  const t = f - i;
  const a = SRGB_LUT[i];
  return a + (SRGB_LUT[i + 1] - a) * t;
}

/** Flatten a scene graph into world-space draw items. */
export function bakeScene(scene) {
  const items = [];
  const walk = (node, parentMatrix) => {
    const local = M4.compose(node.position || [0, 0, 0], node.rotation || [0, 0, 0], node.scale || [1, 1, 1]);
    const world = M4.multiply(parentMatrix, local);
    if (node.mesh && node.visible !== false) {
      items.push({
        id: node.id,
        name: node.name || node.id,
        positions: node.mesh.positions,
        normals: node.mesh.normals,
        indices: node.mesh.indices,
        matrix: world,
        material: node.material || {},
      });
    }
    for (const child of node.children || []) walk(child, world);
  };
  walk(scene.root, M4.identity());
  return items;
}

function flatten(items) {
  const out = [];
  for (const it of items) {
    const vCount = it.positions.length / 3;
    const pos = new Float32Array(it.positions.length);
    const nrm = new Float32Array(it.normals.length);
    const nm = M4.transpose(M4.invert(it.matrix));
    for (let i = 0; i < vCount; i++) {
      const p = M4.transformPoint(it.matrix, [it.positions[i * 3], it.positions[i * 3 + 1], it.positions[i * 3 + 2]]);
      pos[i * 3] = p[0];
      pos[i * 3 + 1] = p[1];
      pos[i * 3 + 2] = p[2];
      const n = V3.norm(M4.transformDir(nm, [it.normals[i * 3], it.normals[i * 3 + 1], it.normals[i * 3 + 2]]));
      nrm[i * 3] = n[0];
      nrm[i * 3 + 1] = n[1];
      nrm[i * 3 + 2] = n[2];
    }
    out.push({ pos, nrm, indices: it.indices, material: it.material, name: it.name });
  }
  return out;
}

const DEFAULT_MATERIAL = { color: "#c8ccd4", metallic: 0.1, roughness: 0.5, emissive: "#000000", emissiveIntensity: 0 };

function prepareMaterial(material) {
  const m = { ...DEFAULT_MATERIAL, ...material };
  const cl = hexToRgb(m.color).map(srgbToLinear);
  const el = hexToRgb(m.emissive).map(srgbToLinear);
  const metallic = m.metallic ?? 0.1;
  const roughness = Math.max(m.roughness ?? 0.5, 0.05);
  return {
    br: cl[0], bg: cl[1], bb: cl[2],
    emR: el[0], emG: el[1], emB: el[2], emI: m.emissiveIntensity ?? 0,
    metallic,
    kd: 1 - metallic,
    shininess: Math.max(2, 2 / (roughness * roughness) - 2),
    stR: 0.04 + (cl[0] - 0.04) * metallic,
    stG: 0.04 + (cl[1] - 0.04) * metallic,
    stB: 0.04 + (cl[2] - 0.04) * metallic,
  };
}

function prepareLights(lights) {
  return lights.map((l) => {
    const dir = l.direction ? V3.norm(l.direction) : [0, -1, 0];
    const col = hexToRgb(l.color || "#ffffff").map((c) => c * (l.intensity ?? 1));
    return {
      type: l.type === "point" ? "point" : "dir",
      px: l.position?.[0] ?? 0, py: l.position?.[1] ?? 0, pz: l.position?.[2] ?? 0,
      nx: -dir[0], ny: -dir[1], nz: -dir[2],
      r: col[0], g: col[1], b: col[2],
      intensity: l.intensity ?? 1,
      falloff: l.falloff ?? 0.1,
    };
  });
}

export function renderImage(items, opts) {
  const width = opts.width;
  const height = opts.height;
  const camera = opts.camera;
  const eye = camera.position;
  const ex = eye[0], ey = eye[1], ez = eye[2];
  const view = lookAt(eye, camera.target || [0, 0, 0], camera.up || [0, 1, 0]);
  const proj = perspective(((camera.fov ?? 45) * Math.PI) / 180, width / height, camera.near ?? 0.05, camera.far ?? 200);
  const viewProj = M4.multiply(proj, view);

  const amb = (opts.ambientColor ? hexToRgb(opts.ambientColor) : [0.6, 0.68, 0.8]).map((c) => c * (opts.ambientIntensity ?? 0.25));
  const aR = amb[0], aG = amb[1], aB = amb[2];
  const lights = prepareLights(opts.lights || []);
  // Camera-relative "headlight": keeps the visible side of an orbiting object
  // lit from any angle so dark materials never blend into the dark background.
  if (opts.headlight) {
    const ht = camera.target || [0, 0, 0];
    let hx = ex - ht[0], hy = ey - ht[1], hz = ez - ht[2];
    const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
    hx /= hl; hy /= hl; hz /= hl;
    const hc = hexToRgb(opts.headlightColor || "#ffffff");
    const hi = opts.headlight;
    lights.push({ type: "dir", px: 0, py: 0, pz: 0, nx: hx, ny: hy, nz: hz, r: hc[0] * hi, g: hc[1] * hi, b: hc[2] * hi, intensity: hi, falloff: 0 });
  }

  const color = new Float32Array(width * height * 3);
  const depth = new Float32Array(width * height).fill(Infinity);
  const groundMask = new Uint8Array(width * height);

  // background gradient (precomputed per row — no per-pixel pow)
  const bgt = hexToRgb(opts.background?.top || "#0a0d17");
  const bgb = hexToRgb(opts.background?.bottom || "#182036");
  const bgLin = new Float32Array(height * 3);
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    bgLin[y * 3] = srgbToLinear(bgt[0] + (bgb[0] - bgt[0]) * t);
    bgLin[y * 3 + 1] = srgbToLinear(bgt[1] + (bgb[1] - bgt[1]) * t);
    bgLin[y * 3 + 2] = srgbToLinear(bgt[2] + (bgb[2] - bgt[2]) * t);
  }
  for (let y = 0; y < height; y++) {
    const r0 = bgLin[y * 3], g0 = bgLin[y * 3 + 1], b0 = bgLin[y * 3 + 2];
    let di = y * width * 3;
    for (let x = 0; x < width; x++) {
      color[di] = r0; color[di + 1] = g0; color[di + 2] = b0;
      di += 3;
    }
  }

  const ground = opts.ground;
  const groundY = ground ? ground.y ?? 0 : 0;
  const gc = ground ? hexToRgb(ground.color || "#2a2f3a") : null;
  const gcR = gc ? gc[0] : 0, gcG = gc ? gc[1] : 0, gcB = gc ? gc[2] : 0;

  const prep = items.map((f) => prepareMaterial(f.material));

  const rastItem = (meshData, mat, isGround) => {
    const { pos, nrm, indices } = meshData;
    const { br, bg, bb, emR, emG, emB, emI, kd, shininess, stR, stG, stB } = mat || {};
    for (let t = 0; t < indices.length; t += 3) {
      const ia = indices[t] * 3, ib = indices[t + 1] * 3, ic = indices[t + 2] * 3;
      const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2];
      const bx = pos[ib], by = pos[ib + 1], bz = pos[ib + 2];
      const cx = pos[ic], cy = pos[ic + 1], cz = pos[ic + 2];

      const ka = M4.transformVec4(viewProj, [ax, ay, az]);
      const kb = M4.transformVec4(viewProj, [bx, by, bz]);
      const kc = M4.transformVec4(viewProj, [cx, cy, cz]);
      const wa = ka[3], wb = kb[3], wc = kc[3];
      if (wa <= 0.001 || wb <= 0.001 || wc <= 0.001) continue;

      const sax = (ka[0] / wa * 0.5 + 0.5) * width, say = (1 - (ka[1] / wa * 0.5 + 0.5)) * height, saz = ka[2] / wa;
      const sbx = (kb[0] / wb * 0.5 + 0.5) * width, sby = (1 - (kb[1] / wb * 0.5 + 0.5)) * height, sbz = kb[2] / wb;
      const scx = (kc[0] / wc * 0.5 + 0.5) * width, scy = (1 - (kc[1] / wc * 0.5 + 0.5)) * height, scz = kc[2] / wc;

      // No back-face culling. The mesh generators disagree on triangle winding
      // (makeBox winds outward, paramSurface winds inward) and on authored
      // normal direction (sphere/cylinder outward, torus inward), so any single
      // cull sign either punches holes or shows the hollow interior. Every
      // surface here is opaque, so we render both sides and let the Z-buffer
      // pick the nearest surface; the shader two-sides the normal per pixel.
      const minX = Math.max(0, Math.floor(Math.min(sax, sbx, scx)));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(sax, sbx, scx)));
      const minY = Math.max(0, Math.floor(Math.min(say, sby, scy)));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(say, sby, scy)));
      if (minX > maxX || minY > maxY) continue;

      const area = (sbx - sax) * (scy - say) - (scx - sax) * (sby - say);
      if (area > -1e-9 && area < 1e-9) continue;
      const invArea = 1 / area;
      const iwa = 1 / wa, iwb = 1 / wb, iwc = 1 / wc;

      for (let py = minY; py <= maxY; py++) {
        const fy = py + 0.5;
        const rowBase = py * width;
        for (let px = minX; px <= maxX; px++) {
          const fx = px + 0.5;
          const w0 = ((sbx - sax) * (fy - say) - (fx - sax) * (sby - say)) * invArea;
          if (w0 < -1e-4) continue;
          const w1 = ((fx - sax) * (scy - say) - (scx - sax) * (fy - say)) * invArea;
          if (w1 < -1e-4) continue;
          const la = 1 - w0 - w1;
          if (la < -1e-4) continue;

          const z = la * saz + w0 * sbz + w1 * scz;
          const idx = rowBase + px;
          if (z >= depth[idx]) continue;

          const iw = la * iwa + w0 * iwb + w1 * iwc;
          const pa = (la * iwa) / iw, pb = (w0 * iwb) / iw, pc = (w1 * iwc) / iw;
          const Px = pa * ax + pb * bx + pc * cx;
          const Py = pa * ay + pb * by + pc * cy;
          const Pz = pa * az + pb * bz + pc * cz;
          const ci = idx * 3;

          if (isGround) {
            const d = Math.sqrt(Px * Px + Pz * Pz);
            const f = d < 14 ? 1 - d / 14 : 0;
            const k = 0.35 + 0.65 * f;
            color[ci] = gcR * k; color[ci + 1] = gcG * k; color[ci + 2] = gcB * k;
            groundMask[idx] = 1;
            depth[idx] = z;
            continue;
          }

          let Nx = pa * nrm[ia] + pb * nrm[ib] + pc * nrm[ic];
          let Ny = pa * nrm[ia + 1] + pb * nrm[ib + 1] + pc * nrm[ic + 1];
          let Nz = pa * nrm[ia + 2] + pb * nrm[ib + 2] + pc * nrm[ic + 2];
          const nl = 1 / (Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz) || 1);
          Nx *= nl; Ny *= nl; Nz *= nl;

          let vx = ex - Px, vy = ey - Py, vz = ez - Pz;
          const vl = 1 / (Math.sqrt(vx * vx + vy * vy + vz * vz) || 1);
          vx *= vl; vy *= vl; vz *= vl;

          let ndv = Nx * vx + Ny * vy + Nz * vz;
          if (ndv < 0) { Nx = -Nx; Ny = -Ny; Nz = -Nz; ndv = -ndv; }

          let r = aR * br, g = aG * bg, b = aB * bb;

          for (let li = 0; li < lights.length; li++) {
            const L = lights[li];
            let lx, ly, lz, lint;
            if (L.type === "point") {
              const t0 = L.px - Px, t1 = L.py - Py, t2 = L.pz - Pz;
              const d = Math.sqrt(t0 * t0 + t1 * t1 + t2 * t2) || 1;
              lx = t0 / d; ly = t1 / d; lz = t2 / d;
              lint = L.intensity / (1 + L.falloff * d * d);
            } else {
              lx = L.nx; ly = L.ny; lz = L.nz;
              lint = L.intensity;
            }
            const ndl = Nx * lx + Ny * ly + Nz * lz;
            if (ndl > 0) {
              const diff = ndl * lint * kd;
              r += br * diff * L.r; g += bg * diff * L.g; b += bb * diff * L.b;
              let hx = lx + vx, hy = ly + vy, hz = lz + vz;
              const hl = 1 / (Math.sqrt(hx * hx + hy * hy + hz * hz) || 1);
              hx *= hl; hy *= hl; hz *= hl;
              const ndh = Nx * hx + Ny * hy + Nz * hz;
              if (ndh > 0) {
                const spec = Math.pow(ndh, shininess) * lint;
                r += spec * stR * L.r; g += spec * stG * L.g; b += spec * stB * L.b;
              }
            }
          }

          if (emI) { r += emR * emI; g += emG * emI; b += emB * emI; }
          const inv = 1 - ndv;
          const inv2 = inv * inv;
          const rim = 0.06 * inv2 * inv2;
          r += rim * stR; g += rim * stG; b += rim * stB;

          color[ci] = r; color[ci + 1] = g; color[ci + 2] = b;
          depth[idx] = z;
        }
      }
    }
  };

  const flat = flatten(items);

  if (ground) {
    const size = ground.size ?? 30;
    const N = 24;
    const gp = new Float32Array((N + 1) * (N + 1) * 3);
    const gn = new Float32Array((N + 1) * (N + 1) * 3);
    const gi = new Uint32Array(N * N * 6);
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const vi = (j * (N + 1) + i) * 3;
        gp[vi] = (i / N - 0.5) * size * 2;
        gp[vi + 1] = groundY;
        gp[vi + 2] = (j / N - 0.5) * size * 2;
        gn[vi + 1] = 1;
      }
    }
    let io = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        const b = a + 1;
        const c = a + (N + 1);
        const d = c + 1;
        gi[io++] = a; gi[io++] = c; gi[io++] = b;
        gi[io++] = b; gi[io++] = c; gi[io++] = d;
      }
    }
    rastItem({ pos: gp, nrm: gn, indices: gi }, null, true);
  }

  for (let k = 0; k < flat.length; k++) rastItem(flat[k], prep[k], false);

  // planar soft shadows
  if (ground && opts.shadow !== false) {
    const light = lights.find((l) => l.type !== "point") || lights[0];
    if (light) {
      const dx = light.nx, dy = light.ny, dz = light.nz; // direction toward light
      // light direction of travel is -d; project along it
      const tx = -dx, ty = -dy, tz = -dz;
      const STR = opts.shadowStrength ?? 0.5;
      for (const f of flat) {
        const { pos, indices } = f;
        for (let t = 0; t < indices.length; t += 3) {
          const ia = indices[t] * 3, ib = indices[t + 1] * 3, ic = indices[t + 2] * 3;
          const a0 = pos[ia], a1 = pos[ia + 1], a2 = pos[ia + 2];
          const b0 = pos[ib], b1 = pos[ib + 1], b2 = pos[ib + 2];
          const c0 = pos[ic], c1 = pos[ic + 1], c2 = pos[ic + 2];
          const ta = (a1 - groundY) / ty, tb = (b1 - groundY) / ty, tc = (c1 - groundY) / ty;
          const PA = M4.transformVec4(viewProj, [a0 + tx * ta, groundY, a2 + tz * ta]);
          const PB = M4.transformVec4(viewProj, [b0 + tx * tb, groundY, b2 + tz * tb]);
          const PC = M4.transformVec4(viewProj, [c0 + tx * tc, groundY, c2 + tz * tc]);
          if (PA[3] <= 0.001 || PB[3] <= 0.001 || PC[3] <= 0.001) continue;
          const sax = (PA[0] / PA[3] * 0.5 + 0.5) * width, say = (1 - (PA[1] / PA[3] * 0.5 + 0.5)) * height;
          const sbx = (PB[0] / PB[3] * 0.5 + 0.5) * width, sby = (1 - (PB[1] / PB[3] * 0.5 + 0.5)) * height;
          const scx = (PC[0] / PC[3] * 0.5 + 0.5) * width, scy = (1 - (PC[1] / PC[3] * 0.5 + 0.5)) * height;
          const minX = Math.max(0, Math.floor(Math.min(sax, sbx, scx)));
          const maxX = Math.min(width - 1, Math.ceil(Math.max(sax, sbx, scx)));
          const minY = Math.max(0, Math.floor(Math.min(say, sby, scy)));
          const maxY = Math.min(height - 1, Math.ceil(Math.max(say, sby, scy)));
          const area = (sbx - sax) * (scy - say) - (scx - sax) * (sby - say);
          if (area > -1e-9 && area < 1e-9) continue;
          const invArea = 1 / area;
          for (let py = minY; py <= maxY; py++) {
            const fy = py + 0.5;
            const rowBase = py * width;
            for (let px = minX; px <= maxX; px++) {
              const idx = rowBase + px;
              if (!groundMask[idx]) continue;
              const fx = px + 0.5;
              const w0 = ((sbx - sax) * (fy - say) - (fx - sax) * (sby - say)) * invArea;
              const w1 = ((fx - sax) * (scy - say) - (scx - sax) * (fy - say)) * invArea;
              if (w0 < -1e-4 || w1 < -1e-4 || 1 - w0 - w1 < -1e-4) continue;
              const ci = idx * 3;
              color[ci] *= 1 - STR;
              color[ci + 1] *= 1 - STR;
              color[ci + 2] *= 1 - STR;
            }
          }
        }
      }
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  const exposure = opts.exposure ?? 1.0;
  for (let i = 0; i < width * height; i++) {
    const ci = i * 3;
    for (let k = 0; k < 3; k++) {
      let c = color[ci + k] * exposure;
      c = c / (1 + c);
      rgba[i * 4 + k] = srgbEncode(c) | 0;
    }
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba, depth, groundMask };
}

/** Supersampled render: render at scale^2 and box-downsample. */
export function renderImageAA(items, opts) {
  const scale = Math.max(1, opts.aa ?? 2);
  if (scale === 1) return renderImage(items, opts);
  const big = renderImage(items, { ...opts, width: opts.width * scale, height: opts.height * scale });
  const { width, height } = opts;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const si = ((y * scale + dy) * big.width + (x * scale + dx)) * 4;
          r += big.rgba[si]; g += big.rgba[si + 1]; b += big.rgba[si + 2];
        }
      }
      const n = scale * scale;
      const di = (y * width + x) * 4;
      rgba[di] = r / n; rgba[di + 1] = g / n; rgba[di + 2] = b / n; rgba[di + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/** Render an object with a transparent background (for overlays/logos). */
export function renderCutout(items, opts) {
  const bgColor = opts.keyColor || "#000000";
  const base = { ...opts, background: { top: bgColor, bottom: bgColor }, ground: null, shadow: false };
  const withObj = renderImage(items, base);
  const bgOnly = renderImage([], { ...base });
  const { width, height } = withObj;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * 4;
    const d =
      Math.abs(withObj.rgba[s] - bgOnly.rgba[s]) +
      Math.abs(withObj.rgba[s + 1] - bgOnly.rgba[s + 1]) +
      Math.abs(withObj.rgba[s + 2] - bgOnly.rgba[s + 2]);
    const a = Math.min(255, Math.round(d * (opts.alphaGain ?? 4)));
    rgba[s] = withObj.rgba[s];
    rgba[s + 1] = withObj.rgba[s + 1];
    rgba[s + 2] = withObj.rgba[s + 2];
    rgba[s + 3] = a;
  }
  return { width, height, rgba };
}

export function accumulate(frames) {
  const { width, height } = frames[0];
  const rgba = new Uint8Array(width * height * 4);
  const n = frames.length;
  const inv = 1 / n;
  for (let i = 0; i < width * height; i++) {
    let r = 0, g = 0, b = 0;
    for (let f = 0; f < n; f++) {
      const s = i * 4;
      r += frames[f].rgba[s]; g += frames[f].rgba[s + 1]; b += frames[f].rgba[s + 2];
    }
    rgba[i * 4] = r * inv; rgba[i * 4 + 1] = g * inv; rgba[i * 4 + 2] = b * inv; rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}
