// Export the narration script to docs/SCRIPT.md (readable, editable).
import { join } from "node:path";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { SCENES } from "../src/movie/script.js";

const root = join(import.meta.dirname, "..");
const workDir = join(root, "tmp", "movie");
const narrPath = join(workDir, "narration.json");

let durations = new Map();
if (existsSync(narrPath)) {
  const rep = JSON.parse(readFileSync(narrPath, "utf8"));
  for (const s of rep.scenes) durations.set(s.id, s.duration);
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const words = (t) => (t ? t.trim().split(/\s+/).length : 0);

let total = 0;
const lines = [
  "# Сценарий фильма «Как ИИ собрал это видео» — рассказ от лица нейросети",
  "",
  "Текст озвучки по сценам. Источник — `src/movie/script.js`; длительности — из `tmp/movie/narration.json`.",
  "",
  "| # | Сцена | Голос | Длит. | Слов |",
  "|---|-------|-------|-------|------|",
];
SCENES.forEach((s, i) => {
  const d = durations.get(s.id) || 0;
  total += d;
  lines.push(`| ${i + 1} | ${s.chapter || s.id} \`${s.id}\` | ${s.voice || "—"} | ${d ? mmss(d) : "—"} | ${words(s.text)} |`);
});
lines.push("", `**Всего речи:** ${mmss(total)} (${total.toFixed(1)} с, ${SCENES.reduce((n, s) => n + words(s.text), 0)} слов)`, "", "---", "");
SCENES.forEach((s, i) => {
  const d = durations.get(s.id) || 0;
  lines.push(`## ${i + 1}. ${s.chapter || s.id}`, "", `\`id: ${s.id}\` · голос: \`${s.voice || "—"}\` · ${d ? mmss(d) : "—"}${s.id === "support" ? " · **БЛОК ПОДДЕРЖКИ (boosty)**" : ""}`, "");
  lines.push(s.text ? s.text : "_(без текста — визуальная карточка)_", "");
});

mkdirSync(join(root, "docs"), { recursive: true });
const out = join(root, "docs", "SCRIPT.md");
writeFileSync(out, lines.join("\n"), "utf8");
console.log(`script -> ${out}  (${SCENES.length} scenes, ${total.toFixed(1)}s)`);
