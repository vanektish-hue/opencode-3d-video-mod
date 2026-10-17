// Standalone web UI launcher: node bin/ui.js [port]
// Starts the 3D viewport + timeline UI for the default project (or a saved one).
import { Project } from "../src/core/project.js";
import { startUiServer } from "../src/ui/server.js";
import { join, dirname, isAbsolute } from "node:path";
import { existsSync } from "node:fs";

const port = Number(process.argv[2] || 8791);
const project = new Project();
const projectPath = process.env.CREATOR_PROJECT
  ? (isAbsolute(process.env.CREATOR_PROJECT) ? process.env.CREATOR_PROJECT : join(process.cwd(), process.env.CREATOR_PROJECT))
  : join(process.cwd(), "exports", "project.json");
if (existsSync(projectPath)) {
  try {
    project.loadJSON(JSON.parse(await import("node:fs/promises").then((f) => f.readFile(projectPath, "utf8"))));
    console.error(`[ui] loaded project: ${projectPath}`);
  } catch (e) {
    console.error(`[ui] could not load ${projectPath}: ${e.message}`);
  }
} else {
  console.error("[ui] no project file yet — starting empty (call a modeling_* / video_* tool to build something).");
}

const ui = await startUiServer(project, { port });
console.log(`UI server running at ${ui.url}  (3D viewport + timeline)`);
console.log("Press Ctrl+C to stop.");

process.on("SIGINT", () => { ui.close(); process.exit(0); });
process.on("SIGTERM", () => { ui.close(); process.exit(0); });