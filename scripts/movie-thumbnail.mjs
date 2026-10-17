// Render a 1280x720 YouTube thumbnail: a clean 3D mouse + big title.
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { renderFrameSequence, orbitKeyframes } from "../src/core/frames.js";
import { buildModelScene } from "../src/movie/models.js";
import { runFFmpeg } from "../src/core/ffmpeg.js";
import { FONT_DIR, resolveFont, esc } from "../src/core/video.js";

const root = join(import.meta.dirname, "..");
const dir = join(root, "tmp", "movie", "thumb");
mkdirSync(dir, { recursive: true });

const scene = buildModelScene("mouse");
const o = scene.meta.orbit || {};
await renderFrameSequence(scene, {
  outDir: dir,
  width: 1280,
  height: 720,
  fps: 24,
  duration: 1 / 24,
  samples: 1,
  aa: 2,
  cameraPath: orbitKeyframes({
    center: o.center || [0, 0, 0],
    radius: (o.radius || 4) * 1.02,
    radiusEnd: (o.radius || 4) * 1.02,
    height: o.height || 2,
    startAngle: Math.PI * 0.72,
    endAngle: Math.PI * 0.72,
    targetY: o.targetY || 0.5,
    fov: o.fov || 40,
    duration: 1 / 24,
    steps: 2,
  }),
  ambientIntensity: 0.4,
  exposure: 1.18,
});

const still = join(dir, "frame_0001.png");
const out = join(root, "exports", "thumbnail.png");

const titleFile = join(dir, "t1.txt");
const subFile = join(dir, "t2.txt");
writeFileSync(titleFile, "ЭТО ВИДЕО СДЕЛАЛ ИИ", "utf8");
writeFileSync(subFile, "3D + монтаж — от лица нейросети", "utf8");

const bold = resolveFont("arialBlack");
const reg = resolveFont("segoe");

const vf = [
  `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.28:t=fill`,
  `drawbox=x=0:y=0:w=iw:h=10:color=#25e6ff@0.95:t=fill`,
  `drawbox=x=0:y=ih-10:w=iw:h=10:color=#ff5d8f@0.95:t=fill`,
  `drawtext=fontfile='${esc(bold)}':textfile='${esc(titleFile)}':fontsize=96:fontcolor=white:borderw=6:bordercolor=#0a0d17:shadowx=4:shadowy=4:shadowcolor=black@0.6:x=(w-text_w)/2:y=140`,
  `drawtext=fontfile='${esc(reg)}':textfile='${esc(subFile)}':fontsize=42:fontcolor=#bfe9ff:borderw=3:bordercolor=#0a0d17:x=(w-text_w)/2:y=290`,
  `drawtext=fontfile='${esc(reg)}':text=miphik:fontsize=30:fontcolor=#eef4ff:borderw=2:bordercolor=black@0.5:x=w-text_w-40:y=h-66`,
].join(",");

await runFFmpeg(["-y", "-i", still, "-vf", vf, "-frames:v", "1", "-update", "1", out], { fontsdir: FONT_DIR });
console.log("thumbnail ->", out);
