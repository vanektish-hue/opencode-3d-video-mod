// glTF 2.0 / GLB exporter. Writes one mesh per node with PBR materials.
import { getMesh, resolveMaterial } from "./scene.js";

function hexToLinear(hex) {
  const h = String(hex || "#ffffff").replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  const srgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const lin = srgb.map((c) => Math.pow(c, 2.2));
  return lin;
}

function eulerToQuat(rx, ry, rz) {
  const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
  // q = qz * qy * qx  (matches matrix Rz*Ry*Rx)
  const qx = { x: sx, y: 0, z: 0, w: cx };
  const qy = { x: 0, y: sy, z: 0, w: cy };
  const qz = { x: 0, y: 0, z: sz, w: cz };
  const mul = (a, b) => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
  return mul(mul(qz, qy), qx);
}

export function exportGLB(scene) {
  const json = {
    asset: { version: "2.0", generator: "opencode-3d-video-mod" },
    scene: 0,
    scenes: [{ name: scene.name || "scene", nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };

  const binChunks = [];
  let byteOffset = 0;

  const materialIndex = new Map();
  for (const [id, m] of Object.entries(scene.materials || {})) {
    const mat = {
      name: id,
      pbrMetallicRoughness: {
        baseColorFactor: [...hexToLinear(m.color), m.opacity ?? 1],
        metallicFactor: m.metallic ?? 0.1,
        roughnessFactor: m.roughness ?? 0.5,
      },
      emissiveFactor: hexToLinear(m.emissive || "#000000"),
    };
    if ((m.emissiveIntensity ?? 0) > 1) {
      mat.extensions = { KHR_materials_emissive_strength: { emissiveStrength: m.emissiveIntensity } };
      json.extensionsUsed = json.extensionsUsed || [];
      if (!json.extensionsUsed.includes("KHR_materials_emissive_strength")) json.extensionsUsed.push("KHR_materials_emissive_strength");
    }
    materialIndex.set(id, json.materials.length);
    json.materials.push(mat);
  }

  const addBufferView = (buffer, target) => {
    // 4-byte alignment
    while (byteOffset % 4 !== 0) {
      binChunks.push(Buffer.from([0]));
      byteOffset += 1;
    }
    const offset = byteOffset;
    binChunks.push(buffer);
    byteOffset += buffer.length;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buffer.length, ...(target ? { target } : {}) });
    return json.bufferViews.length - 1;
  };

  const addAccessor = (bufferView, componentType, count, type, min, max) => {
    json.accessors.push({ bufferView, componentType, count, type, ...(min ? { min, max } : {}) });
    return json.accessors.length - 1;
  };

  const buildNode = (node, parentIndex) => {
    const nodeIndex = json.nodes.length;
    json.nodes.push({
      name: node.name || node.id,
      translation: node.position || [0, 0, 0],
      scale: node.scale || [1, 1, 1],
      rotation: (() => {
        const q = eulerToQuat(...(node.rotation || [0, 0, 0]));
        return [q.x, q.y, q.z, q.w];
      })(),
    });
    if (parentIndex != null) {
      json.nodes[parentIndex].children = json.nodes[parentIndex].children || [];
      json.nodes[parentIndex].children.push(nodeIndex);
    } else {
      json.scenes[0].nodes.push(nodeIndex);
    }

    if (node.geometry && node.visible !== false) {
      const mesh = getMesh(node.geometry);
      if (mesh) {
        const posBuf = Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength);
        const nrmBuf = Buffer.from(mesh.normals.buffer, mesh.normals.byteOffset, mesh.normals.byteLength);
        const idxBuf = Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);
        const posView = addBufferView(posBuf, 34962);
        const nrmView = addBufferView(nrmBuf, 34962);
        const idxView = addBufferView(idxBuf, 34963);
        // positions min/max
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < mesh.positions.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], mesh.positions[i + k]);
            max[k] = Math.max(max[k], mesh.positions[i + k]);
          }
        }
        const posAcc = addAccessor(posView, 5126, mesh.positions.length / 3, "VEC3", min, max);
        const nrmAcc = addAccessor(nrmView, 5126, mesh.normals.length / 3, "VEC3");
        const idxAcc = addAccessor(idxView, 5125, mesh.indices.length, "SCALAR");
        const matId = typeof node.material === "string" ? node.material : null;
        const material = matId != null && materialIndex.has(matId) ? materialIndex.get(matId) : (json.materials.length ? 0 : undefined);
        json.meshes.push({
          name: node.name || node.id,
          primitives: [{ attributes: { POSITION: posAcc, NORMAL: nrmAcc }, indices: idxAcc, ...(material != null ? { material } : {}) }],
        });
        json.nodes[nodeIndex].mesh = json.meshes.length - 1;
      }
    }

    for (const child of node.children || []) buildNode(child, nodeIndex);
    return nodeIndex;
  };

  buildNode(scene.root, null);

  const bin = Buffer.concat(binChunks);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  json.buffers.push({ byteLength: binPadded.length });

  let jsonStr = JSON.stringify(json);
  while (Buffer.byteLength(jsonStr) % 4 !== 0) jsonStr += " ";
  const jsonBuf = Buffer.from(jsonStr, "utf8");

  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPadded.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.write("JSON", 4, "ascii");

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.write("BIN\0", 4, "ascii");

  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binPadded]);
}

export function exportOBJ(scene) {
  let out = `# opencode-3d-video-mod\n# ${scene.name}\n`;
  let vOffset = 1;
  const collect = (node, parent) => {};
  const walk = (node, matrix) => {
    // Simple: emit geometry in local space with an accompanying group name.
    out += `o ${node.name || node.id}\n`;
    const mesh = node.geometry ? getMesh(node.geometry) : null;
    if (mesh) {
      for (let i = 0; i < mesh.positions.length; i += 3) out += `v ${mesh.positions[i]} ${mesh.positions[i + 1]} ${mesh.positions[i + 2]}\n`;
      for (let i = 0; i < mesh.normals.length; i += 3) out += `vn ${mesh.normals[i]} ${mesh.normals[i + 1]} ${mesh.normals[i + 2]}\n`;
      const vCount = mesh.positions.length / 3;
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = vOffset + mesh.indices[i];
        const b = vOffset + mesh.indices[i + 1];
        const c = vOffset + mesh.indices[i + 2];
        out += `f ${a}//${a} ${b}//${b} ${c}//${c}\n`;
      }
      vOffset += vCount;
    }
    for (const child of node.children || []) walk(child, matrix);
  };
  walk(scene.root, null);
  return out;
}
