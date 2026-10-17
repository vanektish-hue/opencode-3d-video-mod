// Render an animated PNG frame sequence from a scene + camera path, with
// supersampling (AA) and true sub-frame accumulation for motion blur.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePNG } from "./png.js";
import { renderImage, accumulate } from "./raster.js";
import { bakedItems } from "./scene.js";

const smooth = (x) => x * x * (3 - 2 * x);

/** Interpolate a camera from keyframes [{t, position, target, fov}] at time t. */
export function cameraAt(keyframes, t) {
  const kfs = [...keyframes].sort((a, b) => a.t - b.t);
  if (t <= kfs[0].t) return kfs[0];
  if (t >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1];
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = smooth((t - a.t) / (b.t - a.t || 1));
      const lerp = (u, v) => u + (v - u) * f;
      return {
        position: a.position.map((v, k) => lerp(v, b.position[k])),
        target: (a.target || [0, 0, 0]).map((v, k) => lerp(v, (b.target || [0, 0, 0])[k])),
        fov: lerp(a.fov ?? 42, b.fov ?? 42),
        up: a.up || [0, 1, 0],
      };
    }
  }
  return kfs[kfs.length - 1];
}

/** Convenience: a keyframe list describing an orbit around a center. */
export function orbitKeyframes(opts) {
  const { center = [0, 0, 0], radius = 4, height = 2.2, startAngle = 0, endAngle = Math.PI * 2, duration = 5, steps = 8, targetY = 0.45, fov = 42, radiusEnd } = opts;
  const kfs = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const ang = startAngle + (endAngle - startAngle) * f;
    const r = radius + ((radiusEnd ?? radius) - radius) * f;
    kfs.push({
      t: duration * f,
      position: [center[0] + Math.cos(ang) * r, height, center[2] + Math.sin(ang) * r],
      target: [center[0], targetY, center[2]],
      fov,
    });
  }
  return kfs;
}

function downsample(img, width, height, ss) {
  const rgba = new Uint8Array(width * height * 4);
  const inv = 1 / (ss * ss);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const si = ((y * ss + dy) * img.width + (x * ss + dx)) * 4;
          r += img.rgba[si];
          g += img.rgba[si + 1];
          b += img.rgba[si + 2];
        }
      }
      const di = (y * width + x) * 4;
      rgba[di] = r * inv;
      rgba[di + 1] = g * inv;
      rgba[di + 2] = b * inv;
      rgba[di + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/**
 * Render a PNG sequence.
 * opts: { outDir, pattern, width, height, fps, duration, samples, shutter, aa,
 *         cameraPath (fn|keyframes), background, ground, lights, ambient*,
 *         exposure, onProgress }
 */
export async function renderFrameSequence(scene, opts) {
  const width = opts.width || 640;
  const height = opts.height || 360;
  const fps = opts.fps || 24;
  const duration = opts.duration ?? 4;
  const samples = Math.max(1, opts.samples ?? 2);
  const aa = Math.max(1, opts.aa ?? 2);
  const shutter = opts.shutter ?? 1; // fraction of a frame the shutter is open
  const frames = Math.max(1, Math.round(duration * fps));
  const outDir = opts.outDir;
  const pattern = opts.pattern || "frame_%04d.png";
  mkdirSync(outDir, { recursive: true });

  const items = bakedItems(scene);
  const pathFn = typeof opts.cameraPath === "function" ? opts.cameraPath : (t) => cameraAt(opts.cameraPath, t);
  const renderOpts = {
    width: width * aa,
    height: height * aa,
    lights: opts.lights || scene.lights,
    background: opts.background || scene.background,
    ground: opts.ground === undefined ? scene.ground : opts.ground,
    ambientColor: opts.ambientColor || "#5f7391",
    ambientIntensity: opts.ambientIntensity ?? 0.35,
    exposure: opts.exposure ?? 1.15,
    headlight: opts.headlight ?? 0,
    headlightColor: opts.headlightColor || "#ffffff",
  };

  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    const subFrames = [];
    for (let k = 0; k < samples; k++) {
      const tt = t + (k / samples) * (shutter / fps);
      const cam = pathFn(tt);
      subFrames.push(renderImage(items, { ...renderOpts, camera: cam }));
    }
    const blended = samples > 1 ? accumulate(subFrames) : subFrames[0];
    const img = aa > 1 ? downsample(blended, width, height, aa) : blended;
    const file = join(outDir, pattern.replace("%04d", String(i + 1).padStart(4, "0")));
    writeFileSync(file, encodePNG(width, height, img.rgba, { alpha: false }));
    if (opts.onProgress) opts.onProgress(i + 1, frames);
  }

  return { dir: outDir, count: frames, pattern: join(outDir, pattern), width, height, fps, duration };
}
