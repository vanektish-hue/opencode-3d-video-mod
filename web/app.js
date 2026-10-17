// Main UI controller: loads project state over HTTP + WS, drives the Three viewport
// and the timeline sidebar, and exposes view/preview controls.
import { Viewport } from "./viewport.js";
import { renderSummary } from "./timeline.js";

const canvas = document.getElementById("viewport");
const viewport = new Viewport(canvas);
let currentSummary = null;

const wsStatus = document.getElementById("ws-status");
const sceneName = document.getElementById("scene-name");

// ---------- initial HTTP load ----------
async function loadState() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();
    applyState(data.summary, data.scene, data.timeline);
  } catch (e) {
    wsStatus.textContent = "HTTP error";
    wsStatus.className = "badge off";
  }
}

function applyState(summary, scene, timeline) {
  currentSummary = summary;
  viewport.setState(scene);
  sceneName.textContent = scene?.name || "-";
  const sideBlock = document.getElementById("scene-block");
  if (sideBlock) renderSummary(sideBlock, summary);
}

// ---------- WebSocket live updates ----------
let ws = null;
function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    wsStatus.textContent = "live";
    wsStatus.className = "badge on";
  };
  ws.onclose = () => {
    wsStatus.textContent = "offline";
    wsStatus.className = "badge off";
    setTimeout(connectWs, 2000);
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "state" && msg.summary && msg.data) {
        applyState(msg.summary, msg.data.scene, msg.data.timeline);
      }
    } catch { /* ignore malformed frames */ }
  };
}

// ---------- view controls ----------
document.querySelectorAll("#view-tools [data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#view-tools [data-view]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    viewport.setView(btn.dataset.view);
  });
});

document.getElementById("btn-wire")?.addEventListener("click", (e) => {
  viewport.setWireframe(e.target.classList.toggle("active"));
});
document.getElementById("btn-grid")?.addEventListener("click", (e) => {
  viewport.setGridVisible(e.target.classList.toggle("active"));
});
document.getElementById("btn-shade")?.addEventListener("click", (e) => {
  viewport.setWireframe(false);
  document.getElementById("btn-wire")?.classList.remove("active");
  e.target.classList.toggle("active");
});

// ---------- CPU render preview ----------
const previewPanel = document.getElementById("preview-panel");
const previewImg = document.getElementById("preview-img");
const previewMeta = document.getElementById("preview-meta");

document.getElementById("btn-preview")?.addEventListener("click", async () => {
  previewPanel.classList.remove("hidden");
  previewImg.removeAttribute("src");
  previewMeta.textContent = "rendering…";
  try {
    const w = Math.max(320, Math.floor((canvas.clientWidth || 800) * 0.5));
    const h = Math.max(180, Math.floor((canvas.clientHeight || 450) * 0.5));
    const t0 = performance.now();
    const res = await fetch(`/api/preview?w=${w}&h=${h}&aa=1`);
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    previewImg.src = URL.createObjectURL(blob);
    previewMeta.textContent = `${w}×${h} · CPU render · ${Math.round(performance.now() - t0)} ms`;
  } catch (e) {
    previewMeta.textContent = `ошибка: ${e.message}`;
  }
});
document.getElementById("preview-close")?.addEventListener("click", () => {
  previewPanel.classList.add("hidden");
});

// ---------- sizing + render loop ----------
window.addEventListener("resize", () => viewport.resize());
let frames = 0, last = performance.now();
function loop() {
  viewport.render();
  frames += 1;
  const now = performance.now();
  if (now - last >= 1000) {
    const fpsEl = document.getElementById("fps-counter");
    if (fpsEl) fpsEl.textContent = `${frames} fps`;
    frames = 0;
    last = now;
  }
  requestAnimationFrame(loop);
}

loadState();
connectWs();
loop();

// debug hook (used by automated checks; harmless in normal use)
window.__studio = { viewport, getSummary: () => currentSummary };