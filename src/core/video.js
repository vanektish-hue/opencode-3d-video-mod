// Video engine: a declarative timeline compiled into a single ffmpeg filter
// graph. Supports xfade transitions, per-segment and global drawtext (many
// fonts, animated), image overlays, motion blur (tmix), color grading,
// vignette, fades, and synthesized audio (tones, chords, melodies).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { runFFmpeg } from "./ffmpeg.js";

export const FONT_DIR = process.env.WINDIR ? join(process.env.WINDIR, "Fonts") : "C:/Windows/Fonts";

export const FONT_ALIASES = {
  arial: "arial.ttf",
  arialBold: "arialbd.ttf",
  arialBlack: "ariblk.ttf",
  calibri: "calibri.ttf",
  calibriBold: "calibrib.ttf",
  georgia: "georgia.ttf",
  georgiaBold: "georgiab.ttf",
  impact: "impact.ttf",
  bahnschrift: "bahnschrift.ttf",
  consolas: "consola.ttf",
  mono: "consola.ttf",
  comic: "comic.ttf",
  gabriola: "Gabriola.ttf",
  inkfree: "Inkfree.ttf",
  segoe: "segoeui.ttf",
  segoeSemibold: "seguisb.ttf",
  times: "times.ttf",
  timesBold: "timesbd.ttf",
  verdana: "verdana.ttf",
  verdanaBold: "verdanab.ttf",
  tahoma: "tahoma.ttf",
  trebuchet: "trebuc.ttf",
  courier: "cour.ttf",
};

export function resolveFont(font) {
  if (!font) return join(FONT_DIR, "arial.ttf");
  if (font.includes("/") || font.includes("\\") || /\.(ttf|otf|ttc)$/i.test(font)) return font;
  const file = FONT_ALIASES[font] || `${font}.ttf`;
  return join(FONT_DIR, file);
}

/** Escape a value for use inside an ffmpeg filter graph. */
export function esc(value) {
  return String(value).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function createTimeline(opts = {}) {
  return {
    name: opts.name || "timeline",
    width: opts.width || 1280,
    height: opts.height || 720,
    fps: opts.fps || 30,
    segments: [],
    transitions: [],
    overlays: [],
    texts: [],
    grade: null,
    vignette: 0,
    fadeOut: 0,
    audio: null,
    output: { crf: 20, preset: "medium", ...(opts.output || {}) },
  };
}

let LABEL = 0;
const nextLabel = () => `l${LABEL++}`;
const num = (v, fallback = 0) => (typeof v === "number" ? v : v == null ? fallback : Number(v));

function xyExpr(v, axis, sizeRef, margin = 40) {
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    switch (v) {
      case "center": return `(${axis === "x" ? "w" : "h"}-${sizeRef})/2`;
      case "left": return String(margin);
      case "right": return `w-${sizeRef}-${margin}`;
      case "top": return String(margin);
      case "bottom": return `h-${sizeRef}-${margin}`;
      default: return v;
    }
  }
  return String(margin);
}

/** Position an image overlay. The main video size is W/H, the overlay input
 *  size is overlay_w/overlay_h (unlike drawtext where w/h are the video). */
function overlayPos(v, axis, sizeRef, margin = 40) {
  const main = axis === "x" ? "W" : "H";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    switch (v) {
      case "center": return `(${main}-${sizeRef})/2`;
      case "left":
      case "top": return String(margin);
      case "right":
      case "bottom": return `${main}-${sizeRef}-${margin}`;
      default: return v;
    }
  }
  return String(margin);
}

function alphaExpr(spec) {
  const delay = num(spec.delay, 0);
  const dur = spec.duration == null ? 1e9 : num(spec.duration, 1e9);
  const fi = num(spec.fadeIn, 0.45);
  const fo = num(spec.fadeOut, 0.45);
  const start = delay;
  const end = dur === 1e9 ? "1e9" : String(delay + dur);
  return (
    `if(lt(t,${start}),0,` +
    `if(lt(t,${start + fi}),((t-${start})/${fi}),` +
    `if(lt(t,${end - fo}),1,` +
    `if(lt(t,${end}),((${end}-t)/${fo}),0))))`
  );
}

/** Burn styled subtitles from an SRT/ASS file using libass. */
export function subtitlesFilter(sub) {
  const parts = [`filename='${esc(sub.path)}'`];
  if (sub.fontsdir) parts.push(`fontsdir='${esc(sub.fontsdir)}'`);
  if (sub.style) parts.push(`force_style='${sub.style}'`);
  if (sub.charenc) parts.push(`charenc=${sub.charenc}`);
  return `subtitles=${parts.join(":")}`;
}

export function drawTextFilter(spec, textFile) {
  const parts = [];
  parts.push(`textfile='${esc(textFile)}'`);
  parts.push(`fontfile='${esc(resolveFont(spec.font))}'`);
  parts.push(`fontsize=${num(spec.size, 64)}`);
  parts.push(`fontcolor=${spec.color || "white"}`);
  const baseX = xyExpr(spec.x ?? "center", "x", "text_w", num(spec.margin, 60));
  const baseY = xyExpr(spec.y ?? "center", "y", "text_h", num(spec.margin, 60));
  const delay = num(spec.delay, 0);
  const inDur = num(spec.fadeIn, 0.45);
  let x = baseX;
  let y = baseY;
  if (spec.animation === "slideUp") y = `${baseY}+${num(spec.slide, 70)}*max(0\\,1-(t-${delay})/${inDur})`;
  if (spec.animation === "slideDown") y = `${baseY}-${num(spec.slide, 70)}*max(0\\,1-(t-${delay})/${inDur})`;
  if (spec.animation === "slideLeft") x = `${baseX}+${num(spec.slide, 120)}*max(0\\,1-(t-${delay})/${inDur})`;
  if (spec.animation === "slideRight") x = `${baseX}-${num(spec.slide, 120)}*max(0\\,1-(t-${delay})/${inDur})`;
  parts.push(`x=${x}`);
  parts.push(`y=${y}`);
  if (spec.box) {
    parts.push("box=1");
    parts.push(`boxcolor=${spec.boxColor || "black@0.45"}`);
    parts.push(`boxborderw=${num(spec.boxBorder, 18)}`);
  }
  if (spec.border) {
    parts.push(`borderw=${num(spec.border, 3)}`);
    parts.push(`bordercolor=${spec.borderColor || "black"}`);
  }
  if (spec.shadow) {
    parts.push(`shadowcolor=${spec.shadowColor || "black@0.6"}`);
    parts.push(`shadowx=${num(spec.shadowX, 3)}`);
    parts.push(`shadowy=${num(spec.shadowY, 3)}`);
  }
  if (spec.alpha !== false) parts.push(`alpha='${alphaExpr(spec)}'`);
  if (spec.lineSpacing) parts.push(`line_spacing=${num(spec.lineSpacing)}`);
  if (spec.enable) parts.push(`enable='${spec.enable}'`);
  return `drawtext=${parts.join(":")}`;
}

function buildTextFilters(texts, workDir, counter) {
  const filters = [];
  for (const spec of texts || []) {
    if (spec.animation === "typewriter") {
      const delay = num(spec.delay, 0);
      const cd = num(spec.charDelay, 0.06);
      const full = String(spec.text ?? "");
      for (let k = 0; k < full.length; k++) {
        const file = join(workDir, `text_${counter.value}.txt`);
        writeFileSync(file, full.slice(0, k + 1), "utf8");
        counter.value += 1;
        const start = delay + k * cd;
        filters.push(
          drawTextFilter(
            { ...spec, animation: spec.animation2 || "fade", delay: start, duration: 1e9, fadeIn: 0.001, fadeOut: 0.001, enable: `between(t,${start.toFixed(3)},${(start + cd + 0.002).toFixed(3)})` },
            file,
          ),
        );
      }
    } else {
      const file = join(workDir, `text_${counter.value}.txt`);
      writeFileSync(file, String(spec.text ?? ""), "utf8");
      counter.value += 1;
      filters.push(drawTextFilter(spec, file));
    }
  }
  return filters;
}

function buildGrade(grade) {
  if (!grade) return [];
  const eq = [];
  if (grade.brightness != null) eq.push(`brightness=${grade.brightness}`);
  if (grade.contrast != null) eq.push(`contrast=${grade.contrast}`);
  if (grade.saturation != null) eq.push(`saturation=${grade.saturation}`);
  if (grade.gamma != null) eq.push(`gamma=${grade.gamma}`);
  const filters = [];
  if (eq.length) filters.push(`eq=${eq.join(":")}`);
  if (grade.hue != null) filters.push(`hue=h=${grade.hue}`);
  if (grade.temperature != null) filters.push(`colorbalance=rs=${grade.temperature}:bs=${-grade.temperature}`);
  return filters;
}

function buildAnimation(anim, ctx) {
  if (!anim) return [];
  const { width, height, fps } = ctx;
  switch (anim.type) {
    case "zoomIn":
      return [`zoompan=z='min(1+${num(anim.rate, 0.0009)}*on,${num(anim.max, 1.3)})':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`];
    case "zoomOut":
      return [`zoompan=z='max(${num(anim.max, 1.3)}-${num(anim.rate, 0.0009)}*on,1)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`];
    case "panRight":
      return [`zoompan=z='${num(anim.zoom, 1.25)}':d=1:x='(iw-iw/zoom)*on/${Math.max(1, Math.round(num(anim.frames, 120)))}':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`];
    case "rotate":
      return [`rotate=a='${num(anim.speed, 0.25)}*t':c=${anim.fill || "black@0"}:ow=${width}:oh=${height}`];
    case "floatY": {
      const h = num(anim.height, height);
      return [`crop=${width}:${h}:0:'(ih-${h})/2 + ${num(anim.amplitude, 20)}*sin(2*PI*t/${num(anim.period, 3)})'`];
    }
    default:
      return [];
  }
}

function sourceInputArgs(source, ctx) {
  const { width, height, fps, duration } = ctx;
  const s = source || { type: "color", color: "#101319" };
  const d = duration.toFixed(3);
  const lavfi = (expr) => ({ args: ["-t", d, "-f", "lavfi", "-i", expr], pre: [] });
  switch (s.type) {
    case "frames":
      return { args: ["-framerate", String(s.fps || fps), "-start_number", String(s.start ?? 1), "-t", d, "-i", s.pattern], pre: [] };
    case "video":
      return { args: ["-i", s.path], pre: [`trim=duration=${d}`, "setpts=PTS-STARTPTS"] };
    case "image":
      return { args: ["-loop", "1", "-t", d, "-i", s.path], pre: [] };
    case "color":
      return lavfi(`color=c=${s.color || "black"}:s=${width}x${height}:r=${fps}`);
    case "gradient":
      return lavfi(`gradients=s=${width}x${height}:c0=${s.colors?.[0] || "#1b2a6b"}:c1=${s.colors?.[1] || "#7a1f6b"}:x0=0:y0=0:x1=${width}:y1=${height}:speed=${num(s.speed, 0.02)}:r=${fps}`);
    case "testsrc":
      return lavfi(`testsrc2=s=${width}x${height}:r=${fps}`);
    case "bars":
      return lavfi(`smptebars=s=${width}x${height}:r=${fps}`);
    case "life":
      return lavfi(`life=s=${width}x${height}:r=${fps}:mold=10:rate=${num(s.rate, 12)}:ratio=${num(s.ratio, 0.12)}:seed=${num(s.seed, 42)}`);
    case "mandelbrot":
      return lavfi(`mandelbrot=s=${width}x${height}:r=${fps}:maxiter=${num(s.iter, 200)}`);
    case "noise":
      return lavfi(`noise=s=${width}x${height}:r=${fps}:allf=t:c0_seed=${num(s.seed, 7)}`);
    default:
      throw new Error(`Unknown source type: ${s.type}`);
  }
}

/**
 * Compile a timeline into ffmpeg arguments (input + filter_complex + map + codecs).
 * `workDir` holds generated text files.
 */
export function buildFFmpegArgs(timeline, workDir) {
  mkdirSync(workDir, { recursive: true });
  LABEL = 0;
  const counter = { value: 0 };
  const inputs = [];
  const graph = [];
  const W = timeline.width, H = timeline.height, FPS = timeline.fps;

  const segs = [];
  let inputIndex = 0;

  timeline.segments.forEach((seg) => {
    const dur = num(seg.duration, 2);
    const ctx = { width: W, height: H, fps: FPS, duration: dur };
    const src = sourceInputArgs(seg.source, ctx);
    const thisIndex = inputIndex;
    inputs.push(...src.args);
    inputIndex += 1;

    const chain = [...src.pre];
    chain.push(`fps=${FPS}`);
    chain.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
    chain.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${seg.padColor || "black"}`);
    chain.push("setsar=1");
    if (seg.filters) chain.push(...seg.filters);
    chain.push(...buildAnimation(seg.animation, ctx));
    if (seg.motionBlur) {
      const frames = Math.max(2, Math.round(num(seg.motionBlur, 4)));
      chain.push(`tmix=frames=${frames}:weights='${Array(frames).fill(1).join(" ")}'`);
    }
    chain.push(...buildGrade(seg.grade));
    if (seg.vignette) chain.push(`vignette=PI/${num(seg.vignette, 4)}`);
    if (seg.sharpen) chain.push(`unsharp=5:5:${num(seg.sharpen, 0.8)}`);
    if (seg.blur) chain.push(`gblur=sigma=${num(seg.blur, 6)}`);
    if (seg.flip) chain.push(seg.flip === "h" ? "hflip" : "vflip");
    if (seg.text) chain.push(...buildTextFilters(seg.text, workDir, counter));
    if (seg.fade) {
      if (seg.fade.in) chain.push(`fade=t=in:st=0:d=${num(seg.fade.in)}`);
      if (seg.fade.out) chain.push(`fade=t=out:st=${(dur - num(seg.fade.out)).toFixed(3)}:d=${num(seg.fade.out)}`);
    }
    chain.push("format=yuv420p");

    const out = `[${nextLabel()}]`;
    graph.push(`[${thisIndex}:v]${chain.join(",")}${out}`);
    segs.push({ out, dur });
  });

  // transitions
  let current = segs[0].out;
  let currentDur = segs[0].dur;
  for (let i = 1; i < segs.length; i++) {
    const t = timeline.transitions[i - 1] || { type: "fade", duration: 0.6 };
    const td = num(t.duration, 0.6);
    const offset = Math.max(0, currentDur - td);
    const out = `[${nextLabel()}]`;
    graph.push(`${current}${segs[i].out}xfade=transition=${t.type || "fade"}:duration=${td}:offset=${offset.toFixed(3)}${out}`);
    current = out;
    currentDur = currentDur + segs[i].dur - td;
  }
  const total = currentDur;

  // global image overlays
  (timeline.overlays || []).forEach((ov, k) => {
    const thisIndex = inputIndex;
    inputs.push("-loop", "1", "-t", total.toFixed(3), "-i", ov.path);
    inputIndex += 1;
    const scale = ov.w ? `,scale=${num(ov.w)}:${num(ov.h, -1)}` : "";
    const alpha = ov.opacity != null ? `,colorchannelmixer=aa=${num(ov.opacity, 1)}` : "";
    const fadeIn = num(ov.fadeIn, 0.3);
    const fadeOut = num(ov.fadeOut, 0.3);
    const anim = ov.animate === false ? "" : `,fade=t=in:st=${num(ov.delay, 0)}:d=${fadeIn}:alpha=1,fade=t=out:st=${(num(ov.delay, 0) + num(ov.duration, total) - fadeOut).toFixed(3)}:d=${fadeOut}:alpha=1`;
    graph.push(`[${thisIndex}:v]format=rgba${scale}${alpha}${anim}[ov${k}]`);
    const x = overlayPos(ov.x ?? "left", "x", "overlay_w", num(ov.margin, 40));
    const y = overlayPos(ov.y ?? "top", "y", "overlay_h", num(ov.margin, 40));
    const enable = ov.delay != null || ov.duration != null ? `:enable='between(t,${num(ov.delay, 0)},${(num(ov.delay, 0) + num(ov.duration, total)).toFixed(3)})'` : "";
    const out = `[${nextLabel()}]`;
    graph.push(`${current}[ov${k}]overlay=x=${x}:y=${y}${enable}:format=auto${out}`);
    current = out;
  });

  // global text + grade + vignette + fade
  const globalChain = [];
  globalChain.push(...buildTextFilters(timeline.texts, workDir, counter));
  globalChain.push(...buildGrade(timeline.grade));
  if (timeline.subtitles && timeline.subtitles.path) globalChain.push(subtitlesFilter(timeline.subtitles));
  if (timeline.vignette) globalChain.push(`vignette=PI/${num(timeline.vignette, 4)}`);
  if (timeline.fadeOut) globalChain.push(`fade=t=out:st=${(total - num(timeline.fadeOut)).toFixed(3)}:d=${num(timeline.fadeOut)}`);
  globalChain.push("format=yuv420p");
  {
    const out = `[${nextLabel()}]`;
    graph.push(`${current}${globalChain.join(",")}${out}`);
    current = out;
  }

  // audio
  let audioLabel = null;
  const audioGraphParts = [];
  if (timeline.audio && timeline.audio.file) {
    // Pre-mixed audio bus (narration + music + sfx) produced by the movie builder.
    const idx = inputIndex;
    inputs.push("-i", timeline.audio.file);
    inputIndex += 1;
    const af = ["aformat=sample_rates=48000:channel_layouts=stereo", `atrim=0:${total.toFixed(3)}`, "asetpts=PTS-STARTPTS", "apad"];
    if (timeline.audio.fadeIn) af.push(`afade=t=in:d=${num(timeline.audio.fadeIn)}`);
    if (timeline.audio.fadeOut) af.push(`afade=t=out:st=${(total - num(timeline.audio.fadeOut)).toFixed(3)}:d=${num(timeline.audio.fadeOut)}`);
    af.push("loudnorm=I=-16:TP=-1.5:LRA=11");
    const out = "[aout]";
    audioGraphParts.push(`[${idx}:a]${af.join(",")}${out}`);
    audioLabel = out;
  } else if (timeline.audio) {
    const trackLabels = [];
    (timeline.audio.tracks || []).forEach((tr, ti) => {
      const noteLabels = [];
      const vol = num(tr.volume, 1);
      const addTone = (freq, start, dur) => {
        const s = Math.max(0, start);
        const dd = Math.max(0.05, Math.min(dur, total - s));
        const idx = inputIndex;
        inputs.push("-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${dd.toFixed(3)}:sample_rate=48000`);
        inputIndex += 1;
        const label = `[a${ti}_${noteLabels.length}]`;
        const delay = Math.round(s * 1000);
        audioGraphParts.push(`[${idx}:a]adelay=${delay}|${delay},volume=${vol}${label}`);
        noteLabels.push(label);
      };
      if (tr.type === "sine" || tr.type === "tone") {
        addTone(num(tr.freq, 440), num(tr.start, 0), num(tr.duration, total));
      } else if (tr.type === "chord") {
        (tr.freqs || [220, 277, 330]).forEach((f) => addTone(f, num(tr.start, 0), num(tr.duration, total)));
      } else if (tr.type === "melody") {
        for (const note of tr.notes || []) addTone(num(note.freq, 440), num(note.start, 0), num(note.duration, 0.3));
      } else if (tr.type === "noise") {
        const idx = inputIndex;
        inputs.push("-f", "lavfi", "-i", `anoisesrc=d=${total.toFixed(3)}:c=pink:sample_rate=48000`);
        inputIndex += 1;
        const label = `[a${ti}_0]`;
        audioGraphParts.push(`[${idx}:a]volume=${num(tr.volume, 0.2)}${label}`);
        noteLabels.push(label);
      }
      if (noteLabels.length === 1) trackLabels.push(noteLabels[0]);
      else if (noteLabels.length > 1) {
        const mixLabel = `[at${ti}]`;
        audioGraphParts.push(`${noteLabels.join("")}amix=inputs=${noteLabels.length}:duration=longest:normalize=0${mixLabel}`);
        trackLabels.push(mixLabel);
      }
    });
    if (trackLabels.length) {
      let label = trackLabels[0];
      if (trackLabels.length > 1) {
        const mixLabel = "[amix]";
        audioGraphParts.push(`${trackLabels.join("")}amix=inputs=${trackLabels.length}:duration=longest:normalize=0${mixLabel}`);
        label = mixLabel;
      }
      const af = [];
      if (timeline.audio.fadeIn) af.push(`afade=t=in:d=${num(timeline.audio.fadeIn)}`);
      if (timeline.audio.fadeOut) af.push(`afade=t=out:st=${(total - num(timeline.audio.fadeOut)).toFixed(3)}:d=${num(timeline.audio.fadeOut)}`);
      af.push("volume=0.7");
      const out = "[aout]";
      audioGraphParts.push(`${label}${af.join(",")}${out}`);
      audioLabel = out;
    }
  }

  const filterComplex = [...graph, ...audioGraphParts].join(";");
  const args = [
    "-y", "-nostdin", "-hide_banner", "-loglevel", "warning", "-stats",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", current,
  ];
  if (audioLabel) args.push("-map", audioLabel, "-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(
    "-c:v", "libx264",
    "-preset", timeline.output.preset || "medium",
    "-crf", String(timeline.output.crf ?? 20),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-t", total.toFixed(3),
  );

  return { args, filterComplex, total, finalLabel: current, inputCount: inputIndex };
}

/** Render a timeline to a file. Returns metadata (duration, path, args). */
export async function renderTimeline(timeline, outPath, opts = {}) {
  const workDir = opts.workDir || join(process.cwd(), "tmp", `tl_${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  const built = buildFFmpegArgs(timeline, workDir);
  if (opts.dryRun) return { ...built, dryRun: true };
  let args = built.args;
  // Windows limits the process command line to ~32k chars; a movie-sized
  // filter graph blows past it, so hand ffmpeg the graph via a script file.
  if (built.filterComplex && built.filterComplex.length > 4000) {
    const fcPath = join(workDir, `filter_${Date.now()}.txt`);
    writeFileSync(fcPath, built.filterComplex, "utf8");
    const idx = args.indexOf("-filter_complex");
    if (idx >= 0) {
      args = args.slice();
      args[idx] = "-filter_complex_script";
      args[idx + 1] = fcPath;
    }
  }
  await runFFmpeg([...args, outPath], { onLog: opts.onLog, onProgress: opts.onProgress });
  return { ...built, outPath, args };
}
