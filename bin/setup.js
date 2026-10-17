// Environment setup / doctor: verifies bundled binaries, fonts and deps,
// then prints how to register the mod in opencode.jsonc.
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { FONT_DIR, FONT_ALIASES, resolveFont } from "../src/core/video.js";
import { ffmpegPath, ffprobePath, runFFmpeg } from "../src/core/ffmpeg.js";

const ROOT = resolve(import.meta.dirname, "..");

const ok = (s) => `\u2713 ${s}`;
const bad = (s) => `\u2717 ${s}`;
const warn = (s) => `\u2022 ${s}`;

console.log("Creator Mod \u2014 environment doctor\n");

// 1. Node
const major = Number(process.versions.node.split(".")[0]);
console.log((major >= 20 ? ok : bad)(`node ${process.versions.node} (need >=20)`));

// 2. Dependencies
for (const dep of ["@modelcontextprotocol/sdk", "ffmpeg-static", "ffprobe-static", "three", "ws"]) {
  const found = existsSync(join(ROOT, "node_modules", ...dep.split("/")));
  console.log((found ? ok : bad)(`dependency ${dep}`));
}

// 3. ffmpeg / ffprobe
const fm = ffmpegPath();
const fp = ffprobePath();
console.log((existsSync(fm) || fm === "ffmpeg" ? ok : bad)(`ffmpeg: ${fm}`));
console.log((existsSync(fp) || fp === "ffprobe" ? ok : bad)(`ffprobe: ${fp}`));
try {
  const { stdout, stderr } = await runFFmpeg(["-version"]);
  const line = (stdout || stderr).split("\n")[0].trim();
  console.log(ok(`ffmpeg runs: ${line}`));
} catch (e) {
  console.log(bad(`ffmpeg failed to run: ${e.message}`));
}

// 4. Fonts
console.log(`\nFont directory: ${FONT_DIR} (${existsSync(FONT_DIR) ? "found" : "MISSING"})`);
const aliases = Object.keys(FONT_ALIASES);
let resolved = 0;
for (const a of aliases) {
  const p = resolveFont(a);
  if (p && existsSync(p)) resolved++;
}
console.log(`resolved ${resolved}/${aliases.length} font aliases`);
if (resolved < aliases.length) {
  const missing = aliases.filter((a) => { const p = resolveFont(a); return !(p && existsSync(p)); });
  console.log(warn(`missing: ${missing.join(", ")}`));
}
if (existsSync(FONT_DIR)) {
  const ttf = readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f));
  console.log(warn(`${ttf.length} font files available`));
}

// 5. Registration snippet
console.log("\nRegister in opencode.jsonc (server name \"creator\"):\n");
console.log(JSON.stringify({
  $schema: "https://opencode.ai/config.json",
  mcp: {
    servers: {
      creator: {
        type: "local",
        command: ["node", join(ROOT, "bin", "mcp.js")],
        cwd: ROOT,
        environment: { CREATOR_EXPORT_DIR: "exports" },
      },
    },
  },
}, null, 2));
console.log("\nDone.");
