// Renders the project summary / timeline into the sidebar.
export function renderSummary(el, summary) {
  if (!el) return;
  const sc = summary.scene || {};
  const tl = summary.timeline || {};

  el.innerHTML = "";

  // --- scene title + stats + node tree ---
  const title = document.createElement("div");
  title.className = "side-title";
  title.textContent = "Сцена";
  el.appendChild(title);

  const stats = document.createElement("pre");
  stats.className = "stats";
  const s = sc.stats || {};
  stats.textContent =
    `scene: ${sc.name || "-"}\n` +
    `nodes: ${s.nodes ?? "-"}   tris: ${s.tris ?? "-"}\n` +
    `lights: ${s.lights ?? "-"}   materials: ${s.materials ?? "-"}\n` +
    `camera: ${fmtVec(sc.camera?.position)}\n` +
    `fov: ${sc.camera?.fov ?? "-"}`;
  el.appendChild(stats);

  const tree = document.createElement("div");
  tree.className = "tree";
  const nodes = sc.nodes || [];
  if (!nodes.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Сцена пуста — добавьте мышку или примитивы.";
    tree.appendChild(empty);
  }
  for (const n of nodes) {
    const row = document.createElement("div");
    row.className = "node";
    row.style.paddingLeft = `${8 + n.depth * 14}px`;
    row.innerHTML = "";
    const label = document.createElement("div");
    label.className = "row";
    if (n.visible === false) label.classList.add("offscreen");
    const dot = document.createElement("span");
    dot.style.color = n.visible === false ? "#666" : "var(--accent2)";
    dot.textContent = n.visible === false ? "◌" : "●";
    const name = document.createElement("span");
    name.textContent = n.name || n.id;
    const kind = document.createElement("span");
    kind.className = "kind small";
    kind.textContent = n.kind || "";
    if (n.children) {
      const kids = document.createElement("span");
      kids.className = "muted small";
      kids.textContent = `(${n.children})`;
      label.append(dot, name, kind, kids);
    } else {
      label.append(dot, name, kind);
    }
    row.appendChild(label);
    tree.appendChild(row);
  }
  el.appendChild(tree);

  // --- timeline ---
  const panel = document.getElementById("timeline-panel");
  if (panel) renderTimelinePanel(panel, summary);
}

function fmtVec(v) {
  if (!v) return "-";
  return `[${v.map((n) => n.toFixed ? n.toFixed(2) : n).join(" ")}]`;
}

function renderTimelinePanel(el, summary) {
  const tl = summary.timeline || {};
  el.innerHTML = "";

  const head = document.createElement("div");
  head.innerHTML = "";
  const name = document.createElement("div");
  name.style.fontWeight = "600";
  name.textContent = tl.name || "timeline";
  const dims = document.createElement("div");
  dims.className = "muted small";
  dims.textContent = `${tl.width || 1280}×${tl.height || 720} @ ${tl.fps || 24}fps`;
  head.append(name, dims);
  el.appendChild(head);

  const tags = document.createElement("div");
  tags.style.margin = "6px 0";
  const mk = (t, cls) => { const s = document.createElement("span"); s.className = cls || "tag"; s.textContent = t; return s; };
  tags.append(
    mk(`${tl.segments?.length ?? 0} сегментов`),
    mk(`${tl.transitions?.length ?? 0} переходов`),
    mk(`${tl.texts ?? 0} текстов`),
    mk(`${tl.overlays ?? 0} оверлеев`),
    tl.audio ? mk(`${tl.audio} аудио-треков`) : null,
  );
  el.appendChild(tags);

  const list = document.createElement("div");
  list.style.marginTop = "6px";
  const segs = tl.segments || [];
  segs.forEach((seg, i) => {
    const tr = (tl.transitions || [])[i - 1];
    if (tr) {
      const t = document.createElement("div");
      t.className = "transition";
      t.textContent = `⧉ ${tr.type || "fade"} ${(tr.duration ?? 0).toFixed(1)}s`;
      list.appendChild(t);
    }
    const c = document.createElement("div");
    c.className = "clip";
    const cHead = document.createElement("div");
    cHead.className = "c-head";
    const cName = document.createElement("span");
    cName.className = "c-name";
    cName.textContent = seg.name || `сегмент ${i + 1}`;
    const cDur = document.createElement("span");
    cDur.className = "c-dur";
    cDur.textContent = `${(seg.duration ?? 0).toFixed(1)}s`;
    cHead.append(cName, cDur);
    const cSrc = document.createElement("div");
    cSrc.className = "c-src";
    cSrc.textContent = srcLabel(seg);
    c.append(cHead, cSrc);
    list.appendChild(c);
  });
  if (!segs.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Таймлайн пуст — добавьте клипы через video_add_clip.";
    list.appendChild(empty);
  }
  el.appendChild(list);
}

function srcLabel(seg) {
  const s = seg.source || {};
  if (s.type === "video") return `video: ${s.path || "-"}`;
  if (s.type === "image") return `image: ${s.path || "-"}`;
  if (s.type === "frames") return `frames: ${s.pattern || "-"}`;
  const extra = [];
  if (s.size) extra.push(s.size);
  if (s.color) extra.push(s.color);
  if (s.speed) extra.push(`×${s.speed}`);
  return `${s.type || "?"}${extra.length ? " · " + extra.join(" ") : ""}`;
}