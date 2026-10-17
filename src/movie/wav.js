// Minimal PCM WAV writer/reader (16-bit and 32-bit float), mono/stereo.
import { readFileSync, writeFileSync } from "node:fs";

/** samples: Float32Array per channel or a single Float32Array (mono). Returns Buffer. */
export function encodeWav(channels, sampleRate) {
  const chans = Array.isArray(channels) ? channels : [channels];
  const numCh = chans.length;
  const numFrames = chans[0].length;
  const dataBytes = numFrames * numCh * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numCh, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numCh * 2, 28); // byte rate
  buf.writeUInt16LE(numCh * 2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  let off = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      let v = chans[c][i];
      v = v < -1 ? -1 : v > 1 ? 1 : v;
      buf.writeInt16LE(Math.round(v * 32767), off);
      off += 2;
    }
  }
  return buf;
}

export function writeWav(path, channels, sampleRate) {
  writeFileSync(path, encodeWav(channels, sampleRate));
  return path;
}

/** Read a WAV file into { sampleRate, channels: Float32Array[], bits }. */
export function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not RIFF");
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = buf.slice(body, body + size);
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("invalid wav");
  const numCh = fmt.channels;
  const frames = Math.floor(data.length / (numCh * (fmt.bits / 8)));
  const channels = Array.from({ length: numCh }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const p = (i * numCh + c) * (fmt.bits / 8);
      channels[c][i] = fmt.bits === 16 ? data.readInt16LE(p) / 32768 : data.readFloatLE(p);
    }
  }
  return { sampleRate: fmt.sampleRate, channels, bits: fmt.bits };
}
