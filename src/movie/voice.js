// Neural voiceover via edge-tts (Microsoft Edge voices). Produces per-scene
// mp3 audio plus word-level timings used to build captions.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { probe } from "../core/ffmpeg.js";

const PYTHON = process.env.PYTHON || "python";
const TTS_SCRIPT = join(import.meta.dirname, "tts.py");

// Voice palette — two natural multilingual neural voices (edge-tts). The aliases
// keep the script's male/female alternation; override via env when A/B testing.
const MALE = process.env.MOVIE_VOICE_MALE || "en-US-AndrewMultilingualNeural";
const FEMALE = process.env.MOVIE_VOICE_FEMALE || "en-US-AvaMultilingualNeural";
const RATE = process.env.MOVIE_RATE || "+20%";
const VOICES = {
  dmitry: { voice: MALE, rate: RATE, pitch: "+0Hz" },
  svetlana: { voice: FEMALE, rate: RATE, pitch: "+0Hz" },
  hype: { voice: MALE, rate: "+30%", pitch: "+0Hz" },
  calm: { voice: FEMALE, rate: "+10%", pitch: "+0Hz" },
};

function runPython(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON, args, { windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => reject(new Error(`python spawn failed (${e.message}); is Python + edge-tts installed?`)));
    p.on("close", (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`tts.py exit ${code}\n${err.slice(-1500)}`))));
  });
}

/**
 * Synthesize one scene. Returns { mp3, words, duration }.
 * Results are cached by a hash of the request so re-runs are fast.
 */
export async function synthScene(scene, outDir) {
  mkdirSync(outDir, { recursive: true });
  const v = VOICES[scene.voice] || VOICES.dmitry;
  const key = createHash("sha1").update([scene.id, v.voice, v.rate, v.pitch, scene.text].join("|")).digest("hex").slice(0, 10);
  const mp3 = join(outDir, `${scene.id}_${key}.mp3`);
  const json = join(outDir, `${scene.id}_${key}.words.json`);

  let needsSynth = false;
  if (!existsSync(mp3) || !existsSync(json)) {
    needsSynth = true;
  } else {
    try {
      if (statSync(mp3).size < 4000) needsSynth = true;
      const cached = JSON.parse(readFileSync(json, "utf8"));
      if (!Array.isArray(cached) || cached.length === 0) needsSynth = true;
    } catch {
      needsSynth = true;
    }
  }
  if (needsSynth) {
    const req = {
      text: scene.text,
      voice: v.voice,
      rate: v.rate,
      pitch: v.pitch,
      mp3,
      json,
    };
    const reqPath = join(outDir, `${scene.id}_${key}.req.json`);
    writeFileSync(reqPath, JSON.stringify(req), "utf8");
    await runPython([TTS_SCRIPT, reqPath]);
  }

  let words = [];
  try {
    words = JSON.parse(readFileSync(json, "utf8"));
  } catch {
    words = [];
  }
  const info = await probe(mp3);
  const duration = parseFloat(info.format.duration) || (words.length ? words[words.length - 1].t + words[words.length - 1].d : 0);
  return { id: scene.id, mp3, words, duration, size: statSync(mp3).size };
}

/** Synthesize many scenes (sequential, with extra Node-level retries). */
export async function synthAll(scenes, outDir, onProgress) {
  const out = [];
  for (const scene of scenes) {
    let r = null;
    let lastErr = null;
    for (let round = 0; round < 3 && !r; round++) {
      try {
        r = await synthScene(scene, outDir);
      } catch (e) {
        lastErr = e;
        await new Promise((res) => setTimeout(res, 2000 * (round + 1)));
      }
    }
    if (!r) throw new Error(`scene "${scene.id}" failed after retries: ${lastErr && lastErr.message}`);
    out.push(r);
    if (onProgress) onProgress(scene, r, out.length, scenes.length);
    await new Promise((res) => setTimeout(res, 350));
  }
  return out;
}

export function hasEdgeTts() {
  return new Promise((resolve) => {
    const p = spawn(PYTHON, ["-c", "import edge_tts; print('ok')"], { windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0 && out.includes("ok")));
  });
}
