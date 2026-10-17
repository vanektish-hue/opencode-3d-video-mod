// MCP server exposing modeling.*, video.*, ui.* and project.* tools.
// Runs over stdio; OpenCode loads it via opencode.jsonc.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { join, resolve } from "node:path";
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { Project } from "../core/project.js";
import {
  createScene, addNode, removeNode, findNode, findParent,
  newId, listNodes, sceneStats, bakedItems,
} from "../core/scene.js";
import { addMouse, MOUSE_MATERIALS } from "../core/mouse.js";
import { exportGLB, exportOBJ } from "../core/glb.js";
import { renderImageAA } from "../core/raster.js";
import { encodePNG } from "../core/png.js";
import { renderFrameSequence, orbitKeyframes, cameraAt } from "../core/frames.js";
import { createTimeline, buildFFmpegArgs } from "../core/video.js";
import { runFFmpeg, probe } from "../core/ffmpeg.js";
import { startUiServer, cameraByName } from "../ui/server.js";
import { renderLogo, renderShowreel } from "../demo/showreel.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const EXPORT_DIR = join(ROOT, process.env.CREATOR_EXPORT_DIR || "exports");
const TMP_DIR = join(ROOT, "tmp", "mcp");
mkdirSync(EXPORT_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

const project = new Project();
project.statePath = join(TMP_DIR, "project.json");
if (existsSync(project.statePath)) {
  try {
    project.loadJSON(JSON.parse(readFileSync(project.statePath, "utf8")));
  } catch { /* ignore corrupted state */ }
}

let ui = null;

// ---------- base result helpers ----------
const text = (t) => ({ content: [{ type: "text", text: String(t) }] });
const errRes = (e) => ({ isError: true, content: [{ type: "text", text: `Error: ${e?.stack || e}` }] });
const imgRes = (pngBuf, meta) => ({
  content: [
    { type: "text", text: JSON.stringify(meta, null, 2) },
    { type: "image", data: pngBuf.toString("base64"), mimeType: "image/png" },
  ],
});
const num = (v, d) => (v == null ? d : Array.isArray(v) ? v : Number(v));
const arr = (v, d) => (v == null ? d : v);

// ---------- tool implementations ----------
const TOOLS = {};

TOOLS.project_summary = {
  description: "Human/agent-readable summary of the current scene and timeline.",
  schema: {},
  async run() {
    return text(JSON.stringify(project.summary(), null, 2));
  },
};

TOOLS.project_save = {
  description: "Save project (scene + timeline) to a JSON file.",
  schema: { path: { type: "string", description: "Output path (default exports/project.json)" } },
  async run(a) {
    const p = a.path || join(EXPORT_DIR, "project.json");
    project.save(p);
    return text(`Saved project to ${p}`);
  },
};

TOOLS.project_load = {
  description: "Load a project JSON file (scene + timeline).",
  schema: { path: { type: "string" } },
  async run(a) {
    const p = Project.loadFrom(a.path);
    project.scene = p.scene;
    project.timeline = p.timeline;
    project.emit();
    return text(`Loaded project from ${a.path}`);
  },
};

TOOLS.modeling_new_scene = {
  description: "Create a fresh empty 3D scene (replaces current).",
  schema: { name: { type: "string" } },
  async run(a) {
    project.scene = createScene(a.name || "untitled");
    project.emit();
    return text(`New scene: ${project.scene.name}\n` + JSON.stringify(sceneStats(project.scene)));
  },
};

TOOLS.modeling_add_mouse = {
  description: "Add an entire procedural computer mouse model (body, buttons, wheel, grips, LED, cable) as a node group.",
  schema: {
    origin: { type: "array", items: { type: "number" }, description: "[x,y,z] group origin" },
    cable: { type: "boolean", description: "Include the braided cable (default true)" },
    name: { type: "string" },
  },
  async run(a) {
    const group = addMouse(project.scene, { origin: arr(a.origin, [0, 0, 0]), cable: a.cable !== false, name: a.name });
    project.emit();
    return text(
      `Mouse model added: ${group.id}\n` +
      JSON.stringify({ ...sceneStats(project.scene), materials: Object.keys(MOUSE_MATERIALS) }, null, 2),
    );
  },
};

const PROTO_KINDS = ["ellipsoid", "sphere", "box", "roundedBox", "cylinder", "torus", "capsule", "tube", "disk"];
TOOLS.modeling_add_primitive = {
  description:
    "Add a primitive mesh (ellipsoid, sphere, box, roundedBox, cylinder, torus, capsule, tube, disk) to the scene.",
  schema: {
    kind: { type: "string", enum: PROTO_KINDS },
    params: { type: "object", description: "Geometry params: rx/ry/rz or r or w/h/d or radius, seg..." },
    name: { type: "string" },
    position: { type: "array", items: { type: "number" } },
    rotation: { type: "array", items: { type: "number" }, description: "Euler [x,y,z] radians" },
    scale: { type: "array", items: { type: "number" } },
    color: { type: "string", description: "Base color hex, e.g. #c8ccd4" },
    metallic: { type: "number" },
    roughness: { type: "number" },
    emissive: { type: "string" },
    emissiveIntensity: { type: "number" },
    material: { type: "string", description: "Name of a palette material" },
    parentId: { type: "string" },
  },
  async run(a) {
    if (a.material && !project.scene.materials[a.material]) {
      project.scene.materials[a.material] = { color: a.color || "#c8ccd4" };
    }
    let material = a.material;
    if (!material) {
      const mid = newId("mat");
      const m = { color: a.color || "#c8ccd4" };
      if (a.metallic != null) m.metallic = a.metallic;
      if (a.roughness != null) m.roughness = a.roughness;
      if (a.emissive) m.emissive = a.emissive;
      if (a.emissiveIntensity != null) m.emissiveIntensity = a.emissiveIntensity;
      project.scene.materials[mid] = m;
      material = mid;
    }
    const node = addNode(project.scene, {
      name: a.name,
      geometry: { kind: a.kind, params: a.params || {} },
      position: arr(a.position, [0, 0, 0]),
      rotation: arr(a.rotation, [0, 0, 0]),
      scale: arr(a.scale, [1, 1, 1]),
      material,
    }, a.parentId || "root");
    project.emit();
    return text(`Added ${a.kind} node ${node.id} (${node.name})\n` + JSON.stringify(sceneStats(project.scene)));
  },
};

TOOLS.modeling_transform = {
  description: "Set position/rotation/scale/visibility of an existing node.",
  schema: {
    id: { type: "string" },
    position: { type: "array", items: { type: "number" } },
    rotation: { type: "array", items: { type: "number" } },
    scale: { type: "array", items: { type: "number" } },
    visible: { type: "boolean" },
  },
  async run(a) {
    const n = findNode(project.scene, a.id);
    if (!n) return errRes(`Node not found: ${a.id}`);
    if (a.position) n.position = a.position;
    if (a.rotation) n.rotation = a.rotation;
    if (a.scale) n.scale = a.scale;
    if (a.visible != null) n.visible = a.visible;
    project.emit();
    return text(`Node ${a.id}: ${JSON.stringify({ position: n.position, rotation: n.rotation, scale: n.scale })}`);
  },
};

TOOLS.modeling_set_material = {
  description: "Update a node's material or define a named material in the palette.",
  schema: {
    id: { type: "string", description: "Node id, or 'palette' to define a named material" },
    material: { type: "string", description: "Name of palette material, or use fields below" },
    color: { type: "string" },
    metallic: { type: "number" },
    roughness: { type: "number" },
    emissive: { type: "string" },
    emissiveIntensity: { type: "number" },
  },
  async run(a) {
    if (a.id === "palette" || (a.material && !findNode(project.scene, a.id))) {
      const name = a.material || newId("mat");
      const m = { color: a.color || "#c8ccd4" };
      if (a.metallic != null) m.metallic = a.metallic;
      if (a.roughness != null) m.roughness = a.roughness;
      if (a.emissive) m.emissive = a.emissive;
      if (a.emissiveIntensity != null) m.emissiveIntensity = a.emissiveIntensity;
      project.scene.materials[name] = m;
      project.emit();
      return text(`Palette material '${name}' -> ${JSON.stringify(m)}`);
    }
    const n = findNode(project.scene, a.id);
    if (!n) return errRes(`Node not found: ${a.id}`);
    if (a.material) n.material = a.material;
    else {
      const m = { ...(typeof n.material === "object" ? n.material : {}) };
      if (a.color) m.color = a.color;
      if (a.metallic != null) m.metallic = a.metallic;
      if (a.roughness != null) m.roughness = a.roughness;
      if (a.emissive) m.emissive = a.emissive;
      if (a.emissiveIntensity != null) m.emissiveIntensity = a.emissiveIntensity;
      n.material = m;
    }
    project.emit();
    return text(`Material updated on ${a.id}`);
  },
};

TOOLS.modeling_list = {
  description: "List the node tree of the scene.",
  schema: { full: { type: "boolean", description: "Include geometry/material details" } },
  async run(a) {
    const nodes = listNodes(project.scene);
    const flat = [];
    const dump = (n, depth) => {
      flat.push({ id: n.id, name: n.name, depth, kind: n.geometry?.kind || "group", visible: n.visible !== false, position: n.position, material: n.material });
      for (const c of n.children || []) dump(c, depth + 1);
    };
    dump(project.scene.root, 0);
    return text(JSON.stringify(a.full ? flat : nodes, null, 2));
  },
};

TOOLS.modeling_delete = {
  description: "Remove a node (and its children) from the scene.",
  schema: { id: { type: "string" } },
  async run(a) {
    const ok = removeNode(project.scene, a.id);
    project.emit();
    return text(ok ? `Deleted ${a.id}` : `Node not found: ${a.id}`);
  },
};

TOOLS.modeling_set_camera = {
  description: "Set the camera position/target/fov.",
  schema: {
    position: { type: "array", items: { type: "number" } },
    target: { type: "array", items: { type: "number" } },
    fov: { type: "number" },
  },
  async run(a) {
    const c = project.scene.camera;
    if (a.position) c.position = a.position;
    if (a.target) c.target = a.target;
    if (a.fov != null) c.fov = a.fov;
    project.emit();
    return text(`Camera: ${JSON.stringify(c)}`);
  },
};

TOOLS.modeling_add_light = {
  description: "Add a directional or point light.",
  schema: {
    type: { type: "string", enum: ["directional", "point"] },
    direction: { type: "array", items: { type: "number" } },
    position: { type: "array", items: { type: "number" } },
    color: { type: "string" },
    intensity: { type: "number" },
  },
  async run(a) {
    const l = { type: a.type || "directional", color: a.color || "#ffffff", intensity: a.intensity ?? 1 };
    if (a.type === "point") l.position = arr(a.position, [2, 3, 2]);
    else l.direction = arr(a.direction, [-1, -1.5, -1]);
    project.scene.lights.push(l);
    project.emit();
    return text(`Light added: ${JSON.stringify(l)}`);
  },
};

TOOLS.modeling_preview = {
  description:
    "Render the current scene to an image (software rasterizer) so the agent can see it. Returns an image plus stats.",
  schema: {
    width: { type: "number" },
    height: { type: "number" },
    aa: { type: "number", description: "Supersampling 1..3" },
    view: { type: "string", enum: ["persp", "front", "side", "top", "back"] },
  },
  async run(a) {
    const w = Math.min(1600, num(a.width, 960));
    const h = Math.min(1200, num(a.height, 540));
    const cam = cameraByName(project.scene, a.view || "persp");
    const img = renderImageAA(bakedItems(project.scene), {
      width: w,
      height: h,
      camera: cam,
      lights: project.scene.lights,
      background: project.scene.background,
      ground: project.scene.ground,
      ambientColor: "#5f7391",
      ambientIntensity: 0.35,
      exposure: 1.15,
      aa: Math.min(3, num(a.aa, 2)),
    });
    const png = encodePNG(img.width, img.height, img.rgba, { alpha: false });
    return imgRes(png, { view: a.view || "persp", width: w, height: h, stats: sceneStats(project.scene) });
  },
};

TOOLS.modeling_render_frames = {
  description:
    "Render an animated PNG frame sequence from the scene (orbit camera + motion blur). Path: tmp/mcp/frames_<n>/frame_%04d.png.",
  schema: {
    outDir: { type: "string" },
    width: { type: "number" },
    height: { type: "number" },
    fps: { type: "number" },
    duration: { type: "number" },
    samples: { type: "number", description: "Motion blur samples (default 3)" },
    aa: { type: "number" },
    startAngle: { type: "number" },
    endAngle: { type: "number" },
    radius: { type: "number" },
    radiusEnd: { type: "number" },
    heightY: { type: "number" },
  },
  async run(a) {
    const outDir = a.outDir || join(TMP_DIR, `frames_${Date.now() % 100000}`);
    await renderFrameSequence(project.scene, {
      outDir,
      width: num(a.width, 320),
      height: num(a.height, 180),
      fps: num(a.fps, 24),
      duration: num(a.duration, 2),
      samples: num(a.samples, 3),
      aa: num(a.aa, 1),
      cameraPath: orbitKeyframes({
        center: [0, 0.2, 0],
        radius: num(a.radius, 4.5),
        radiusEnd: a.radiusEnd == null ? undefined : num(a.radiusEnd),
        height: num(a.heightY, 2.3),
        startAngle: num(a.startAngle, 0.4 * Math.PI),
        endAngle: num(a.endAngle, 2.4 * Math.PI),
        duration: num(a.duration, 2),
        steps: 8,
      }),
      ambientIntensity: 0.36,
      exposure: 1.18,
    });
    return text(`Rendered ${num(a.fps, 24) * num(a.duration, 2)} frames to ${outDir}/frame_%04d.png`);
  },
};

TOOLS.modeling_export_glb = {
  description: "Export the scene to a glTF 2.0 binary (.glb) file.",
  schema: { path: { type: "string" } },
  async run(a) {
    const p = a.path || join(EXPORT_DIR, "scene.glb");
    writeFileSync(p, exportGLB(project.scene));
    return text(`Exported GLB (${statSync(p).size} bytes) -> ${p}`);
  },
};

TOOLS.modeling_export_obj = {
  description: "Export the scene to Wavefront .obj.",
  schema: { path: { type: "string" } },
  async run(a) {
    const p = a.path || join(EXPORT_DIR, "scene.obj");
    writeFileSync(p, exportOBJ(project.scene));
    return text(`Exported OBJ -> ${p}`);
  },
};

TOOLS.video_new_timeline = {
  description: "Create a fresh video timeline (replaces current).",
  schema: { width: { type: "number" }, height: { type: "number" }, fps: { type: "number" }, name: { type: "string" } },
  async run(a) {
    project.timeline = createTimeline({
      width: num(a.width, 1280),
      height: num(a.height, 720),
      fps: num(a.fps, 24),
      name: a.name || "timeline",
    });
    project.emit();
    return text(`New timeline ${a.width || 1280}x${a.height || 720} @ ${a.fps || 24}fps`);
  },
};

TOOLS.video_add_clip = {
  description:
    "Append a clip/segment to the timeline. source: {type: 'color'|'gradient'|'testsrc'|'bars'|'life'|'mandelbrot'|'noise'|'frames'|'video'|'image', ...}. Supports text, motionBlur, grade, vignette, animation, fade.",
  schema: {
    source: { type: "object" },
    duration: { type: "number" },
    name: { type: "string" },
    motionBlur: { type: "number" },
    grade: { type: "object" },
    vignette: { type: "number" },
    animation: { type: "object" },
    filters: { type: "array", items: { type: "string" } },
    fade: { type: "object" },
    text: { type: "array", items: { type: "object" } },
    padColor: { type: "string" },
  },
  async run(a) {
    const seg = {
      name: a.name || `clip ${project.timeline.segments.length + 1}`,
      source: a.source,
      duration: num(a.duration, 3),
    };
    if (a.motionBlur) seg.motionBlur = a.motionBlur;
    if (a.grade) seg.grade = a.grade;
    if (a.vignette != null) seg.vignette = a.vignette;
    if (a.animation) seg.animation = a.animation;
    if (a.filters) seg.filters = a.filters;
    if (a.fade) seg.fade = a.fade;
    if (a.text) seg.text = a.text;
    if (a.padColor) seg.padColor = a.padColor;
    project.timeline.segments.push(seg);
    project.emit();
    return text(
      `Added clip #${project.timeline.segments.length} (${seg.source?.type || "?"}, ${seg.duration}s)\n` +
      `Total duration (incl. transitions): ${(segmentTotal(project.timeline)).toFixed(2)}s`,
    );
  },
};

function segmentTotal(tl) {
  const sum = tl.segments.reduce((a, s) => a + num(s.duration, 0), 0);
  const tr = tl.transitions.reduce((a, t) => a + num(t.duration, 0), 0);
  return Math.max(0, sum - tr);
}

TOOLS.video_add_transition = {
  description: "Append a transition between the last two clips. Types: fade, fadeblack, fadewhite, dissolve, wipeleft, wiperight, wipeup, wipedown, slideleft, slideright, slideup, slidedown, circleopen, circleclose, radial, smoothleft, ...",
  schema: { type: { type: "string" }, duration: { type: "number" } },
  async run(a) {
    project.timeline.transitions.push({ type: a.type || "fade", duration: num(a.duration, 0.6) });
    project.emit();
    return text(`Added xfade transition '${a.type || "fade"}' (${num(a.duration, 0.6)}s)`);
  },
};

TOOLS.video_set_texts = {
  description: "Set global text overlays (applied over the whole video after transitions).",
  schema: {
    texts: { type: "array", items: { type: "object" }, description: "Each: {text, font, size, color, x, y, delay, duration, fadeIn, fadeOut, animation, box, border, shadow}" },
  },
  async run(a) {
    project.timeline.texts = a.texts || [];
    project.emit();
    return text(`Set ${project.timeline.texts.length} global texts`);
  },
};

TOOLS.video_add_text = {
  description: "Add a global text overlay to the final video.",
  schema: {
    text: { type: "string" }, font: { type: "string" }, size: { type: "number" }, color: { type: "string" },
    x: { type: "string" }, y: { type: "string" }, delay: { type: "number" }, duration: { type: "number" },
    fadeIn: { type: "number" }, fadeOut: { type: "number" }, animation: { type: "string" },
    box: { type: "boolean" }, border: { type: "number" }, shadow: { type: "boolean" },
  },
  async run(a) {
    const s = {
      text: a.text, font: a.font, size: a.size, color: a.color, x: a.x, y: a.y,
      delay: a.delay, duration: a.duration, fadeIn: a.fadeIn, fadeOut: a.fadeOut, animation: a.animation,
      box: a.box, border: a.border, shadow: a.shadow,
    };
    project.timeline.texts.push(s);
    project.emit();
    return text(`Added global text: "${a.text}"`);
  },
};

TOOLS.video_add_overlay = {
  description: "Add an image overlay (e.g. rendered logo PNG) to the final video.",
  schema: {
    path: { type: "string" }, x: { type: "string" }, y: { type: "string" }, margin: { type: "number" },
    w: { type: "number" }, h: { type: "number" }, delay: { type: "number" }, duration: { type: "number" },
    fadeIn: { type: "number" }, fadeOut: { type: "number" }, opacity: { type: "number" },
  },
  async run(a) {
    project.timeline.overlays.push(a);
    project.emit();
    return text(`Added overlay: ${a.path}`);
  },
};

TOOLS.video_set_audio = {
  description: "Set timeline audio: {tracks:[{type:'sine'|'chord'|'melody'|'noise', ...}], fadeIn, fadeOut}.",
  schema: { tracks: { type: "array" }, fadeIn: { type: "number" }, fadeOut: { type: "number" } },
  async run(a) {
    project.timeline.audio = { tracks: a.tracks || [], fadeIn: a.fadeIn, fadeOut: a.fadeOut };
    project.emit();
    return text(`Audio: ${project.timeline.audio.tracks.length} track(s)`);
  },
};

TOOLS.video_info = {
  description: "Human-readable summary of the current timeline.",
  schema: {},
  async run() {
    const tl = project.timeline;
    const built = buildFFmpegArgs(tl, join(TMP_DIR, "info"));
    return text(
      `Timeline "${tl.name}" ${tl.width}x${tl.height} @${tl.fps}fps\n` +
      `segments: ${tl.segments.length}, transitions: ${tl.transitions.length}, overlays: ${(tl.overlays || []).length}, texts: ${(tl.texts || []).length}\n` +
      `total duration: ${built.total.toFixed(2)}s\n` +
      `filter graph (${built.filterComplex.length} chars, ${built.inputCount} inputs)`,
    );
  },
};

TOOLS.video_render = {
  description: "Render the timeline to an .mp4 (H.264 + AAC) and return ffprobe metadata.",
  schema: { path: { type: "string" }, crf: { type: "number" }, preset: { type: "string" } },
  async run(a) {
    const tl = project.timeline;
    if (tl.output.crf != null) tl.output.crf = num(a.crf, tl.output.crf);
    if (a.preset) tl.output.preset = a.preset;
    const out = a.path || join(EXPORT_DIR, "timeline.mp4");
    const built = buildFFmpegArgs(tl, join(TMP_DIR, `render_${Date.now() % 100000}`));
    await runFFmpeg([...built.args, out]);
    const info = await probe(out);
    return text(
      `Rendered ${out} (${built.total.toFixed(2)}s)\n` +
      `${JSON.stringify(formatProbe(info), null, 2)}`,
    );
  },
};

function formatProbe(info) {
  return {
    format: info.format.format_name,
    duration: parseFloat(info.format.duration).toFixed(2),
    size: info.format.size,
    streams: info.streams.map((s) => ({ type: s.codec_type, codec: s.codec_name, ...(s.width ? { w: s.width, h: s.height } : {}), ...(s.r_frame_rate ? { fps: s.r_frame_rate } : {}) })),
  };
}

TOOLS.video_logo = {
  description: "Render the 3D 'ring' logo overlay PNG (with alpha) that you can add via video_add_overlay.",
  schema: { path: { type: "string" }, size: { type: "number" } },
  async run(a) {
    const p = a.path || join(EXPORT_DIR, "logo.png");
    renderLogo(p, num(a.size, 220));
    return text(`Logo PNG rendered -> ${p}`);
  },
};

TOOLS.showreel = {
  description:
    "Run the full demo pipeline: renders an animated 3D computer mouse (CPU, with motion blur), a logo overlay, and cuts a complete showreel with animated multi-font text, overlays, transitions, grading and audio. Returns paths + probe info.",
  schema: { path: { type: "string" }, fast: { type: "boolean" } },
  async run(a) {
    const out = a.path || join(EXPORT_DIR, "showreel.mp4");
    const res = await renderShowreel(out, a.fast
      ? { width: 640, height: 360, fps: 12, duration3d: 1.5, samples: 1, aa: 1, clipWidth: 640, clipHeight: 360, workDir: join(TMP_DIR, "showreel_fast") }
      : { width: 1280, height: 720, fps: 24, duration3d: 4.2, samples: 4, aa: 1, clipWidth: 1280, clipHeight: 720, workDir: join(TMP_DIR, "showreel") });
    const info = await probe(res.outPath);
    project.emit();
    return text(`Showreel rendered in ${res.duration.toFixed(2)}s -> ${res.outPath}\n` + JSON.stringify(formatProbe(info), null, 2));
  },
};

TOOLS.movie_plan = {
  description:
    "Plan the ~10-minute explainer movie WITHOUT rendering anything: reads the synthesized narration (tmp/movie/narration.json) and returns the scene list, total duration, where the support block starts, and the chapter list. Use this to inspect or tune the movie before a full build.",
  schema: {},
  async run() {
    const { buildMovie } = await import("../movie/build.js");
    const workDir = join(ROOT, "tmp", "movie");
    const res = await buildMovie(join(EXPORT_DIR, "movie.mp4"), { workDir, dryRun: true, log: () => {} });
    const lines = res.scenes.map(
      (s) => `  ${String(s.id).padEnd(14)} start ${s.start.toFixed(1).padStart(6)}s  len ${s.total.toFixed(1).padStart(5)}s  parts ${s.parts}`,
    );
    return text(
      `Movie plan: ${res.total.toFixed(1)}s (${(res.total / 60).toFixed(2)} min), ${res.segmentCount} segments\n` +
      `support starts at ${res.supportStart ? res.supportStart.toFixed(1) + "s" : "n/a"}\n\nscenes:\n${lines.join("\n")}\n\nchapters:\n` +
      res.chapters.map((c, i) => `  ${String(i + 1).padStart(2)}. ${c.title} @ ${c.start.toFixed(1)}s`).join("\n"),
    );
  },
};

TOOLS.movie_build = {
  description:
    "Build the full ~10-minute movie (3D clips + neural voiceover + music + subtitles) into exports/movie.mp4, and write movie.srt / movie.description.txt. Heavy: renders 3D on CPU and encodes with ffmpeg (can take tens of minutes). Set reuse=true to skip re-rendering cached 3D clips and audio; set fast=true for a quick draft.",
  schema: { path: { type: "string" }, fast: { type: "boolean" }, reuse: { type: "boolean" } },
  async run(a) {
    const { buildMovie } = await import("../movie/build.js");
    const out = a.path || join(EXPORT_DIR, "movie.mp4");
    const res = await buildMovie(out, {
      workDir: join(ROOT, "tmp", "movie"),
      reuseClips: !!a.reuse,
      crf: a.fast ? 24 : 21,
      preset: a.fast ? "veryfast" : "medium",
      log: () => {},
    });
    const info = await probe(out);
    project.emit();
    return text(
      `Movie built -> ${out}\n  duration ${res.total.toFixed(1)}s   support at ${res.supportStart ? res.supportStart.toFixed(1) + "s" : "n/a"}   captions ${res.cues}   chapters ${res.chapters.length}\n` +
      JSON.stringify(formatProbe(info), null, 2),
    );
  },
};

TOOLS.ui_status = {
  description: "Whether the web UI server is running and at which URL.",
  schema: {},
  async run() {
    return text(ui ? `UI running at ${ui.url}` : "UI not started. Call ui_open.");
  },
};

TOOLS.ui_open = {
  description: "Start the localhost web UI (3D viewport + timeline) and return its URL. Open that URL in the built-in browser to see the scene graphically.",
  schema: { port: { type: "number" } },
  async run(a) {
    if (!ui) {
      ui = await startUiServer(project, { port: num(a.port, 8791) });
    }
    return text(`UI server: ${ui.url}\nOpen this URL in the built-in browser window.`);
  },
};

// ---------- MCP wiring ----------
const server = new Server({ name: "creator-mod", version: "0.1.0" }, { capabilities: { tools: {} } });

const toolDefinitions = Object.entries(TOOLS).map(([name, t]) => ({
  name,
  description: t.description,
  inputSchema: { type: "object", properties: t.schema, additionalProperties: false },
}));

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const tool = TOOLS[name];
  if (!tool) return errRes(`Unknown tool: ${name}`);
  try {
    return await tool.run(args || {});
  } catch (e) {
    return errRes(e);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[creator-mod] MCP server ready. Tools:", Object.keys(TOOLS).length);