// 3D modeling tests: mouse scene structure, GLB export validity, CPU raster output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMouseScene, addMouse, MOUSE_MATERIALS } from "../src/core/mouse.js";
import { createScene, bakedItems, sceneStats, addNode } from "../src/core/scene.js";
import { exportGLB, exportOBJ } from "../src/core/glb.js";
import { renderImageAA, renderCutout } from "../src/core/raster.js";
import { encodePNG, isPNG } from "../src/core/png.js";

test("mouse scene has real, multi-part geometry", () => {
  const scene = createMouseScene();
  const stats = sceneStats(scene);
  assert.ok(stats.nodes >= 15, `expected >=15 nodes, got ${stats.nodes}`);
  assert.ok(stats.tris > 5000, `expected >5000 triangles, got ${stats.tris}`);
  assert.ok(stats.materials >= 5, `expected >=5 materials, got ${stats.materials}`);
  assert.ok(Object.keys(MOUSE_MATERIALS).length >= 5);
});

test("addMouse attaches a group with children", () => {
  const scene = createScene("t");
  const group = addMouse(scene, { cable: true, name: "M" });
  assert.equal(group.name, "M");
  assert.ok(group.children.length >= 10, `expected >=10 parts, got ${group.children.length}`);
  const noCable = addMouse(scene, { cable: false, name: "M2" });
  assert.ok(noCable.children.length < group.children.length, "cable=false yields fewer parts");
});

test("GLB export is valid glTF 2.0 binary", () => {
  const scene = createMouseScene();
  const buf = exportGLB(scene);
  assert.ok(Buffer.isBuffer(buf) || buf instanceof Uint8Array);
  const b = Buffer.from(buf);
  assert.equal(b.readUInt32LE(0), 0x46546c67, "magic is 'glTF'");
  assert.equal(b.readUInt32LE(4), 2, "asset version is 2");
  assert.equal(b.readUInt32LE(8), b.length, "declared total length matches buffer");
  // chunk 0 = JSON
  const jsonLen = b.readUInt32LE(12);
  assert.equal(b.readUInt32LE(16), 0x4e4f534a, "first chunk is JSON");
  const gltf = JSON.parse(b.slice(20, 20 + jsonLen).toString("utf8"));
  assert.equal(gltf.asset.version, "2.0");
  assert.ok(gltf.meshes.length >= 15, `expected many meshes, got ${gltf.meshes.length}`);
  assert.ok(gltf.accessors.length >= 15, "has accessors");
  assert.ok(gltf.buffers[0].byteLength > 0, "buffer has data");
  // second chunk = BIN
  const binOff = 20 + jsonLen;
  const binLen = b.readUInt32LE(binOff);
  assert.equal(b.readUInt32LE(binOff + 4), 0x004e4942, "second chunk is BIN");
  assert.ok(binLen > 1000, `binary chunk has payload (${binLen})`);
});

test("OBJ export contains vertices and faces", () => {
  const scene = createMouseScene();
  const obj = exportOBJ(scene);
  assert.ok(/^v /m.test(obj), "has vertex lines");
  assert.ok(/^f /m.test(obj), "has face lines");
  assert.ok(obj.split("\n").length > 1000, "is non-trivial");
});

function contrast(rgba) {
  let min = 255, max = 0, sum = 0, sum2 = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    const v = rgba[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v; sum2 += v * v;
  }
  const mean = sum / n;
  return { range: max - min, variance: sum2 / n - mean * mean };
}

test("CPU raster preview is non-blank and encodes to a valid PNG", () => {
  const scene = createMouseScene();
  const img = renderImageAA(bakedItems(scene), {
    width: 256, height: 144, camera: scene.camera, lights: scene.lights,
    background: scene.background, ground: scene.ground, aa: 1,
    ambientIntensity: 0.35, exposure: 1.15,
  });
  const c = contrast(img.rgba);
  assert.ok(c.range > 60, `image contrast too low (range ${c.range.toFixed(0)})`);
  assert.ok(c.variance > 200, `image variance too low (${c.variance.toFixed(0)})`);
  const png = encodePNG(img.width, img.height, img.rgba, { alpha: false });
  assert.ok(isPNG(png));
  assert.ok(png.length > 2000, "png has content");
});

test("cutout render produces alpha-transparent logo", () => {
  const scene = createScene("logo");
  scene.materials.glow = { color: "#112244", emissive: "#33ffcc", emissiveIntensity: 2 };
  addNode(scene, { name: "ball", geometry: { kind: "sphere", params: { r: 0.8, seg: 32, rings: 20 } }, material: "glow" });
  const img = renderCutout(bakedItems(scene), {
    width: 128, height: 128, camera: scene.camera, lights: scene.lights,
    ambientColor: "#334466", ambientIntensity: 0.4, exposure: 1.2, alphaGain: 6,
  });
  let opaque = 0;
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] > 10) opaque++;
  assert.ok(opaque > 50, `expected some opaque pixels, got ${opaque}`);
  const png = encodePNG(img.width, img.height, img.rgba, { alpha: true });
  assert.ok(isPNG(png));
});
