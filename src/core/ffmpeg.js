// Locate and run ffmpeg / ffprobe (bundled static builds, system fallback).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let FFMPEG = null;
let FFPROBE = null;

export function ffmpegPath() {
  if (FFMPEG) return FFMPEG;
  try {
    FFMPEG = require("ffmpeg-static");
  } catch {
    FFMPEG = null;
  }
  if (!FFMPEG || !existsSync(FFMPEG)) FFMPEG = "ffmpeg";
  return FFMPEG;
}

export function ffprobePath() {
  if (FFPROBE) return FFPROBE;
  try {
    const mod = require("ffprobe-static");
    FFPROBE = typeof mod === "string" ? mod : mod.path;
  } catch {
    FFPROBE = null;
  }
  if (!FFPROBE || !existsSync(FFPROBE)) FFPROBE = "ffprobe";
  return FFPROBE;
}

/** Run ffmpeg. Returns { code, stderr, stdout }. */
export function runFFmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const bin = opts.bin || ffmpegPath();
    const proc = spawn(bin, args, { cwd: opts.cwd, windowsHide: true });
    let stderr = "";
    let stdout = "";
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      if (opts.onLog) opts.onLog(s);
      if (opts.onProgress) {
        const m = [...s.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
        if (m.length) {
          const last = m[m.length - 1];
          const seconds = (+last[1]) * 3600 + (+last[2]) * 60 + parseFloat(last[3]);
          opts.onProgress(seconds);
        }
      }
    });
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0 || opts.allowFail) resolve({ code, stderr, stdout });
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-4000)}`));
    });
  });
}

export async function probe(file) {
  const bin = ffprobePath();
  const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file];
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${err}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
  });
}
