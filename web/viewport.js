// Three.js viewport: renders the JSON scene graph with simple orbit controls.
import * as THREE from "three";

const VIEW_PRESETS = {
  persp: null,
  front: { theta: 0.0001, phi: Math.PI / 2 },
  side: { theta: Math.PI / 2, phi: Math.PI / 2 },
  back: { theta: Math.PI, phi: Math.PI / 2 },
  top: { theta: 0, phi: 0.0001 },
};

function geoFor(geom) {
  if (!geom) return null;
  const p = geom.params || {};
  switch (geom.kind) {
    case "sphere": return new THREE.SphereGeometry(p.r ?? 1, p.seg ?? 48, p.rings ?? 24);
    case "ellipsoid": return new THREE.SphereGeometry(1, p.seg ?? 48, p.rings ?? 24);
    case "box": return new THREE.BoxGeometry(p.w ?? 1, p.h ?? 1, p.d ?? 1);
    case "roundedBox":
      return new THREE.BoxGeometry(p.w ?? 1, p.h ?? 1, p.d ?? 1, Math.max(1, Math.round((p.seg || 48) / 6)), Math.max(1, Math.round((p.rings || 32) / 6)), Math.max(1, Math.round((p.seg || 48) / 6)));
    case "cylinder":
      return new THREE.CylinderGeometry(p.rTop ?? p.r ?? 1, p.rBottom ?? p.r ?? 1, p.h ?? 2, p.seg ?? 48, 1, p.capped === false);
    case "torus": return new THREE.TorusGeometry(p.majorRadius ?? 1, p.minorRadius ?? 0.3, p.sides ?? 24, p.seg ?? 48);
    case "capsule": return new THREE.CapsuleGeometry(p.r ?? 0.5, p.cyl ?? 1, p.sides ?? 24, p.seg ?? 48);
    case "tube": {
      const pts = (p.points || []).map((q) => new THREE.Vector3(q[0], q[1], q[2]));
      if (pts.length < 2) return null;
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, p.seg ?? 24), p.radius ?? 0.1, p.sides ?? 12, false);
    }
    case "disk": return new THREE.CircleGeometry(p.r ?? 1, p.seg ?? 48);
    default: return null;
  }
}

function materialFor(m) {
  const opts = {
    color: new THREE.Color(m.color || "#c8ccd4"),
    metalness: m.metallic ?? 0.2,
    roughness: m.roughness ?? 0.55,
    flatShading: false,
  };
  if (m.emissive) {
    opts.emissive = new THREE.Color(m.emissive);
    opts.emissiveIntensity = m.emissiveIntensity ?? 1;
  }
  if (m.opacity != null) {
    opts.transparent = true;
    opts.opacity = m.opacity;
  }
  if (m.wireframe) opts.wireframe = true;
  return new THREE.MeshStandardMaterial(opts);
}

function gradientTexture(top, bottom) {
  const c = document.createElement("canvas");
  c.width = 2; c.height = 256;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top || "#0a0d17");
  gr.addColorStop(1, bottom || "#182036");
  g.fillStyle = gr;
  g.fillRect(0, 0, 2, 256);
  return new THREE.CanvasTexture(c);
}

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.sceneGroup = new THREE.Group();
    this.scene.add(this.sceneGroup);
    this.backgroundMesh = null;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400);

    // orbit state
    this.target = new THREE.Vector3(0, 0.35, 0);
    this.theta = 0.8;
    this.phi = 1.15;
    this.radius = 7;
    this.view = "persp";
    this.showGrid = true;
    this.wireframe = false;

    this.grid = new THREE.GridHelper(30, 30, 0x2a3242, 0x1c2330);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.55;
    this.scene.add(this.grid);

    this.bind();
    this.resize();
  }

  bind() {
    const el = this.canvas;
    let dragging = false, panning = false, lastX = 0, lastY = 0;
    el.addEventListener("pointerdown", (e) => {
      dragging = true;
      panning = e.button === 2 || e.shiftKey;
      lastX = e.clientX; lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (panning) {
        const s = this.radius * 0.0016;
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
        this.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
      } else {
        this.theta -= dx * 0.006;
        this.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.phi - dy * 0.006));
      }
    });
    const end = () => { dragging = false; panning = false; };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.radius = Math.max(1.5, Math.min(60, this.radius * (1 + e.deltaY * 0.001)));
    }, { passive: false });
    el.addEventListener("dblclick", (e) => {
      this.target.set(0, 0.35, 0);
    });
  }

  setView(name) {
    this.view = name;
    const p = VIEW_PRESETS[name];
    if (!p) return;
    this.theta = p.theta; this.phi = p.phi;
  }

  setWireframe(on) {
    this.wireframe = on;
    for (const obj of this.sceneGroup.children) {
      if (obj.isMesh && obj.userData.material) {
        obj.material.wireframe = on;
      }
    }
  }

  setGridVisible(on) { this.grid.visible = on; }

  applyCamera(json) {
    if (!json) return;
    const c = json.camera;
    if (!c) return;
    this.camera.fov = c.fov ?? 42;
    this.camera.near = c.near ?? 0.05;
    this.camera.far = c.far ?? 200;
    if (c.target) this.target.fromArray(c.target);
    const pos = c.position || [3.4, 2.5, 4.2];
    const dx = pos[0] - this.target.x, dy = pos[1] - this.target.y, dz = pos[2] - this.target.z;
    this.radius = Math.max(1.5, Math.sqrt(dx * dx + dy * dy + dz * dz) || 7);
    this.theta = Math.atan2(dz, dx);
    this.phi = Math.acos(Math.max(-1, Math.min(1, dy / this.radius)));
  }

  updateOrbit() {
    const sat = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sat * Math.cos(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sat * Math.sin(this.theta),
    );
    this.camera.lookAt(this.target);
  }

  clearGroup() {
    for (const obj of [...this.sceneGroup.children]) {
      this.sceneGroup.remove(obj);
      obj.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material.dispose(); }
      });
    }
  }

  addNode(jsonNode, parent, materials) {
    if (jsonNode.visible === false) return;
    const group = new THREE.Group();
    group.name = jsonNode.name || jsonNode.id;
    group.position.fromArray(jsonNode.position || [0, 0, 0]);
    if (jsonNode.rotation) {
      const r = jsonNode.rotation;
      group.rotation.set(r[0] || 0, r[1] || 0, r[2] || 0);
    }
    group.scale.fromArray(jsonNode.scale || [1, 1, 1]);
    group.userData = { id: jsonNode.id };
    parent.add(group);

    if (jsonNode.geometry) {
      const geom = jsonNode.geometry;
      const g = geoFor(geom);
      if (g) {
        let mat;
        if (typeof jsonNode.material === "string") mat = materialFor(materials[jsonNode.material] || { color: "#c8ccd4" });
        else mat = materialFor(jsonNode.material || {});
        mat.wireframe = this.wireframe;
        const mesh = new THREE.Mesh(g, mat);
        mesh.userData = { id: jsonNode.id, materialId: jsonNode.material };
        if (geom.kind === "ellipsoid") {
          const p = geom.params || {};
          mesh.scale.set(p.rx ?? 1, p.ry ?? 1, p.rz ?? 1);
        } else if (geom.kind === "disk") {
          mesh.rotation.x = -Math.PI / 2;
          const p = geom.params || {};
          if (p.flip) mesh.rotation.x = Math.PI / 2;
          if (p.y) mesh.position.y = p.y;
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
    for (const child of jsonNode.children || []) this.addNode(child, group, materials);
  }

  setState(sceneJson) {
    if (!sceneJson) return;
    this.clearGroup();
    const mats = sceneJson.materials || {};
    this.addNode(sceneJson.root || { children: [] }, this.sceneGroup, mats);

    // background gradient
    if (this.backgroundMesh) { this.scene.remove(this.backgroundMesh); this.backgroundMesh = null; }
    const bg = sceneJson.background;
    if (bg) {
      const tex = gradientTexture(bg.top, bg.bottom);
      this.backgroundMesh = new THREE.Mesh(new THREE.SphereGeometry(160, 16, 12), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
      this.scene.add(this.backgroundMesh);
    }

    // lights
    for (const l of [...this.scene.children]) if (l.isLight || l.userData.light) this.scene.remove(l);
    const lights = sceneJson.lights || [
      { type: "directional", direction: [-1.1, -1.7, -1.2], color: "#fff4e6", intensity: 1.5 },
      { type: "directional", direction: [1.4, -0.4, 0.9], color: "#6fa8ff", intensity: 0.5 },
      { type: "point", position: [2.4, 2.6, 2.2], color: "#ffffff", intensity: 40 },
    ];
    const hemi = new THREE.HemisphereLight(0x8899bb, 0x1c2230, 0.45);
    this.scene.add(hemi);
    for (const l of lights) {
      if (l.type === "directional") {
        const d = l.direction || [-1, -1, -1];
        const light = new THREE.DirectionalLight(l.color || 0xffffff, l.intensity ?? 1.2);
        light.position.set(-d[0], -d[1], -d[2]);
        this.scene.add(light);
      } else if (l.type === "point") {
        const light = new THREE.PointLight(l.color || 0xffffff, l.intensity ?? 20, 0, 0);
        light.position.fromArray(l.position || [2, 3, 2]);
        this.scene.add(light);
      }
    }

    // ground
    const groundJson = sceneJson.ground;
    for (const g of [...this.scene.children]) if (g.isMesh && g.userData.ground) this.scene.remove(g);
    if (groundJson) {
      const size = groundJson.size || 30;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(groundJson.color || "#232833"), roughness: 0.95, metalness: 0 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = groundJson.y || 0;
      ground.receiveShadow = true;
      ground.userData.ground = true;
      this.scene.add(ground);
    }

    this.applyCamera(sceneJson);
  }

  resize() {
    const w = this.canvas.clientWidth || this.canvas.parentElement.clientWidth;
    const h = this.canvas.clientHeight || this.canvas.parentElement.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.updateOrbit();
    this.grid.position.set(this.target.x, this.target.y > 0 ? Math.min(this.target.y, 0.01) : 0, this.target.z);
    this.renderer.render(this.scene, this.camera);
  }
}