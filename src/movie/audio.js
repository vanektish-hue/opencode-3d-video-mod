// Assemble the final audio bus: neural narration + procedural music (ducked
// under the voice) + subtle sound effects, written as one WAV the video engine
// consumes as a single input.
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { runFFmpeg } from "../core/ffmpeg.js";
import { writeWav } from "./wav.js";
import { synthMusic, synthWhoosh, synthDing, synthRiser } from "./music.js";

const SR = 48000;

/** Decode an audio file to mono Float32 @ 48k using ffmpeg. */
async function decodeMono(path, tmpDir) {
  const raw = join(tmpDir, `${basename(path)}.f32`);
  if (!existsSync(raw)) {
    await runFFmpeg(["-y", "-i", path, "-ac", "1", "-ar", String(SR), "-f", "f32le", raw]);
  }
  const buf = readFileSync(raw);
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  return new Float32Array(copy);
}

function mixInto(dst, src, start, gain = 1) {
  const i0 = Math.max(0, Math.floor(start * SR));
  const n = Math.min(src.length, dst.length - i0);
  for (let i = 0; i < n; i++) dst[i0 + i] += src[i] * gain;
}

/**
 * Build the audio bus.
 * layout: [{ id, start, duration, mp3, isAd, chapter }] in absolute seconds.
 * returns { wavPath, peak }
 */
export async function buildAudioBus(layout, total, workDir, opts = {}) {
  const N = Math.ceil(total * SR) + SR;
  const voice = new Float32Array(N);

  // --- voice bus ---
  for (const sc of layout) {
    if (!sc.mp3) continue;
    const mono = await decodeMono(sc.mp3, workDir);
    // normalize each chunk a touch so voices match
    let peak = 0;
    for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
    const g = peak > 0 ? Math.min(1.6, 0.6 / peak) : 1;
    mixInto(voice, mono, sc.start, g);
  }

  // --- music bed ---
  const music = synthMusic(total, SR, { intensity: opts.musicIntensity ?? 1 });
  const duck = computeDuck(voice, N);

  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const musicGain = opts.musicGain ?? 0.5;
  for (let i = 0; i < N; i++) {
    const g = duck[i] * musicGain;
    L[i] = voice[i] * 0.94 + music.left[i] * g;
    R[i] = voice[i] * 0.94 + music.right[i] * g;
  }

  // --- sound effects ---
  const whoosh = synthWhoosh(SR);
  const ding = synthDing(SR);
  const riser = synthRiser(SR);
  layout.forEach((sc, i) => {
    if (i > 0) {
      mixInto(L, whoosh, sc.start - 0.28, 0.5);
      mixInto(R, whoosh, sc.start - 0.22, 0.5);
    }
    if (sc.chapterStart && !sc.isAd) {
      mixInto(L, ding, sc.start + 0.05, 0.35);
      mixInto(R, ding, sc.start + 0.05, 0.35);
    }
    if (sc.isAd) {
      mixInto(L, riser, sc.start - 1.5, 0.45);
      mixInto(R, riser, sc.start - 1.4, 0.45);
    }
  });

  // gentle outro swell: fade everything at the very end handled by the video engine.

  // normalize to headroom before the video engine's loudnorm
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = peak > 0 ? Math.min(1, 0.92 / peak) : 1;
  for (let i = 0; i < N; i++) { L[i] *= k; R[i] *= k; }

  const wavPath = join(workDir, "audio_bus.wav");
  writeWav(wavPath, [L, R], SR);
  return { wavPath, peak: peak * k };
}

/** Per-sample music gain that dips while narration is present. */
function computeDuck(voice, N) {
  const win = Math.floor(0.02 * SR);
  const frames = Math.ceil(N / win);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const i0 = f * win;
    const i1 = Math.min(N, i0 + win);
    for (let i = i0; i < i1; i++) s += voice[i] * voice[i];
    env[f] = Math.sqrt(s / Math.max(1, i1 - i0));
  }
  // target gain: 0.22 when speech, 1 otherwise; smooth with attack/release
  const attack = 0.06, release = 0.9; // seconds
  const g = new Float32Array(frames);
  let cur = 1;
  const thr = 0.012;
  for (let f = 0; f < frames; f++) {
    const target = env[f] > thr ? 0.18 : 1;
    const coef = target < cur ? Math.exp(-(win / SR) / attack) : Math.exp(-(win / SR) / release);
    cur = target + (cur - target) * coef;
    g[f] = cur;
  }
  // expand to per-sample
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const f = Math.min(frames - 1, Math.floor(i / win));
    const fn = Math.min(frames - 1, f + 1);
    const frac = (i - f * win) / win;
    out[i] = g[f] * (1 - frac) + g[fn] * frac;
  }
  return out;
}
