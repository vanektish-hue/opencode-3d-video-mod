// Render turntable PNG sequences (and stills) for the gallery models.
import { join } from "node:path";
import { renderFrameSequence, orbitKeyframes } from "../core/frames.js";
import { buildModelScene } from "./models.js";

export function clipDir(workDir, key) {
  return join(workDir, "clips", key);
}

export function clipPattern(workDir, key) {
  return join(clipDir(workDir, key), "frame_%04d.png");
}

/** Render an orbiting clip of one model. */
export async function renderModelClip(key, workDir, opts = {}) {
  const {
    width = 1280, height = 720, fps = 24, duration = 4, samples = 1, aa = 2,
    turns = 1, startAngle = Math.PI * 0.55, radiusFactor = 1, onProgress, still = false,
  } = opts;
  const scene = buildModelScene(key);
  const o = scene.meta.orbit || {};
  const dir = clipDir(workDir, key);
  const dur = still ? 1 / fps : duration;
  await renderFrameSequence(scene, {
    outDir: dir,
    width,
    height,
    fps,
    duration: dur,
    samples,
    aa,
    cameraPath: orbitKeyframes({
      center: o.center || [0, 0, 0],
      radius: (o.radius || 4) * radiusFactor,
      radiusEnd: (o.radius || 4) * 0.72 * radiusFactor,
      height: o.height || 2,
      startAngle,
      endAngle: startAngle + Math.PI * 2 * turns,
      targetY: o.targetY || 0.5,
      fov: o.fov || 40,
      duration: dur,
      steps: 8,
    }),
    ambientColor: "#8296bd",
    ambientIntensity: 0.46,
    exposure: 1.2,
    headlight: 0.45,
    headlightColor: "#dceaff",
    background: { top: "#0f1b34", bottom: "#2a3d63" },
    ground: { y: 0, color: "#2e3d5e", size: 30 },
    onProgress,
  });
  return dir;
}
