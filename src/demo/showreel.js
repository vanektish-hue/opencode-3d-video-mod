// Builds the demo showreel: a logo cutout, an animated 3D clip of the
// computer mouse, and a full montage timeline (transitions, multi-font
// animated text, overlays, motion blur, grading, audio).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createScene, addNode, bakedItems } from "../core/scene.js";
import { renderCutout } from "../core/raster.js";
import { encodePNG } from "../core/png.js";
import { createMouseScene } from "../core/mouse.js";
import { renderFrameSequence, orbitKeyframes } from "../core/frames.js";
import { createTimeline, renderTimeline } from "../core/video.js";

/** A glowing 3D ring used as the overlay logo (rendered with alpha). */
export function makeLogoScene() {
  const scene = createScene("logo");
  scene.materials.ring = { color: "#1a2a44", metallic: 0.7, roughness: 0.2, emissive: "#25e6ff", emissiveIntensity: 2.2 };
  scene.materials.gem = { color: "#ff3d81", metallic: 0.3, roughness: 0.15, emissive: "#ff3d81", emissiveIntensity: 1.6 };
  addNode(scene, { name: "ring", geometry: { kind: "torus", params: { majorRadius: 1, minorRadius: 0.28, seg: 72, sides: 28 } }, material: "ring", rotation: [0.9, 0.4, 0] });
  addNode(scene, { name: "gem", geometry: { kind: "sphere", params: { r: 0.42, seg: 40, rings: 24 } }, material: "gem" });
  scene.camera = { position: [0, 0.6, 3.6], target: [0, 0, 0], up: [0, 1, 0], fov: 40, near: 0.05, far: 100 };
  scene.lights = [
    { type: "directional", direction: [-1, -1.4, -0.8], color: "#ffffff", intensity: 1.4 },
    { type: "point", position: [2.5, 2, 2.5], color: "#7fd4ff", intensity: 10, falloff: 0.4 },
  ];
  return scene;
}

export function renderLogo(outPath, size = 220) {
  const scene = makeLogoScene();
  const img = renderCutout(bakedItems(scene), {
    width: size,
    height: size,
    camera: scene.camera,
    lights: scene.lights,
    ambientColor: "#334466",
    ambientIntensity: 0.4,
    exposure: 1.2,
    keyColor: "#000000",
    alphaGain: 6,
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, encodePNG(img.width, img.height, img.rgba, { alpha: true }));
  return outPath;
}

/** Render the animated 3D mouse clip (PNG sequence). */
export async function renderMouseClip(workDir, opts = {}) {
  const { width = 1280, height = 720, fps = 24, duration = 4.2, samples = 4, aa = 1 } = opts;
  const scene = createMouseScene();
  const dir = join(workDir, "mouse3d");
  await renderFrameSequence(scene, {
    outDir: dir,
    width,
    height,
    fps,
    duration,
    samples,
    aa,
    cameraPath: orbitKeyframes({
      center: [0, 0.5, -0.15],
      radius: 5.0,
      radiusEnd: 3.3,
      height: 2.7,
      startAngle: Math.PI * 0.55,
      endAngle: Math.PI * 2.55,
      targetY: 0.5,
      fov: 42,
      duration,
      steps: 8,
    }),
    ambientIntensity: 0.36,
    exposure: 1.18,
    onProgress: opts.onProgress,
  });
  return dir;
}

const FONT_LINES = [
  { text: "Bahnschrift", font: "bahnschrift", color: "#7fd4ff" },
  { text: "Georgia Serif", font: "georgia", color: "#ffd166" },
  { text: "IMPACT", font: "impact", color: "#ff6b6b" },
  { text: "Comic Sans", font: "comic", color: "#06d6a0" },
  { text: "Consolas Mono", font: "consolas", color: "#c792ea" },
  { text: "Ink Free", font: "inkfree", color: "#ff9f1c" },
];

/** Assemble the full showreel timeline. */
export function buildShowreelTimeline(ctx) {
  const { width, height, fps, mousePattern, logoPath, total3d } = ctx;
  const tl = createTimeline({ width, height, fps, name: "showreel" });

  // --- 1. intro ---
  tl.segments.push({
    name: "intro",
    source: { type: "gradient", colors: ["#0a1030", "#3a1050"], speed: 0.06 },
    duration: 3.6,
    animation: { type: "zoomIn", max: 1.18 },
    grade: { contrast: 1.08, saturation: 1.15 },
    vignette: 3.4,
    text: [
      { text: "CREATOR STUDIO", font: "arialBlack", size: 92, color: "white", border: 4, borderColor: "#1b6bff", shadow: true, animation: "slideUp", x: "center", y: 288, delay: 0.35, duration: 3.0, fadeIn: 0.6 },
      { text: "3D modeling  +  video montage", font: "georgia", size: 36, color: "#9fd0ff", animation: "slideUp", x: "center", y: 400, delay: 1.05, duration: 2.3, fadeIn: 0.6 },
      { text: "an opencode MCP mod", font: "consolas", size: 22, color: "#7f90b0", x: "center", y: 640, delay: 1.9, duration: 1.5 },
    ],
  });

  // --- 2. 3D mouse ---
  tl.segments.push({
    name: "mouse-3d",
    source: { type: "frames", pattern: join(mousePattern, "frame_%04d.png"), fps, start: 1 },
    duration: total3d,
    motionBlur: 2,
    grade: { contrast: 1.05, saturation: 1.06 },
    vignette: 3,
    text: [
      { text: "3D MODELING", font: "bahnschrift", size: 30, color: "#04121f", box: true, boxColor: "white@0.92", boxBorder: 14, x: 48, y: 48, animation: "slideLeft", delay: 0.2, duration: total3d - 0.2, fadeIn: 0.5 },
      { text: "procedural computer mouse, rendered on CPU", font: "segoe", size: 24, color: "white", box: true, boxColor: "black@0.45", boxBorder: 12, x: 48, y: 620, animation: "slideLeft", delay: 0.6, duration: total3d - 0.8, fadeIn: 0.5 },
      { text: "120 frames  ·  motion blur  ·  orbit camera", font: "consolas", size: 20, color: "#9fd0ff", x: "right", y: 48, margin: 48, delay: 1.0, duration: total3d - 1.2, fadeIn: 0.5 },
    ],
  });

  // --- 3. typography showcase ---
  const typeTexts = [
    { text: "MULTIPLE FONTS", font: "arialBlack", size: 44, color: "white", x: "center", y: 70, delay: 0.2, duration: 4.0, fadeIn: 0.4 },
  ];
  FONT_LINES.forEach((line, i) => {
    typeTexts.push({
      text: line.text,
      font: line.font,
      size: 54,
      color: line.color,
      x: 140,
      y: 150 + i * 88,
      animation: "slideRight",
      slide: 160,
      delay: 0.5 + i * 0.32,
      duration: 3.6 - i * 0.32,
      fadeIn: 0.4,
    });
  });
  tl.segments.push({
    name: "typography",
    source: { type: "color", color: "#0b0e17" },
    duration: 4.4,
    grade: { contrast: 1.05, saturation: 1.1 },
    vignette: 3.2,
    text: typeTexts,
  });

  // --- 4. procedural fx ---
  tl.segments.push({
    name: "fx",
    source: { type: "mandelbrot", iter: 220 },
    duration: 3.2,
    filters: ["eq=contrast=1.25:saturation=1.7", "hue=h='20*t'"],
    motionBlur: 2,
    vignette: 2.6,
    text: [
      { text: "PROCEDURAL FX", font: "impact", size: 80, color: "white", border: 3, borderColor: "#111133", animation: "slideUp", x: "center", y: 300, delay: 0.3, duration: 2.7, fadeIn: 0.5 },
      { text: "fractal source  ·  hue shift  ·  motion blur  ·  vignette", font: "segoe", size: 24, color: "#d7e3ff", x: "center", y: 400, delay: 0.9, duration: 2.1 },
    ],
  });

  // --- 5. outro ---
  tl.segments.push({
    name: "outro",
    source: { type: "gradient", colors: ["#050710", "#123a6a"], speed: 0.03 },
    duration: 3.2,
    animation: { type: "zoomOut", max: 1.2 },
    vignette: 3.4,
    text: [
      { text: "THE END", font: "arialBlack", size: 96, color: "white", shadow: true, animation: "slideUp", x: "center", y: 290, delay: 0.3, duration: 2.4, fadeIn: 0.6 },
      { text: "computer mouse modeled, rendered and cut in one pipeline", font: "georgia", size: 28, color: "#9fd0ff", x: "center", y: 400, delay: 1.0, duration: 1.7 },
    ],
  });

  tl.transitions = [
    { type: "wipeleft", duration: 0.6 },
    { type: "circleopen", duration: 0.6 },
    { type: "slideleft", duration: 0.6 },
    { type: "fadeblack", duration: 0.7 },
  ];

  // global overlay logo + watermark
  tl.overlays = [
    { path: logoPath, x: "right", y: "top", margin: 34, w: 130, delay: 0.6, duration: null, fadeIn: 0.7, fadeOut: 0.7 },
  ];
  tl.texts = [
    { text: "opencode", font: "segoe", size: 20, color: "#8fa2c8", x: "left", y: "bottom", margin: 30, delay: 1.0, duration: 1e9, fadeIn: 0.8, fadeOut: 0.8 },
  ];
  tl.grade = { contrast: 1.04, saturation: 1.06 };
  tl.vignette = 4;
  tl.fadeOut = 1.2;

  // audio: chord pad + pentatonic melody
  const scale = [196.0, 220.0, 246.94, 293.66, 329.63, 392.0, 440.0];
  const notes = [];
  for (let i = 0; i < 26; i++) {
    notes.push({ freq: scale[i % scale.length] * (i % 4 === 3 ? 2 : 1), start: 2.6 + i * 0.5, duration: 0.34 });
  }
  tl.audio = {
    tracks: [
      { type: "chord", freqs: [98.0, 146.83, 196.0], duration: 1e9, volume: 0.05 },
      { type: "melody", notes, volume: 0.05 },
      { type: "noise", volume: 0.008 },
    ],
    fadeIn: 0.8,
    fadeOut: 1.6,
  };
  tl.output = { crf: 20, preset: "medium" };
  return tl;
}

/**
 * Full pipeline: render logo + 3D frames, build timeline, encode video.
 * Returns { outPath, timeline, duration, assets }.
 */
export async function renderShowreel(outPath, opts = {}) {
  const width = opts.width || 1280;
  const height = opts.height || 720;
  const fps = opts.fps || 24;
  const workDir = opts.workDir || join(process.cwd(), "tmp", "showreel");
  mkdirSync(workDir, { recursive: true });

  const logoPath = join(workDir, "logo.png");
  renderLogo(logoPath, opts.logoSize || 200);

  const duration3d = opts.duration3d ?? 4.2;
  const mousePattern = await renderMouseClip(workDir, {
    width: opts.clipWidth || width,
    height: opts.clipHeight || height,
    fps,
    duration: duration3d,
    samples: opts.samples ?? 4,
    aa: opts.aa ?? 1,
    onProgress: opts.onClipProgress,
  });

  const timeline = buildShowreelTimeline({
    width, height, fps, mousePattern, logoPath, total3d: duration3d,
  });
  const res = await renderTimeline(timeline, outPath, { workDir, onProgress: opts.onProgress });
  return { outPath, timeline, duration: res.total, assets: { logoPath, mousePattern }, built: res };
}
