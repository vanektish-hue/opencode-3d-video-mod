import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { MODELS, buildModelScene } from "../src/movie/models.js";
import { synthMusic, synthWhoosh, synthRiser } from "../src/movie/music.js";
import { writeWav, readWav } from "../src/movie/wav.js";

const root = join(import.meta.dirname, "..");
const workDir = join(root, "tmp", "movie");

test("every gallery model builds a non-empty scene", () => {
  const count = (node) => {
    let n = node.geometry ? 1 : 0;
    for (const c of node.children || []) n += count(c);
    return n;
  };
  for (const key of Object.keys(MODELS)) {
    const scene = buildModelScene(key);
    assert.ok(scene.root && Array.isArray(scene.root.children), `${key} has a scene root`);
    const geo = count(scene.root);
    assert.ok(geo > 0, `${key} has geometry (got ${geo})`);
    assert.ok(scene.meta && scene.meta.orbit, `${key} has orbit meta`);
  }
});

test("procedural music is finite and correctly sized", () => {
  const sr = 8000;
  const m = synthMusic(1.5, sr);
  const n = Math.ceil(1.5 * sr) + sr;
  assert.equal(m.left.length, n);
  assert.equal(m.right.length, n);
  for (let i = 0; i < m.left.length; i += 97) {
    assert.ok(Number.isFinite(m.left[i]), "left finite");
    assert.ok(Number.isFinite(m.right[i]), "right finite");
  }
  assert.ok(synthWhoosh(sr).length > 0);
  assert.ok(synthRiser(sr).length > 0);
});

test("wav roundtrip preserves samples", () => {
  const sr = 16000;
  const L = new Float32Array(1600);
  const R = new Float32Array(1600);
  for (let i = 0; i < 1600; i++) {
    L[i] = Math.sin(i / 20) * 0.5;
    R[i] = -L[i] * 0.8;
  }
  const path = join(root, "tmp", "movie", "_test_roundtrip.wav");
  writeWav(path, [L, R], sr);
  const back = readWav(path);
  assert.equal(back.sampleRate, sr);
  assert.equal(back.channels.length, 2);
  assert.equal(back.channels[0].length, 1600);
  for (let i = 0; i < 1600; i += 100) {
    assert.ok(Math.abs(back.channels[0][i] - L[i]) < 1e-3, `L[${i}]`);
    assert.ok(Math.abs(back.channels[1][i] - R[i]) < 1e-3, `R[${i}]`);
  }
});

test("movie layout hits ~10 minutes with the support block on the third minute", async (t) => {
  const narration = join(workDir, "narration.json");
  if (!existsSync(narration)) {
    t.skip("narration.json not generated yet (run npm run movie:voice)");
    return;
  }
  const { buildMovie } = await import("../src/movie/build.js");
  const res = await buildMovie(join(root, "exports", "movie.mp4"), { workDir, dryRun: true, log: () => {} });
  assert.ok(res.dryRun);
  assert.ok(res.total > 615 && res.total < 650, `total ${res.total} within ~10:30`);
  assert.ok(res.scenes.length >= 20, "many scenes");
  assert.ok(res.supportStart > 150 && res.supportStart < 200, `support at ${res.supportStart}s (~3:00)`);
  assert.ok(res.chapters.length >= 20, "chapters generated");
});

test("consecutive narrations never overlap", async (t) => {
  const narration = join(workDir, "narration.json");
  if (!existsSync(narration)) {
    t.skip("narration.json not generated yet (run npm run movie:voice)");
    return;
  }
  const { readFileSync } = await import("node:fs");
  const rep = JSON.parse(readFileSync(narration, "utf8"));
  const durById = new Map(rep.scenes.map((s) => [s.id, s.duration]));

  const { buildMovie } = await import("../src/movie/build.js");
  const res = await buildMovie(join(root, "exports", "movie.mp4"), { workDir, dryRun: true, log: () => {} });
  const LEAD = 0.12;
  const voiced = res.scenes
    .filter((s) => durById.has(s.id))
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < voiced.length; i++) {
    const a = voiced[i], b = voiced[i + 1];
    const aEnd = a.start + LEAD + durById.get(a.id);
    const bStart = b.start + LEAD;
    assert.ok(
      bStart >= aEnd - 0.001,
      `voice "${b.id}" starts ${(aEnd - bStart).toFixed(2)}s before "${a.id}" ends`,
    );
  }
});
