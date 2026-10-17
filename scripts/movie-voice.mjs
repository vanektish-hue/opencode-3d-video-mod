// Synthesize the whole narration and report per-scene durations.
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { SCENES } from "../src/movie/script.js";
import { synthAll, hasEdgeTts } from "../src/movie/voice.js";

const base = join(import.meta.dirname, "..", "tmp", "movie");
const outDir = join(base, "voice");
mkdirSync(base, { recursive: true });

if (!(await hasEdgeTts())) {
  console.error("edge-tts not available (python -c 'import edge_tts' failed)");
  process.exit(1);
}

const narrationScenes = SCENES.filter((s) => s.text);
console.log(`Synthesizing ${narrationScenes.length} narration scenes...`);
const results = await synthAll(narrationScenes, outDir, (scene, r, i, n) => {
  console.log(`  [${i}/${n}] ${scene.id.padEnd(10)} ${r.duration.toFixed(2)}s  ${r.words.length} words`);
});

const total = results.reduce((a, r) => a + r.duration, 0);
const words = narrationScenes.reduce((a, s) => a + s.text.split(/\s+/).length, 0);
const report = {
  total,
  words,
  wps: words / total,
  scenes: results.map((r, i) => ({
    id: r.id,
    duration: r.duration,
    marks: r.words.length,
    voice: narrationScenes[i].voice,
    mp3: r.mp3,
  })),
};
writeFileSync(join(base, "narration.json"), JSON.stringify(report, null, 2), "utf8");
console.log(`\nNarration total: ${total.toFixed(1)}s (${(total / 60).toFixed(2)} min)`);
console.log(`Words: ${words}  (~${(words / total).toFixed(2)} words/sec)`);
console.log(`Report -> ${join(base, "narration.json")}`);
