import { test } from "node:test";
import assert from "node:assert/strict";

import { makeBox } from "../src/core/mesh.js";
import { bakeScene, renderImage } from "../src/core/raster.js";

// Regression: the rasterizer must never show the inside of a closed object.
// The mesh generators disagree on triangle winding (boxes wind outward, param
// surfaces wind inward), so no single cull direction is safe. Surfaces are
// opaque, so we render both sides and let the Z-buffer pick the near face.
test("closed box renders its near face (no holes / no interior visible)", () => {
  const node = { id: "box", mesh: makeBox(2, 2, 2), position: [0, 0, 0], material: { color: "#ffffff" } };
  const items = bakeScene({ root: { children: [node] } });
  const W = 64, H = 64;
  const r = renderImage(items, {
    width: W, height: H,
    camera: { position: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0], fov: 45, near: 0.05, far: 200 },
    ambientIntensity: 0.5,
    lights: [],
    exposure: 1,
    background: { top: "#000000", bottom: "#000000" },
  });
  const c = (H / 2) * W + W / 2;
  // near face of a 2-unit box seen from z=5 is ~0.9755; the far face is ~0.9838
  assert.ok(r.depth[c] < 0.98, `near face should win the depth test (got ${r.depth[c].toFixed(4)})`);
  assert.equal(r.rgba[c * 4 + 3], 255, "opaque output");
});
