// Builds exports/project.json = mouse scene + full showreel timeline,
// so the web UI shows a populated viewport and timeline.
import { join } from "node:path";
import { existsSync } from "node:fs";
import { Project } from "../src/core/project.js";
import { createMouseScene } from "../src/core/mouse.js";
import { buildShowreelTimeline } from "../src/demo/showreel.js";

const ROOT = join(import.meta.dirname, "..");
const workDir = join(ROOT, "tmp", "showreel");
const mousePattern = join(workDir, "mouse3d");
const logoPath = join(workDir, "logo.png");

if (!existsSync(mousePattern)) {
  console.warn(`[make-demo-project] mouse frames not found at ${mousePattern}; timeline will reference a missing clip.`);
}
if (!existsSync(logoPath)) {
  console.warn(`[make-demo-project] logo not found at ${logoPath}.`);
}

const project = new Project();
project.scene = createMouseScene();
project.scene.name = "computer-mouse";

project.timeline = buildShowreelTimeline({
  width: 1280,
  height: 720,
  fps: 24,
  mousePattern,
  logoPath,
  total3d: 4.2,
});

const out = join(ROOT, "exports", "project.json");
project.save(out);
console.log(`Saved demo project -> ${out}`);
console.log(JSON.stringify(project.summary(), null, 2));
