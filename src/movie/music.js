// Procedural music bed + sound effects, synthesized into Float32 buffers.
// No external assets, no licensing worries — everything is generated maths.

const TAU = Math.PI * 2;

function note(freq, t) {
  return Math.sin(TAU * freq * t);
}

/** Add an enveloped tone into a stereo pair. */
function addTone(L, R, sr, start, dur, freq, amp, opts = {}) {
  const { attack = 0.01, release = 0.25, decay = 0, pan = 0, detune = 0, partials = [1] } = opts;
  const i0 = Math.max(0, Math.floor(start * sr));
  const i1 = Math.min(L.length, Math.floor((start + dur) * sr));
  const pl = Math.cos((pan + 1) * Math.PI / 4);
  const pr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / sr;
    const life = t / dur;
    let env = 1;
    if (t < attack) env = t / attack;
    else if (t > dur - release) env = Math.max(0, (dur - t) / release);
    if (decay > 0) env *= Math.exp(-decay * t);
    let s = 0;
    for (const p of partials) {
      s += Math.sin(TAU * freq * p * (i / sr) + detune * p);
    }
    s = (s / partials.length) * env * amp;
    L[i] += s * pl;
    R[i] += s * pr;
  }
}

function addNoiseBurst(L, R, sr, start, dur, amp, opts = {}) {
  const { decay = 8, hp = 0, pan = 0 } = opts;
  const i0 = Math.max(0, Math.floor(start * sr));
  const i1 = Math.min(L.length, Math.floor((start + dur) * sr));
  const pl = Math.cos((pan + 1) * Math.PI / 4);
  const pr = Math.sin((pan + 1) * Math.PI / 4);
  let prev = 0;
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / sr;
    const env = Math.exp(-decay * t);
    let n = Math.random() * 2 - 1;
    // crude high-pass
    const h = n - prev;
    prev = n;
    n = hp > 0 ? h : n;
    const s = n * env * amp * Math.min(1, t / 0.002);
    L[i] += s * pl;
    R[i] += s * pr;
  }
}

/** A gentle lo-fi chord-bed: Am - F - C - G, with bass, plucks and soft drums. */
export function synthMusic(duration, sr = 48000, opts = {}) {
  const { intensity = 1 } = opts;
  const N = Math.ceil(duration * sr) + sr;
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  const bpm = 82;
  const beat = 60 / bpm;
  const bar = beat * 4;
  // A minor: Am, F, C, G — frequencies (root, third, fifth) across two octaves
  const prog = [
    { root: 110.0, notes: [220.0, 261.63, 329.63] }, // Am
    { root: 87.31, notes: [174.61, 220.0, 261.63] }, // F
    { root: 130.81, notes: [196.0, 261.63, 329.63] }, // C
    { root: 98.0, notes: [196.0, 246.94, 293.66] }, // G
  ];
  const pent = [440.0, 523.25, 587.33, 659.25, 783.99];

  const bars = Math.ceil(duration / bar) + 1;
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const ch = prog[b % prog.length];
    // pad: chord tones, long and soft
    ch.notes.forEach((f, k) => {
      addTone(L, R, sr, t0, bar * 1.02, f, 0.028 * intensity, {
        attack: 0.6, release: 0.8, pan: k % 2 ? 0.25 : -0.25, detune: k * 0.6,
        partials: [1, 2],
      });
      addTone(L, R, sr, t0, bar * 1.02, f / 2, 0.02 * intensity, { attack: 0.8, release: 0.9, pan: -0.1, partials: [1] });
    });
    // bass pluck on beats 1 and 3
    addTone(L, R, sr, t0, beat * 1.5, ch.root / 2, 0.09 * intensity, { decay: 3.2, attack: 0.005, release: 0.1, partials: [1, 2] });
    addTone(L, R, sr, t0 + beat * 2, beat * 1.3, ch.root / 2, 0.07 * intensity, { decay: 3.6, attack: 0.005, release: 0.1, partials: [1, 2] });
    // arpeggio plucks (eighths)
    for (let e = 0; e < 8; e++) {
      if ((e + b) % 3 === 0) continue; // leave space
      const f = pent[(e * 3 + b) % pent.length] * (e % 4 === 3 ? 0.5 : 1);
      addTone(L, R, sr, t0 + e * (beat / 2), 0.42, f, 0.022 * intensity, {
        decay: 6.5, attack: 0.004, release: 0.08, pan: e % 2 ? 0.4 : -0.4, partials: [1, 2, 3],
      });
    }
    // soft kick on 1 and 3
    addTone(L, R, sr, t0, 0.18, 55, 0.16 * intensity, { decay: 16, attack: 0.002, release: 0.05, partials: [1] });
    addTone(L, R, sr, t0 + beat * 2, 0.18, 55, 0.12 * intensity, { decay: 16, attack: 0.002, release: 0.05, partials: [1] });
    // hat on offbeats
    for (let e = 1; e < 8; e += 2) addNoiseBurst(L, R, sr, t0 + e * (beat / 2), 0.05, 0.018 * intensity, { decay: 40, hp: 1 });
  }

  // simple stereo widening (haas) + gentle low-pass via averaging
  const outL = new Float32Array(N);
  const outR = new Float32Array(N);
  const d = Math.floor(0.012 * sr);
  for (let i = 0; i < N; i++) {
    outL[i] = L[i];
    outR[i] = R[i] + (i >= d ? R[i - d] * 0.22 : 0);
  }
  return { left: outL, right: outR, length: N };
}

/** A rising/falling whoosh for scene transitions. */
export function synthWhoosh(sr = 48000, dur = 0.7) {
  const N = Math.ceil(dur * sr);
  const out = new Float32Array(N);
  let lp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    const f = t / dur; // 0..1
    const env = Math.sin(Math.PI * f) ** 1.5;
    const cutoff = 0.02 + 0.5 * Math.sin(Math.PI * f);
    const n = Math.random() * 2 - 1;
    lp += cutoff * (n - lp);
    out[i] = lp * env * 0.5;
  }
  return out;
}

/** A bright ping for chapter changes. */
export function synthDing(sr = 48000, dur = 0.9) {
  const N = Math.ceil(dur * sr);
  const out = new Float32Array(N);
  const parts = [880, 1318.5, 1760];
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    let s = 0;
    parts.forEach((f, k) => { s += Math.sin(TAU * f * t) * Math.exp(-5 * t) * (1 - k * 0.25); });
    out[i] = s * 0.22;
  }
  return out;
}

/** A short "riser" leading into the ad. */
export function synthRiser(sr = 48000, dur = 1.6) {
  const N = Math.ceil(dur * sr);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    const f = t / dur;
    const env = f ** 2;
    const freq = 200 + 900 * f * f;
    const s = Math.sin(TAU * freq * t) * 0.5 + (Math.random() * 2 - 1) * 0.08;
    out[i] = s * env;
  }
  return out;
}
