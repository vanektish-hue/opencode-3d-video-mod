// Print an ASCII preview of a PNG (downsampled luminance) so the shape can be
// checked in a text-only environment.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

function decodePNG(buf) {
  let pos = 8;
  let width, height, colorType;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

const file = process.argv[2] || "exports/computer-mouse.png";
const cols = Number(process.argv[3] || 96);
const img = decodePNG(readFileSync(file));
const rows = Math.max(1, Math.round((cols * img.height) / img.width / 2));
const ramp = " .:-=+*#%@";
let text = "";
for (let r = 0; r < rows; r++) {
  let line = "";
  for (let c = 0; c < cols; c++) {
    const x0 = Math.floor((c * img.width) / cols);
    const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * img.width) / cols));
    const y0 = Math.floor((r * img.height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * img.height) / rows));
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * img.channels;
        sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
        n++;
      }
    }
    const v = sum / n / 255;
    line += ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
  }
  text += line + "\n";
}
console.log(`${file} ${img.width}x${img.height}`);
console.log(text);
