// Verify a rendered movie: duration/codecs, ad position, caption count, frames.
import { join } from "node:path";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { runFFmpeg, ffprobePath } from "../src/core/ffmpeg.js";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dirname, "..");
const video = process.argv[2] || join(root, "exports", "movie.mp4");

const probe = spawnSync(ffprobePath(), [
  "-v", "error",
  "-show_entries", "format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate",
  "-of", "json", video,
], { encoding: "utf8" });
const info = JSON.parse(probe.stdout);
const dur = parseFloat(info.format.duration);
const v = info.streams.find((s) => s.codec_type === "video");
const a = info.streams.find((s) => s.codec_type === "audio");
console.log(`file:     ${video}`);
console.log(`duration: ${dur.toFixed(2)}s (${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, "0")})`);
console.log(`video:    ${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate}`);
console.log(`audio:    ${a ? a.codec_name : "none"}`);
console.log(`size:     ${(parseInt(info.format.size) / 1048576).toFixed(1)} MB  ${(parseInt(info.format.bit_rate) / 1000).toFixed(0)} kbps`);

const srt = join(root, "exports", "movie.srt");
if (existsSync(srt)) {
  const cues = readFileSync(srt, "utf8").split(/\n\s*\n/).filter((b) => b.trim()).length;
  console.log(`captions: ${cues} cues (exports/movie.srt)`);
}

const dir = join(root, "tmp", "movie", "verify");
mkdirSync(dir, { recursive: true });
const times = [5, 60, 182, 300, 480, 590];
for (const t of times) {
  await runFFmpeg(["-y", "-ss", String(t), "-i", video, "-frames:v", "1", "-update", "1", join(dir, `t${t}.png`)]);
}
console.log(`frames:   ${times.map((t) => `t${t}.png`).join(", ")} -> ${dir}`);
