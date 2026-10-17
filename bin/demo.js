#!/usr/bin/env node
// Render the demo showreel. Usage:
//   node bin/demo.js [outPath] [--fast]
import { renderShowreel } from "../src/demo/showreel.js";

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || "exports/showreel.mp4";
const fast = args.includes("--fast");

const opts = fast
  ? { width: 640, height: 360, fps: 12, duration3d: 1.5, samples: 1, aa: 1, clipWidth: 640, clipHeight: 360, workDir: "tmp/showreel_fast" }
  : { width: 1280, height: 720, fps: 24, duration3d: 4.2, samples: 4, aa: 1, clipWidth: 1280, clipHeight: 720, workDir: "tmp/showreel" };

console.log(`Rendering showreel (${fast ? "fast" : "full"}) -> ${out}`);
const t0 = Date.now();
const res = await renderShowreel(out, {
  ...opts,
  onClipProgress: (i, n) => { if (i % 10 === 0 || i === n) process.stdout.write(`\r  3D frames ${i}/${n}`); },
  onProgress: (s) => process.stdout.write(`\r  encode ${s.toFixed(1)}s`),
});
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`  video: ${res.outPath}`);
console.log(`  duration: ${res.duration.toFixed(2)}s`);
console.log(`  logo: ${res.assets.logoPath}`);
