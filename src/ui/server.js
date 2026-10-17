// HTTP + WebSocket server for the web viewport. Serves the static UI and live
// project state; also exposes on-demand CPU preview renders.
import { createServer } from "node:http";
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, normalize, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { bakedItems } from "../core/scene.js";
import { renderImageAA } from "../core/raster.js";
import { encodePNG } from "../core/png.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const WEB_DIR = join(ROOT, "web");
const THREE_DIR = join(ROOT, "node_modules", "three");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendFile(res, file) {
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found: " + file);
    return;
  }
  const body = readFileSync(file);
  res.writeHead(200, { "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(body);
}

function safeJoin(base, urlPath) {
  const p = normalize(join(base, urlPath)).replace(/^(\.\.[/\\])+/, "");
  if (!p.startsWith(base)) return null;
  return p;
}

/**
 * Start the UI server. `project` is a Project instance.
 * Returns { server, port, url, broadcast, close }.
 */
export function startUiServer(project, opts = {}) {
  const desiredPort = opts.port ?? 8791;

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = decodeURIComponent(url.pathname);

    if (path === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ summary: project.summary(), scene: project.scene, timeline: project.timeline }));
      return;
    }

    if (path === "/api/preview") {
      try {
        const w = Math.min(1600, Number(url.searchParams.get("w") || 800));
        const h = Math.min(1200, Number(url.searchParams.get("h") || 450));
        const aa = Math.min(3, Number(url.searchParams.get("aa") || 1));
        const view = url.searchParams.get("view") || "persp";
        const scene = project.scene;
        const camera = cameraByName(scene, view);
        const t0 = Date.now();
        const img = renderImageAA(bakedItems(scene), {
          width: w,
          height: h,
          camera,
          lights: scene.lights,
          background: scene.background,
          ground: scene.ground,
          ambientColor: "#5f7391",
          ambientIntensity: 0.35,
          exposure: 1.15,
          aa,
        });
        const png = encodePNG(img.width, img.height, img.rgba, { alpha: false });
        res.writeHead(200, { "Content-Type": "image/png", "X-Render-Ms": String(Date.now() - t0), "Cache-Control": "no-cache" });
        res.end(png);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(String(e && e.stack ? e.stack : e));
      }
      return;
    }

    // static: /vendor/three/... -> node_modules/three/..., else web/
    if (path.startsWith("/vendor/three/")) {
      const file = safeJoin(THREE_DIR, path.slice("/vendor/three/".length));
      if (file) return sendFile(res, file);
    }
    const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
    const file = safeJoin(WEB_DIR, rel);
    if (!file) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    sendFile(res, file);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "state", summary: project.summary(), data: { scene: project.scene, timeline: project.timeline } }));
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "request-state") {
        ws.send(JSON.stringify({ type: "state", summary: project.summary(), data: { scene: project.scene, timeline: project.timeline } }));
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    });
  });

  const broadcast = () => {
    const payload = JSON.stringify({ type: "state", summary: project.summary(), data: { scene: project.scene, timeline: project.timeline } });
    for (const client of wss.clients) if (client.readyState === 1) client.send(payload);
  };
  const off = project.onChange(broadcast);

  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryListen = (port) => {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && attempts < 20 && opts.port == null) {
          attempts += 1;
          tryListen(port + 1);
        } else reject(err);
      });
      server.listen(port, "127.0.0.1", () => {
        const actual = server.address().port;
        resolve({
          server,
          wss,
          port: actual,
          url: `http://127.0.0.1:${actual}/`,
          broadcast,
          close: () => {
            off();
            try { wss.close(); } catch {}
            try { server.close(); } catch {}
          },
        });
      });
    };
    tryListen(desiredPort);
  });
}

export function cameraByName(scene, view) {
  const c = scene.camera;
  const t = c.target || [0, 0, 0];
  const d = Math.hypot(c.position[0] - t[0], c.position[1] - t[1], c.position[2] - t[2]) || 4;
  switch (view) {
    case "front": return { ...c, position: [t[0], t[1] + 0.2, t[2] + d] };
    case "side": return { ...c, position: [t[0] + d, t[1] + 0.2, t[2]] };
    case "top": return { ...c, position: [t[0], t[1] + d, t[2] + 0.001] };
    case "back": return { ...c, position: [t[0], t[1] + 0.2, t[2] - d] };
    default: return c;
  }
}
