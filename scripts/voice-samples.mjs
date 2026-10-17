// Synthesize the same Russian line with several edge-tts voices so we can A/B
// the narration voice. Writes tmp/voice-samples/<key>.mp3 + an index.html.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "tmp", "voice-samples");
const TTS = join(ROOT, "src", "movie", "tts.py");
const PYTHON = process.env.PYTHON || "python";

const TEXT =
  "Привет! Это тест голоса для нашего видео. Open Code делает трёхмерные модели и монтирует видео прямо из текста. " +
  "Слушай внимательно: этот голос читает субтитры и должен звучать живо и естественно.";

const CANDIDATES = [
  { key: "00-dmitry", label: "dmitry (ru, текущий)", voice: "ru-RU-DmitryNeural", rate: "+12%", pitch: "+0Hz" },
  { key: "01-svetlana", label: "svetlana (ru, текущий)", voice: "ru-RU-SvetlanaNeural", rate: "+12%", pitch: "+0Hz" },
  { key: "02-andrew", label: "andrew (мультиязычный, м)", voice: "en-US-AndrewMultilingualNeural", rate: "+6%", pitch: "+0Hz" },
  { key: "03-brian", label: "brian (мультиязычный, м, разговорный)", voice: "en-US-BrianMultilingualNeural", rate: "+6%", pitch: "+0Hz" },
  { key: "04-ava", label: "ava (мультиязычный, ж)", voice: "en-US-AvaMultilingualNeural", rate: "+6%", pitch: "+0Hz" },
  { key: "05-emma", label: "emma (мультиязычный, ж, бодрый)", voice: "en-US-EmmaMultilingualNeural", rate: "+6%", pitch: "+0Hz" },
  { key: "06-seraphina", label: "seraphina (мультиязычный, ж, de)", voice: "de-DE-SeraphinaMultilingualNeural", rate: "+6%", pitch: "+0Hz" },
  { key: "07-vivienne", label: "vivienne (мультиязычный, ж, fr)", voice: "fr-FR-VivienneMultilingualNeural", rate: "+6%", pitch: "+0Hz" },
];

function runPython(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => reject(e));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-800)))));
  });
}

mkdirSync(OUT, { recursive: true });

for (const c of CANDIDATES) {
  const req = { text: TEXT, voice: c.voice, rate: c.rate, pitch: c.pitch, mp3: join(OUT, `${c.key}.mp3`), json: join(OUT, `${c.key}.words.json`), boundary: "WordBoundary" };
  const reqPath = join(OUT, `${c.key}.req.json`);
  writeFileSync(reqPath, JSON.stringify(req), "utf8");
  try {
    await runPython([TTS, reqPath]);
    console.log("ok", c.key);
  } catch (e) {
    console.log("FAIL", c.key, e.message);
  }
  await new Promise((r) => setTimeout(r, 300));
}

const rows = CANDIDATES.map((c) =>
  `<div class="row"><div class="label">${c.label}</div><audio controls preload="none" src="${c.key}.mp3"></audio></div>`
).join("\n");

writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Голоса для озвучки</title>
<style>
 body{background:#0d1117;color:#e6edf3;font-family:Tahoma,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px}
 h1{font-size:22px}
 .row{display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid #21262d}
 .label{width:320px;font-size:14px;color:#9fb4cc}
 audio{height:36px}
</style></head><body>
<h1>Выбор голоса озвучки</h1>
<p style="color:#8b98a5;font-size:14px">Послушай и скажи, какой голос оставить (или два — мужской + женский).</p>
${rows}
</body></html>`,
  "utf8"
);
console.log("\nSample page:", join(OUT, "index.html"));
