// Shared project state (scene + timeline) with persistence and change events.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createScene, getMesh, sceneStats, listNodes } from "./scene.js";
import { createTimeline } from "./video.js";

export class Project {
  constructor() {
    this.scene = createScene("untitled");
    this.timeline = createTimeline({ width: 1280, height: 720, fps: 24, name: "untitled" });
    this.listeners = new Set();
    this.statePath = null;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) {
      try {
        fn(this);
      } catch {
        /* ignore listener errors */
      }
    }
    this.persist();
  }

  persist() {
    if (!this.statePath) return;
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      writeFileSync(this.statePath, JSON.stringify(this.toJSON(), null, 2));
    } catch {
      /* ignore */
    }
  }

  toJSON() {
    return {
      version: 1,
      scene: this.scene,
      timeline: this.timeline,
      savedAt: new Date().toISOString(),
    };
  }

  loadJSON(data) {
    if (data.scene) this.scene = data.scene;
    if (data.timeline) this.timeline = data.timeline;
    this.emit();
  }

  save(path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(this.toJSON(), null, 2));
    return path;
  }

  static loadFrom(path) {
    const p = new Project();
    p.loadJSON(JSON.parse(readFileSync(path, "utf8")));
    return p;
  }

  /** Compact summary used by tools and the UI side panel. */
  summary() {
    return {
      scene: { name: this.scene.name, stats: sceneStats(this.scene), nodes: listNodes(this.scene), camera: this.scene.camera },
      timeline: {
        name: this.timeline.name,
        width: this.timeline.width,
        height: this.timeline.height,
        fps: this.timeline.fps,
        segments: this.timeline.segments.map((s, i) => ({ index: i, name: s.name || `segment ${i}`, source: s.source?.type || (s.source?.type === "frames" ? "frames" : "?"), duration: s.duration, texts: (s.text || []).length })),
        transitions: this.timeline.transitions,
        overlays: (this.timeline.overlays || []).length,
        texts: (this.timeline.texts || []).length,
        audio: this.timeline.audio ? this.timeline.audio.tracks?.length ?? 0 : 0,
      },
    };
  }
}

export function ensureMeshCacheWarm(scene) {
  const walk = (n) => {
    if (n.geometry) getMesh(n.geometry);
    for (const c of n.children || []) walk(c);
  };
  walk(scene.root);
}
