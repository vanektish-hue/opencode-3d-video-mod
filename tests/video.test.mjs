// Video pipeline tests: filter-graph compilation and a real (small, fast) encode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTimeline, buildFFmpegArgs, renderTimeline, resolveFont } from "../src/core/video.js";
import { probe } from "../src/core/ffmpeg.js";

function tmpDir(tag) {
  return mkdtempSync(join(tmpdir(), `creator-${tag}-`));
}

test("buildFFmpegArgs compiles clips + transition into a filter graph", () => {
  const tl = createTimeline({ width: 160, height: 90, fps: 12 });
  tl.segments.push({ name: "a", source: { type: "color", color: "#203060" }, duration: 2 });
  tl.segments.push({ name: "b", source: { type: "gradient", colors: ["#301020", "#102030"] }, duration: 2 });
  tl.transitions.push({ type: "fade", duration: 0.5 });
  const built = buildFFmpegArgs(tl, tmpDir("graph"));
  assert.ok(Array.isArray(built.args));
  assert.ok(built.args.includes("-filter_complex"), "has filter_complex");
  assert.equal(built.inputCount, 2, "two inputs");
  assert.ok(built.filterComplex.includes("xfade=transition=fade"), "has xfade");
  assert.ok(Math.abs(built.total - 3.5) < 0.02, `total ~3.5s, got ${built.total}`);
});

test("drawtext fonts resolve to real files", () => {
  for (const f of ["arial", "georgia", "impact", "consolas", "bahnschrift"]) {
    const p = resolveFont(f);
    assert.ok(p && existsSync(p), `font '${f}' resolves to an existing file (${p})`);
  }
});

test("renderTimeline produces a playable H.264 mp4", async () => {
  const dir = tmpDir("render");
  const tl = createTimeline({ width: 160, height: 90, fps: 12, name: "test" });
  tl.segments.push({ name: "a", source: { type: "color", color: "#203060" }, duration: 1.2 });
  tl.segments.push({ name: "b", source: { type: "testsrc" }, duration: 1.2 });
  tl.segments.push({
    name: "c", source: { type: "color", color: "#101010" }, duration: 1.0,
    text: [{ text: "HELLO", font: "impact", size: 24, color: "white", x: "center", y: "center" }],
  });
  tl.transitions.push({ type: "fade", duration: 0.3 }, { type: "wipeleft", duration: 0.3 });
  const out = join(dir, "out.mp4");
  await renderTimeline(tl, out, { workDir: join(dir, "work") });

  assert.ok(existsSync(out), "output exists");
  assert.ok(statSync(out).size > 1000, "output has bytes");

  const info = await probe(out);
  const dur = parseFloat(info.format.duration);
  assert.ok(dur > 2.0 && dur < 3.5, `duration ~2.8s, got ${dur}`);
  const v = info.streams.find((s) => s.codec_type === "video");
  assert.ok(v, "has a video stream");
  assert.equal(v.codec_name, "h264");
  assert.equal(v.width, 160);
  assert.equal(v.height, 90);
});

test("timeline summary math accounts for transition overlap", () => {
  const tl = createTimeline({ width: 64, height: 36, fps: 8 });
  tl.segments.push({ duration: 2 }, { duration: 2 }, { duration: 2 });
  tl.transitions.push({ type: "fade", duration: 0.5 }, { type: "fade", duration: 0.5 });
  const built = buildFFmpegArgs(tl, tmpDir("math"));
  assert.ok(Math.abs(built.total - 5.0) < 0.02, `expected 5.0s, got ${built.total}`);
});
