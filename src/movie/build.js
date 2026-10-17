// Assembles the 10-minute movie: layout, 3D clips, captions, audio bus and
// the final ffmpeg render.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTimeline, renderTimeline, FONT_DIR } from "../core/video.js";
import { renderFrameSequence, orbitKeyframes } from "../core/frames.js";
import { SCENES, CHANNEL } from "./script.js";
import { renderModelClip, clipPattern, clipDir } from "./clips.js";
import { buildAudioBus } from "./audio.js";
import { buildModelScene } from "./models.js";

const W = 1280, H = 720, FPS = 24;
const CLIP_W = 1280, CLIP_H = 720;
const TARGET = 630; // seconds — narration alone is ~10:05, plus breathing room
const LEAD = 0.12;  // narration starts this far into its scene
const GAP = 0.5;    // silence guaranteed between consecutive narrations

const FONTS = ["bahnschrift", "georgiaBold", "impact", "consolas", "comic", "inkfree", "arialBlack", "segoeSemibold", "trebuchet", "verdanaBold"];
const ACCENTS = ["#7fd4ff", "#ff6b6b", "#2fbf71", "#ffd166", "#c792ea", "#ff6b9d", "#5ad1ff", "#a6ff5d", "#ff9f1c", "#9b7bff"];

const GALLERY_MODELS = ["mug", "controller", "headphones", "phone", "house", "dice", "robot", "planet", "rocket"];
const GALLERY_LABELS = ["Кружка", "Геймпад", "Наушники", "Телефон", "Домик", "Кости", "Робот", "Планета", "Ракета"];
const LABEL_BY_MODEL = Object.fromEntries(GALLERY_MODELS.map((m, i) => [m, GALLERY_LABELS[i]]));
LABEL_BY_MODEL.mouse = "Мышь";

function fontFor(idx, variant = 0) {
  return FONTS[(idx * 3 + variant) % FONTS.length];
}
function accentFor(idx) {
  return ACCENTS[idx % ACCENTS.length];
}

function loadNarration(workDir) {
  const p = join(workDir, "narration.json");
  if (!existsSync(p)) throw new Error(`narration.json not found at ${p}; run: node scripts/movie-voice.mjs`);
  const rep = JSON.parse(readFileSync(p, "utf8"));
  const map = new Map();
  for (const s of rep.scenes) {
    // word-boundary marks live next to the mp3 as <name>.words.json
    let marks = [];
    const wordsPath = String(s.mp3 || "").replace(/\.mp3$/i, ".words.json");
    if (wordsPath && existsSync(wordsPath)) {
      try {
        const parsed = JSON.parse(readFileSync(wordsPath, "utf8"));
        if (Array.isArray(parsed)) marks = parsed;
      } catch {
        marks = [];
      }
    }
    map.set(s.id, { ...s, marks });
  }
  return map;
}

// ---------------------------------------------------------------- captions
function fmt(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(mm).padStart(3, "0")}`;
}

/** Group word marks into readable cues (<= ~6s, <= ~2 lines of ~44 chars). */
function buildCues(marks, startAbs, lead) {
  const cues = [];
  if (!Array.isArray(marks)) return cues;
  let cur = null;
  for (const mk of marks) {
    const text = String(mk.w || "").trim();
    if (!text) continue;
    const t0 = startAbs + lead + mk.t;
    const t1 = startAbs + lead + mk.t + Math.max(mk.d, 0.12);
    if (!cur) cur = { text, t0, t1 };
    else {
      const would = `${cur.text} ${text}`;
      const dur = t1 - cur.t0;
      if (would.length > 46 || dur > 6.2) {
        cues.push(cur);
        cur = { text, t0, t1 };
      } else {
        cur.text = would;
        cur.t1 = t1;
      }
    }
  }
  if (cur) cues.push(cur);
  // enforce a minimum on-screen time
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].t1 - cues[i].t0 < 0.7) cues[i].t1 = cues[i].t0 + 0.7;
    if (i + 1 < cues.length && cues[i].t1 > cues[i + 1].t0) cues[i].t1 = cues[i + 1].t0;
  }
  return cues;
}

function srtFromCues(cues) {
  return cues.map((c, i) => `${i + 1}\n${fmt(c.t0)} --> ${fmt(c.t1)}\n${c.text}\n`).join("\n");
}

// ---------------------------------------------------------------- text specs
// Specs describe STYLE only. Timing (delay/hold) is attached by the planner so a
// long scene can be split into several visual "beats" while its text stays global.
function chapterSpec(scene, accent) {
  return {
    text: String(scene.chapter || "").toUpperCase(),
    font: "bahnschrift", size: 25, color: accent,
    box: true, boxColor: "black@0.38", boxBorder: 11,
    x: 44, y: 34, animation: "slideLeft", slide: 80, fadeIn: 0.4, fadeOut: 0.4,
  };
}

function bigTitleSpec(text, idx, accent, y = 246, sizeCap = 96) {
  const size = text.length > 22 ? 60 : text.length > 14 ? 76 : sizeCap;
  return {
    text, font: fontFor(idx), size, color: "white",
    border: 4, borderColor: accent, shadow: true, shadowColor: "black@0.55", shadowX: 4, shadowY: 5,
    x: "center", y, animation: "slideUp", slide: 60, fadeIn: 0.5, fadeOut: 0.45,
  };
}

function subSpec(text, idx, accent, y = 368) {
  return { text, font: fontFor(idx, 1), size: 30, color: accent, x: "center", y, animation: "slideUp", slide: 30, fadeIn: 0.5, fadeOut: 0.4 };
}

function bulletSpec(text, i, idx, y) {
  return {
    text: `${i + 1}.  ${text}`, font: fontFor(idx, 1), size: 38, color: "#eaeef7",
    box: true, boxColor: "black@0.34", boxBorder: 10,
    x: 130, y, animation: "slideRight", slide: 44, fadeIn: 0.4, fadeOut: 0.4,
  };
}

function gridSpec(text, accent, col, row) {
  return {
    text, font: "segoeSemibold", size: 40, color: "white",
    box: true, boxColor: accent + "@0.20", boxBorder: 15,
    x: 128 + col * 540, y: 292 + row * 116, animation: "slideUp", slide: 30, fadeIn: 0.35, fadeOut: 0.35,
  };
}

function galleryCaptionSpecs(name, index, total) {
  return [
    { text: name, font: "arialBlack", size: 58, color: "white", border: 3, borderColor: "#ffd166", shadow: true, x: "center", y: 552, animation: "slideUp", slide: 30, fadeIn: 0.25, fadeOut: 0.25 },
    { text: `${index + 1} / ${total}`, font: "consolas", size: 24, color: "#ffd166", x: "right", y: 44, margin: 46, fadeIn: 0.3, fadeOut: 0.3 },
  ];
}

/** Style-only text items with times relative to the scene start. */
function planSceneTexts(scene, idx, dur) {
  const accent = accentFor(idx);
  const v = scene.visual || {};
  const isGallery = Array.isArray(scene.gallery);
  const isFrames = v.kind === "frames" && !isGallery;
  const hasList = Array.isArray(v.bullets) || Array.isArray(v.grid);
  const items = [];
  items.push({ spec: chapterSpec(scene, accent), at: 0, hold: dur });
  if (v.big) {
    const y = isGallery ? 108 : isFrames ? 536 : hasList ? 122 : 244;
    const sizeCap = isGallery ? 62 : isFrames ? 50 : 96;
    const hold = isGallery || isFrames ? dur : hasList ? Math.min(7, Math.max(3, dur - 0.4)) : dur - 0.5;
    items.push({ spec: bigTitleSpec(v.big, idx, accent, y, sizeCap), at: 0.15, hold });
  }
  if (v.sub) {
    const y = hasList ? 218 : 366;
    items.push({ spec: subSpec(v.sub, idx, accent, y), at: 0.5, hold: Math.max(2.2, dur - 1) });
  }
  const list = v.bullets || v.grid;
  if (list) {
    const n = list.length;
    const step = Math.min(7, Math.max(1.4, (dur - 2.8) / Math.max(1, n)));
    list.forEach((entry, i) => {
      const at = 0.55 + i * step;
      const spec = Array.isArray(v.bullets)
        ? bulletSpec(entry, i, idx, (v.big ? 298 : 284) + i * 62)
        : gridSpec(entry, accent, i % 2, Math.floor(i / 2));
      items.push({ spec, at, hold: Math.max(1.2, dur - at - 0.2) });
    });
  }
  if (v.outro) {
    items.push({ spec: { text: `${CHANNEL} · поддержать: boosty в описании`, font: "consolas", size: 26, color: "#9fd0ff", x: "center", y: 470, fadeIn: 0.5, fadeOut: 0.4 }, at: 0.9, hold: Math.max(2, dur - 1.2) });
  }
  return items;
}

/** Beat boundaries: start at 0, cut on text moments, cap length ~9s. */
function planBeats(dur, anchors, maxBeat = 9, minBeat = 2.8, maxBeats = 6) {
  const b = [0];
  for (const a of anchors.filter((x) => x > minBeat && x < dur - minBeat).sort((x, y) => x - y)) {
    if (a - b[b.length - 1] >= minBeat) b.push(a);
  }
  b.push(dur);
  const out = [b[0]];
  for (let i = 1; i < b.length; i++) {
    const prev = out[out.length - 1];
    const gap = b[i] - prev;
    if (gap > maxBeat && out.length < maxBeats) {
      const parts = Math.ceil(gap / maxBeat);
      for (let k = 1; k < parts; k++) out.push(prev + (gap * k) / parts);
    }
    out.push(b[i]);
  }
  while (out.length - 1 > maxBeats) {
    let bi = 0, bs = Infinity;
    for (let i = 0; i < out.length - 2; i++) {
      const s = out[i + 1] - out[i];
      if (s < bs) { bs = s; bi = i; }
    }
    out.splice(bi + 1, 1);
  }
  return out;
}

/** Shift a hex/rgb colour toward a darker/brighter tone for visual beat variety. */
function shade(color, amt) {
  const c = Array.isArray(color) ? color : (() => {
    const h = String(color).replace("#", "");
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  })();
  const f = amt < 0 ? 1 + amt : 1;
  const add = amt > 0 ? amt : 0;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const to255 = (x) => Math.round(clamp(x) * 255).toString(16).padStart(2, "0");
  return `#${to255(c[0] * f + add * (1 - c[0]))}${to255(c[1] * f + add * (1 - c[1]))}${to255(c[2] * f + add * (1 - c[2]))}`;
}

// Ensure each xfade overlap is budgeted into its scene's length (see
// buildLayout) so a scene is never shortened below its narration.
function buildLayout(narr) {
  const sceneLayouts = [];
  let idx = 0;
  for (const scene of SCENES) {
    idx += 1;
    if (scene.fixed) {
      sceneLayouts.push({
        scene, index: idx, kind: "fixed", narr: null, base: scene.fixed, texts: null,
        parts: [{ type: "bg", duration: scene.fixed, beat: 0 }],
      });
      continue;
    }
    const n = narr.get(scene.id);
    if (!n) throw new Error(`No narration for scene ${scene.id}`);
    const base = n.duration;
    const parts = [];
    if (Array.isArray(scene.gallery)) {
      const per = base / scene.gallery.length;
      scene.gallery.forEach((m, i) => {
        parts.push({
          type: "frames", model: m, duration: per,
          texts: galleryCaptionSpecs(LABEL_BY_MODEL[m] || m, i, scene.gallery.length).map((s, k) => ({ spec: s, at: 0.1 + k * 0.05, hold: Math.max(0.4, per - 0.25) })),
        });
      });
    } else if (scene.model) {
      const clipLen = Math.min(10, Math.max(4, base - 4));
      parts.push({ type: "frames", model: scene.model, duration: clipLen });
      if (base - clipLen > 0.4) parts.push({ type: "bg", duration: base - clipLen, beat: 0 });
    } else {
      const anchors = planSceneTexts(scene, idx, base).filter((it) => it.at > 0.6).map((it) => it.at);
      const bounds = planBeats(base, anchors);
      for (let k = 0; k < bounds.length - 1; k++) parts.push({ type: "bg", duration: bounds[k + 1] - bounds[k], beat: k });
    }
    sceneLayouts.push({ scene, index: idx, kind: "narr", narr: n, base, texts: null, parts });
  }

  // xfade transitions overlap neighbouring segments, which pulls every scene's
  // effective end earlier than its nominal length. Left alone, each narration
  // therefore starts before the previous one finishes (voices collide). Grow
  // each scene by exactly the time its transitions consume, so its on-screen
  // span becomes narration + GAP.
  for (let iter = 0; iter < 6; iter++) {
    const segs = flattenSegments(sceneLayouts);
    const transitions = pickTransitions(segs);
    const consumed = new Map();
    for (let i = 0; i < segs.length - 1; i++) {
      const sl = segs[i].sl;
      consumed.set(sl, (consumed.get(sl) || 0) + transitions[i].duration);
    }
    let changed = false;
    for (const sl of sceneLayouts) {
      if (sl.kind !== "narr") continue;
      const dur = sl.parts.reduce((a, p) => a + p.duration, 0);
      const span = dur - (consumed.get(sl) || 0);
      const delta = sl.base + GAP - span;
      if (Math.abs(delta) < 1e-3) continue;
      const last = sl.parts[sl.parts.length - 1];
      if (last.type === "bg") {
        const nd = Math.max(0, last.duration + delta);
        if (Math.abs(nd - last.duration) > 1e-4) { last.duration = nd; changed = true; }
      } else if (delta > 0.05) {
        sl.parts.push({ type: "bg", duration: delta, beat: 99 });
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const sl of sceneLayouts) {
    sl.total = sl.parts.reduce((a, p) => a + p.duration, 0);
    sl.texts = planSceneTexts(sl.scene, sl.index, sl.total);
  }
  return sceneLayouts;
}

function flattenSegments(sceneLayouts) {
  const segs = [];
  for (const sl of sceneLayouts) {
    sl.firstSeg = segs.length;
    for (const part of sl.parts) {
      segs.push({ ...part, scene: sl.scene, sl });
    }
    sl.lastSeg = segs.length - 1;
  }
  return segs;
}

function pickTransitions(segs) {
  const simple = ["fade", "dissolve", "fade", "smoothleft", "fade", "wipeleft", "fade", "circleopen"];
  const beats = ["wipeleft", "fade", "wipeup", "fade", "smoothleft", "fade", "smoothright", "fade"];
  const t = [];
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i], b = segs[i + 1];
    const sameScene = a.scene === b.scene;
    const sameGallery = sameScene && a.type === "frames" && b.type === "frames" && a.scene.id === "gallery";
    if (sameGallery) t.push({ type: "fade", duration: 0.4 });
    else if (sameScene) t.push({ type: beats[i % beats.length], duration: 0.5 });
    else t.push({ type: simple[i % simple.length], duration: 0.65 });
  }
  return t;
}

// ---------------------------------------------------------------- ffmpeg assembly
function bgSource(v) {
  switch (v.kind) {
    case "gradient": return { type: "gradient", colors: v.colors || ["#0a1030", "#3a1050"], speed: v.speed ?? 0.03 };
    case "mandelbrot": return { type: "mandelbrot", iter: v.iter || 220 };
    case "life": return { type: "life", seed: v.seed || 7 };
    case "noise": return { type: "noise", seed: v.seed || 3 };
    case "color":
    default: return { type: "color", color: v.color || "#0d1020" };
  }
}

/** Vary a scene's background per visual beat so intra-scene cuts are visible. */
function beatVisual(v, beat) {
  if (!beat) return v;
  if (v.kind === "gradient" && Array.isArray(v.colors) && v.colors.length >= 2) {
    return beat % 2 === 1
      ? { ...v, colors: [shade(v.colors[0], -0.3), v.colors[1]] }
      : { ...v, colors: [v.colors[0], shade(v.colors[1], -0.32)] };
  }
  if (v.kind === "color") return { ...v, color: shade(v.color || "#0d1020", beat % 2 ? -0.28 : 0.16) };
  return v;
}

function frameSource(workDir, model) {
  return { type: "frames", pattern: clipPattern(workDir, model), fps: FPS, start: 1 };
}

const BG_ANIM = ["zoomIn", "panRight", "zoomIn", "zoomOut"];

async function renderClips(sceneLayouts, workDir, onProgress, opts = {}) {
  const jobs = [];
  for (const sl of sceneLayouts) {
    for (const part of sl.parts) {
      if (part.type !== "frames") continue;
      const frames = Math.round(part.duration * FPS) + 4;
      jobs.push({ model: part.model, duration: frames / FPS, length: part.duration });
    }
  }
  const byModel = new Map();
  for (const j of jobs) {
    const prev = byModel.get(j.model);
    if (!prev || j.duration > prev.duration) byModel.set(j.model, j);
  }
  const list = [...byModel.values()];
  let done = 0;
  for (const j of list) {
    const dir = clipDir(workDir, j.model);
    let have = 0;
    if (opts.reuse && existsSync(dir)) {
      have = readdirSync(dir).filter((f) => /^frame_\d+\.png$/.test(f)).length;
    }
    const need = Math.round(j.duration * FPS);
    if (opts.reuse && have >= need) {
      if (onProgress) onProgress({ model: j.model, frame: need, frames: need, job: done + 1, jobs: list.length, reused: true });
      done += 1;
      continue;
    }
    await renderModelClip(j.model, workDir, {
      width: CLIP_W, height: CLIP_H, fps: FPS, duration: j.duration, samples: 1, aa: 2, turns: 1,
      startAngle: Math.PI * (0.4 + Math.random() * 0.3),
      radiusFactor: 1,
      onProgress: (i, total) => {
        if (onProgress) onProgress({ model: j.model, frame: i, frames: total, job: done + 1, jobs: list.length });
      },
    });
    done += 1;
  }
  return list.map((j) => j.model);
}

export function computeChapters(sceneLayouts, segStarts) {
  return sceneLayouts
    .filter((sl) => sl.kind === "narr")
    .map((sl) => ({ id: sl.scene.id, title: sl.scene.chapter, start: segStarts[sl.firstSeg] }));
}

/**
 * Full pipeline. Returns { outPath, total, chapters, supportStart, cues }.
 */
export async function buildMovie(outPath, opts = {}) {
  const workDir = opts.workDir || join(process.cwd(), "tmp", "movie");
  mkdirSync(workDir, { recursive: true });
  const log = opts.log || (() => {});

  const narr = loadNarration(workDir);
  const sceneLayouts = buildLayout(narr);
  const segs = flattenSegments(sceneLayouts);
  const transitions = pickTransitions(segs);

  // compute start times, then tune the endcard so the movie hits ~10:30
  let starts = computeStarts(segs, transitions);
  let total = starts[starts.length - 1] + segs[segs.length - 1].duration;
  const endcardSeg = segs.find((s) => s.scene.id === "endcard");
  if (endcardSeg) {
    const delta = TARGET - total;
    if (delta > -3 && delta < 60) endcardSeg.duration += delta;
    starts = computeStarts(segs, transitions);
    total = starts[starts.length - 1] + segs[segs.length - 1].duration;
  }
  log(`Layout: ${segs.length} segments, ${transitions.length} transitions, total ${total.toFixed(1)}s`);

  const chapters = computeChapters(sceneLayouts, starts);
  const supportSl = sceneLayouts.find((sl) => sl.scene.id === "support");
  const supportStart = supportSl ? starts[supportSl.firstSeg] : null;

  if (opts.dryRun) {
    return { dryRun: true, total, chapters, supportStart, segmentCount: segs.length, scenes: sceneLayouts.map((sl) => ({ id: sl.scene.id, start: starts[sl.firstSeg], total: sl.total, parts: sl.parts.length })) };
  }

  // --- render 3D clips ---
  log("Rendering 3D clips...");
  const t0 = Date.now();
  await renderClips(sceneLayouts, workDir, (p) => {
    if (p.frame % 12 === 0 || p.frame === p.frames) log(`  clip ${p.job}/${p.jobs} ${p.model} ${p.frame}/${p.frames}`);
  }, { reuse: opts.reuseClips });
  log(`3D clips done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // --- captions + global text overlays (absolute time) ---
  const cues = [];
  const globalTexts = [];
  for (const sl of sceneLayouts) {
    const sceneAbs = starts[sl.firstSeg];
    for (const it of sl.texts || []) globalTexts.push({ ...it.spec, delay: sceneAbs + it.at, duration: it.hold });
    for (let pi = 0; pi < sl.parts.length; pi++) {
      const part = sl.parts[pi];
      if (!part.texts) continue;
      const partAbs = starts[sl.firstSeg + pi];
      for (const it of part.texts) globalTexts.push({ ...it.spec, delay: partAbs + it.at, duration: it.hold });
    }
    if (sl.narr && sl.narr.marks) cues.push(...buildCues(sl.narr.marks, sceneAbs, LEAD));
  }
  const srtPath = join(workDir, "subs.srt");
  writeFileSync(srtPath, srtFromCues(cues), "utf8");
  log(`Captions: ${cues.length} cues; global text items: ${globalTexts.length}`);

  // --- audio bus ---
  const audioLayout = sceneLayouts
    .filter((sl) => sl.narr)
    .map((sl) => ({
      id: sl.scene.id,
      start: starts[sl.firstSeg] + LEAD,
      duration: sl.total,
      mp3: sl.narr.mp3,
      chapter: sl.scene.chapter,
      chapterStart: true,
    }));
  log("Mixing audio...");
  let audio;
  const busPath = join(workDir, "audio_bus.wav");
  const busOk = opts.reuseClips && existsSync(busPath) && (() => {
    try {
      const bytes = statSync(busPath).size - 44;
      const dur = bytes / (2 * 2 * 48000); // 16-bit stereo @48k
      return dur >= total - 0.5 && dur <= total + 2.5;
    } catch {
      return false;
    }
  })();
  if (busOk) {
    audio = { wavPath: busPath, peak: NaN, reused: true };
    log(`Audio bus reused -> ${busPath}`);
  } else {
    audio = await buildAudioBus(audioLayout, total, workDir, {});
    log(`Audio bus -> ${audio.wavPath} (peak ${audio.peak.toFixed(3)})`);
  }

  // --- timeline ---
  const tl = createTimeline({ width: W, height: H, fps: FPS, name: "creator-movie", output: { crf: opts.crf ?? 21, preset: opts.preset || "medium" } });
  segs.forEach((seg, i) => {
    const accent = accentFor(seg.sl.index);
    const scene = seg.scene;
    const v = scene.visual || {};
    const beat = seg.beat || 0;
    const spec = { name: `${scene.id}_${i}`, duration: seg.duration, vignette: 3.2, grade: { contrast: 1.05, saturation: 1.08 } };
    if (seg.type === "frames") {
      spec.source = frameSource(workDir, seg.model);
      spec.padColor = "#05070d";
    } else {
      const bv = beatVisual(v, beat);
      spec.source = bgSource(bv);
      if (bv.kind === "gradient" || bv.kind === "mandelbrot" || bv.kind === "life" || bv.kind === "noise") {
        spec.animation = { type: BG_ANIM[(seg.sl.index + beat) % BG_ANIM.length], max: 1.14, rate: 0.0005 };
      }
      spec.filters = [`drawbox=x=0:y=0:w=iw:h=6:color=${accent}@0.9:t=fill`];
      spec.padColor = "#05070d";
    }
    tl.segments.push(spec);
  });
  tl.transitions = transitions;

  // global watermark (channel, bottom-right) + mod label (bottom-left)
  tl.overlays = [];
  tl.texts = [
    ...globalTexts,
    { text: CHANNEL, font: "trebuchet", size: 32, color: "#eef4ff", border: 2, borderColor: "black@0.55", shadow: true, shadowColor: "black@0.5", x: "right", y: "bottom", margin: 30, delay: 0.6, duration: 1e9, fadeIn: 0.8, fadeOut: 0.8 },
    { text: "creator mod", font: "consolas", size: 20, color: "#8fa2c8", x: "left", y: "bottom", margin: 28, delay: 0.8, duration: 1e9, fadeIn: 0.8, fadeOut: 0.8 },
  ];
  tl.grade = { contrast: 1.03, saturation: 1.05 };
  tl.vignette = 4;
  tl.fadeOut = 1.4;
  tl.audio = { file: audio.wavPath, fadeIn: 0.6, fadeOut: 1.6 };
  tl.subtitles = {
    path: srtPath,
    fontsdir: FONT_DIR,
    style: "FontName=Tahoma,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H96000000,BackColour=&H96000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=26,Alignment=2",
  };

  log(`Total ${total.toFixed(1)}s | support at ${supportStart ? supportStart.toFixed(1) : "?"}s | ${chapters.length} chapters`);
  log("Encoding video...");
  const res = await renderTimeline(tl, outPath, {
    workDir,
    onProgress: opts.onProgress ? (s) => opts.onProgress(s, total) : undefined,
    onLog: opts.onLog,
  });
  return { outPath, total: res.total, chapters, supportStart, cues: cues.length, timeline: tl, workDir };
}

function computeStarts(segs, transitions) {
  const starts = new Array(segs.length);
  starts[0] = 0;
  for (let i = 1; i < segs.length; i++) {
    const td = transitions[i - 1] ? transitions[i - 1].duration : 0;
    starts[i] = starts[i - 1] + segs[i - 1].duration - td;
  }
  return starts;
}
