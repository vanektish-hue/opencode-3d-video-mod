#!/usr/bin/env node
// Build the 10-minute "AI made this video" movie.
import { join, dirname } from "node:path";
import { copyFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { buildMovie } from "../src/movie/build.js";
import { runFFmpeg } from "../src/core/ffmpeg.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const root = join(import.meta.dirname, "..");
const workDir = join(root, "tmp", "movie");
const outPath = positional[0] ? positional[0] : join(root, "exports", "movie.mp4");

const log = (m) => console.log(m);

let lastPct = -5;
const onProgress = (sec, total = 630) => {
  const pct = Math.min(99, Math.floor((sec / total) * 100));
  if (pct >= lastPct + 5) {
    lastPct = pct;
    process.stdout.write(`  encode ${String(pct).padStart(2)}%  (${sec.toFixed(0)}s / ${total}s)\n`);
  }
};

try {
  const res = await buildMovie(outPath, {
    workDir,
    dryRun: flags.has("--dry"),
    reuseClips: flags.has("--reuse"),
    crf: flags.has("--fast") ? 24 : flags.has("--hq") ? 19 : 21,
    preset: flags.has("--fast") ? "veryfast" : "medium",
    log,
    onProgress,
  });

  if (res.dryRun) {
    console.log("\n=== DRY RUN LAYOUT ===");
    console.log(`total: ${res.total.toFixed(1)}s (${(res.total / 60).toFixed(2)} min)`);
    console.log(`support at: ${res.supportStart ? res.supportStart.toFixed(1) + "s (" + Math.floor(res.supportStart / 60) + ":" + String(Math.floor(res.supportStart % 60)).padStart(2, "0") + ")" : "n/a"}`);
    console.log(`segments: ${res.segmentCount}`);
    console.log("\nscenes:");
    for (const s of res.scenes) {
      console.log(`  ${String(s.id).padEnd(14)} start ${s.start.toFixed(1).padStart(6)}s  len ${s.total.toFixed(1).padStart(5)}s  parts ${s.parts}`);
    }
    console.log("\nchapters:");
    res.chapters.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${c.title.padEnd(22)} ${c.start.toFixed(1)}s`));
    process.exit(0);
  }

  console.log(`\nDone: ${res.outPath}`);
  console.log(`  duration: ${res.total.toFixed(1)}s`);
  console.log(`  support at: ${res.supportStart ? res.supportStart.toFixed(1) + "s" : "n/a"}`);
  console.log(`  captions: ${res.cues} cues`);
  console.log(`  chapters: ${res.chapters.length}`);

  // sidecar files for YouTube
  const srtSrc = join(workDir, "subs.srt");
  if (existsSync(srtSrc)) copyFileSync(srtSrc, join(root, "exports", "movie.srt"));
  const ts = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const chapters = res.chapters.map((c) => `${ts(Math.max(0, c.start))} ${c.title}`).join("\n");
  const desc = `Это видео — от 3D-моделей до монтажа, озвучки и субтитров — сделала нейросеть. Канал: miphik.

Весь ролик собран автономным агентом через мод Creator для OpenCode: ни одной программы для 3D или видеомонтажа — только код и инструменты. Рассказ ведётся от первого лица — от лица самой нейросети.

Что внутри:
• процедурная 3D-модель компьютерной мыши и ещё девять моделей (кружка, геймпад, наушники, телефон, домик, кости, робот, планета, ракета);
• собственный CPU-рендер без видеокарты и экспорт в glTF/OBJ;
• монтаж одним ffmpeg filter_complex: переходы, анимация текста, оверлеи, субтитры;
• нейросетевая озвучка (Microsoft Edge Neural) и процедурная музыка, синтезированная в коде.

Рекламы в видео нет. Но если ролик оказался полезен — автора можно поддержать на Boosty (ссылка ниже).

Проект: OpenCode + мод Creator (MCP-инструменты tools.creator.*).
Голос: нейросетевой TTS. Музыка и звуки: сгенерированы в коде.

Подпишись на канал miphik и напиши в комментариях, какую модель сделать следующей.

Главы:
${chapters}

#miphik #OpenCode #AI #3D #видеомонтаж #нейросети #ffmpeg`;
  writeFileSync(join(root, "exports", "movie.description.txt"), desc, "utf8");
  console.log(`  wrote: exports/movie.srt, exports/movie.description.txt`);

  // embed chapters into the mp4 (ffmetadata) via a fast stream copy
  if (!flags.has("--no-chapters") && res.chapters && res.chapters.length) {
    const lines = [";FFMETADATA1"];
    res.chapters.forEach((c, i) => {
      const start = Math.max(0, Math.round(c.start * 1000));
      const end = Math.round(((res.chapters[i + 1] ? res.chapters[i + 1].start : res.total) * 1000));
      lines.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${start}`, `END=${Math.max(start + 1, end)}`, `title=${c.title}`);
    });
    const metaPath = join(root, "exports", "movie.chapters.ffmeta");
    writeFileSync(metaPath, lines.join("\n") + "\n", "utf8");
    const tmpOut = join(root, "exports", "_movie_chapters.mp4");
    try {
      await runFFmpeg(["-y", "-i", res.outPath, "-i", metaPath, "-map_metadata", "1", "-map", "0", "-codec", "copy", "-movflags", "+faststart", tmpOut], { allowFail: true });
      if (existsSync(tmpOut)) {
        renameSync(tmpOut, res.outPath);
        console.log(`  wrote: exports/movie.chapters.ffmeta (embedded into mp4)`);
      }
    } catch (e) {
      console.log(`  (chapters embed skipped: ${e.message})`);
    }
  }
} catch (e) {
  console.error("FAILED:", e && e.stack ? e.stack : e);
  process.exit(1);
}
