// Synthesized instruments. Each voice renders ONE note (a MIDI number) into samples in [-1, 1] (peak 0.9), with no
// audio context needed (pure functions, so they are tested in Node). The player caches one buffer per voice and pitch.

const SAMPLE_RATE_FALLBACK = 44100;
const midiFreq = (m) => 440 * 2 ** ((m - 69) / 12);

/**
 * One piano note as samples in [-1, 1] (peak 0.9). Pure: no audio context needed.
 * @param m MIDI note number
 * @param rate sample rate
 */
export function pianoSamples(m, rate = SAMPLE_RATE_FALLBACK) {
  const f0 = midiFreq(m);
  // low notes ring for seconds, high notes are over quickly
  const tau = Math.min(5, Math.max(0.5, 3.4 * 2 ** (-(m - 48) / 17)));
  const seconds = Math.min(5, tau * 2.6);
  const n = Math.floor(rate * seconds);
  const out = new Float32Array(n);
  const bright = 0.6 + 0.4 * Math.min(1, Math.max(0, (m - 36) / 48)); // high notes keep more of their upper partials
  const inharm = 0.00008 * 2 ** (Math.max(0, m - 40) / 14); // stiffness: upper partials sit a little sharp

  // each partial is a rotating phasor with two decaying envelopes (no sin / exp per sample: this runs on phones)
  for (let k = 1; k <= 12; k++) {
    const f = k * f0 * Math.sqrt(1 + inharm * k * k);
    if (f > rate * 0.45) break;
    const strike = Math.abs(Math.sin((Math.PI * k) / 7)); // hammer hits one seventh along the string
    const amp = (strike * bright ** (k - 1)) / k ** 0.85;
    if (amp < 0.01) continue;
    const kf = Math.exp(-1 / (rate * (tau / (1.5 + 1.1 * (k - 1))))); // upper partials fade first
    const ks = Math.exp(-1 / (rate * (tau / (0.7 + 0.45 * (k - 1)))));
    // two strings a hair apart (the slow beating of a real piano) for the low partials, one for the rest
    const detunes = k <= 3 ? [-0.00022, 0.00022] : [0];
    for (const d of detunes) {
      const w = (2 * Math.PI * f * (1 + d)) / rate;
      const [cw, sw] = [Math.cos(w), Math.sin(w)];
      const ph = (k * 1.7 + d * 1000) % (2 * Math.PI);
      let [sn, cs] = [Math.sin(ph), Math.cos(ph)];
      let [ef, es] = [0.65, 0.35];
      const g = amp / detunes.length;
      for (let i = 0; i < n; i++) {
        out[i] += g * (ef + es) * sn;
        [sn, cs] = [sn * cw + cs * sw, cs * cw - sn * sw];
        ef *= kf;
        es *= ks;
      }
    }
  }

  // hammer knock: a few milliseconds of low-passed noise
  let lp = 0;
  let seed = (m * 2654435761) >>> 0;
  const knock = Math.min(n, Math.floor(rate * 0.04));
  for (let i = 0; i < knock; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    lp += 0.25 * ((seed / 4294967296) * 2 - 1 - lp);
    out[i] += 0.35 * lp * Math.exp(-i / (rate * 0.006));
  }

  // a long ring that is cut at the end of the buffer fades out instead of clicking
  const tail = Math.min(n, Math.floor(rate * 0.4));
  for (let i = 0; i < tail; i++) out[n - 1 - i] *= i / tail;

  // soft attack so there is no click, then normalise
  const attack = Math.floor(rate * 0.002);
  for (let i = 0; i < attack; i++) out[i] *= i / attack;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak ? 0.9 / peak : 1;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

const TWO_PI = 2 * Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Seconds a note rings: long for low notes, short for high ones (`base` seconds at middle C, halving every `per` semitones). */
const ring = (m, base, per, lo, hi) => clamp(base * 2 ** (-(m - 60) / per), lo, hi);

/** Deterministic noise in [-1, 1]. */
function noise(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** Attack ramp, fade at the end (so a cut-off ring does not click), then normalise to 0.9. */
function finish(out, rate, attack = 0.002, tail = 0.3) {
  const n = out.length;
  const a = Math.floor(rate * attack);
  for (let i = 0; i < a; i++) out[i] *= i / a;
  const t = Math.min(n, Math.floor(rate * tail));
  for (let i = 0; i < t; i++) out[n - 1 - i] *= i / t;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak ? 0.9 / peak : 1;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/** One-pole low-pass, in place. */
function lowpass(out, rate, fc) {
  const a = 1 - Math.exp((-TWO_PI * fc) / rate);
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    y += a * (out[i] - y);
    out[i] = y;
  }
}

/** Add a sine partial that dies away as exp(-t / tau). A phasor and a running factor: no sin / exp per sample. */
function partial(out, rate, f, amp, tau, phase = 0) {
  if (f <= 0 || f > rate * 0.45 || amp <= 0) return;
  const w = (TWO_PI * f) / rate;
  const [cw, sw] = [Math.cos(w), Math.sin(w)];
  let [s, c] = [Math.sin(phase), Math.cos(phase)];
  const k = Math.exp(-1 / (rate * tau));
  let e = amp;
  for (let i = 0; i < out.length; i++) {
    out[i] += e * s;
    [s, c] = [s * cw + c * sw, c * cw - s * sw];
    e *= k;
  }
}

/** A short burst of noise at the start: the hammer / pick / mallet. */
function click(out, rate, amp, ms, seed, bright = false) {
  const r = noise(seed);
  const n = Math.min(out.length, Math.floor((rate * ms) / 1000));
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const x = r();
    lp += 0.3 * (x - lp);
    out[i] += amp * (bright ? x : lp) * Math.exp((-3 * i) / n);
  }
}



// ---------------------------------------------------------------------------------------------------------------------
// the other nine voices

/** 2 · Felt: a soft, mellow upright: few partials, a slow attack, dark. */
function felt(m, rate) {
  const f0 = midiFreq(m);
  const tau = ring(m, 2.4, 20, 0.5, 4);
  const out = new Float32Array(Math.floor(rate * Math.min(4, tau * 2.6)));
  [[1, 1, 1], [2, 0.38, 0.55], [3, 0.14, 0.35], [4, 0.05, 0.25], [5, 0.02, 0.2]].forEach(([k, a, d]) => partial(out, rate, f0 * k, a, tau * d, k * 0.7));
  lowpass(out, rate, clamp(f0 * 4, 600, 2200));
  return finish(out, rate, 0.009);
}

/** 3 · Honky-tonk: three strings out of tune with each other and bright, like a saloon upright. */
function honky(m, rate) {
  const f0 = midiFreq(m);
  const tau = ring(m, 1.7, 20, 0.35, 2.6);
  const out = new Float32Array(Math.floor(rate * Math.min(3, tau * 2.8)));
  for (let k = 1; k <= 10; k++) for (const d of [-0.0065, 0, 0.0065]) partial(out, rate, f0 * k * (1 + d), 1 / k ** 0.55, tau / (1 + 0.5 * (k - 1)), k + d * 400);
  click(out, rate, 0.5, 14, m, true);
  return finish(out, rate);
}

/** 4 · Electric piano (FM, Rhodes-like): a carrier bent by a modulator whose depth falls away, plus a tine ping. */
function ep(m, rate) {
  const f0 = midiFreq(m);
  const tau = ring(m, 2.4, 22, 0.5, 3.2);
  const out = new Float32Array(Math.floor(rate * Math.min(3.2, tau * 2.6)));
  const w = (TWO_PI * f0) / rate;
  const tine = f0 * 7 < rate * 0.45;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const index = 0.35 + 2.4 * Math.exp(-t / 0.3);
    out[i] = Math.exp(-t / tau) * Math.sin(w * i + index * Math.sin(w * i)) + (tine ? 0.18 * Math.exp(-t / 0.06) * Math.sin(w * 7 * i) : 0);
  }
  return finish(out, rate, 0.003);
}

/** 5 · Wurlitzer: reed-like odd and even partials, a little tremolo and a soft growl. */
function wurli(m, rate) {
  const f0 = midiFreq(m);
  const tau = ring(m, 1.9, 22, 0.4, 2.8);
  const out = new Float32Array(Math.floor(rate * Math.min(2.8, tau * 2.6)));
  [1, 0.62, 0.34, 0.22, 0.12, 0.09, 0.05, 0.03].forEach((a, i) => partial(out, rate, f0 * (i + 1), a, tau / (1 + 0.6 * i), i));
  lowpass(out, rate, clamp(f0 * 6, 900, 3500));
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(1.8 * out[i]) * (1 + 0.18 * Math.sin((TWO_PI * 5.2 * i) / rate));
  return finish(out, rate, 0.004);
}

/**
 * Karplus-Strong plucked string: a burst of noise looping through a short, damped delay line (a harp, a guitar, a
 * clavichord). opts: pluck (0..1, how bright the burst is), damp (per round trip, number or fn of the note), len
 * (ring seconds: [base, per, lo, hi]), lp (fn of the note's Hz: a body / tone filter), click ([amp, ms, bright]).
 */
function ksVoice(opts = {}) {
  const { pluck = 0.55, damp = (m) => 0.9965 - 0.002 * clamp((m - 36) / 60, 0, 1), len = [3.2, 24, 0.8, 3.6], lp = null, click: pick = null } = opts;
  return (m, rate) => {
    const f0 = midiFreq(m);
    const out = new Float32Array(Math.floor(rate * ring(m, ...len)));
    const L = rate / f0;
    // the loop reads the two samples N and N-1 back (their average is N - 0.5 back), so N - 0.5 + d = L
    const N = Math.max(2, Math.floor(L + 0.5));
    const d = clamp(L + 0.5 - N, 0.01, 0.99);
    const a = (1 - d) / (1 + d); // all-pass: the fraction of a sample the delay line cannot do, so the pitch is exact
    const buf = new Float32Array(N);
    const r = noise(m * 7 + 1);
    let y = 0;
    for (let j = 0; j < N; j++) buf[j] = y += pluck * (r() - y);
    const g = typeof damp === 'function' ? damp(m) : damp;
    let [p, zx, zy] = [0, 0, 0];
    for (let i = 0; i < out.length; i++) {
      const avg = 0.5 * (buf[p] + buf[(p + 1) % N]) * g;
      const v = a * avg + zx - a * zy;
      zx = avg;
      zy = v;
      buf[p] = v;
      p = (p + 1) % N;
      out[i] = v;
    }
    if (lp) lowpass(out, rate, clamp(lp(f0), 200, rate * 0.45));
    if (pick) click(out, rate, pick[0], pick[1], m + 13, pick[2]);
    return finish(out, rate, 0.001);
  };
}
/** 6 · Plucked string. */
const ks = ksVoice();

/** 7 · Harpsichord: bright saw-like partials, a pick, a quick decay, and the octave register on top. */
function harpsi(m, rate) {
  const f0 = midiFreq(m);
  const tau = ring(m, 0.55, 30, 0.25, 0.9);
  const out = new Float32Array(Math.floor(rate * 1.7));
  for (let k = 1; k <= 11; k++) {
    partial(out, rate, f0 * k, 1 / k, tau / (1 + 0.3 * k), k);
    if (k <= 5) partial(out, rate, f0 * 2 * k, 0.35 / k, tau / (1 + 0.3 * k), k * 2); // the 4' register: an octave up
  }
  lowpass(out, rate, 4000);
  click(out, rate, 0.4, 6, m + 3, true);
  return finish(out, rate, 0.001);
}

/** 8 · Celesta: bell-like partials (not whole multiples), bright and short. */
function celesta(m, rate) {
  const f0 = midiFreq(m);
  const base = ring(m, 1.6, 28, 0.35, 2.4);
  const out = new Float32Array(Math.floor(rate * Math.min(2.6, base * 2.8)));
  [[1, 1, 1], [2.76, 0.4, 0.45], [5.4, 0.2, 0.22], [8.93, 0.08, 0.1]].forEach(([k, a, d], i) => partial(out, rate, f0 * k, a, base * d, i));
  click(out, rate, 0.25, 3, m + 5);
  return finish(out, rate, 0.001);
}

/** 9 · Vibraphone: a sine with a high overtone, the motor's slow tremolo, a long ring. */
function vibe(m, rate) {
  const f0 = midiFreq(m);
  const base = ring(m, 3, 30, 0.6, 4);
  const out = new Float32Array(Math.floor(rate * Math.min(3.4, base * 2.4)));
  [[1, 1, 1], [4, 0.3, 0.25], [10.1, 0.07, 0.08]].forEach(([k, a, d], i) => partial(out, rate, f0 * k, a, base * d, i));
  for (let i = 0; i < out.length; i++) out[i] *= 1 + 0.3 * Math.sin((TWO_PI * 4.6 * i) / rate);
  return finish(out, rate, 0.004);
}

/** 10 · Toy piano: a few inharmonic metal-bar partials with a plastic click, over almost at once. */
function toy(m, rate) {
  const f0 = midiFreq(m);
  const tau = 0.45;
  const out = new Float32Array(Math.floor(rate * 1.6));
  [[1, 1, 1], [2.01, 0.35, 0.7], [3, 0.45, 0.5], [4.17, 0.3, 0.35], [6.3, 0.15, 0.2]].forEach(([k, a, d], i) => {
    partial(out, rate, f0 * k, a, tau * d, i);
    partial(out, rate, f0 * k * 1.004, a * 0.6, tau * d, i + 1);
  });
  click(out, rate, 0.5, 8, m + 9, true);
  return finish(out, rate, 0.001);
}

// ---------------------------------------------------------------------------------------------------------------------
// engines: a sound is a set of parameters for one of these

/** A low-pass whose cut-off glides from fc0 to fc1 (exponentially, time constant tau): a filter sweep. */
function sweep(out, rate, [fc0, fc1, tau]) {
  const k = Math.exp(-1 / (rate * tau));
  let e = fc0 - fc1;
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    const x = (TWO_PI * clamp(fc1 + e, 80, rate * 0.4)) / rate;
    y += (x / (1 + x)) * (out[i] - y);
    out[i] = y;
    e *= k;
  }
}

/** Slow rise to full level over about `t` seconds, and amplitude tremolo, and soft clipping: the usual finishing touches. */
function shape(out, rate, spec) {
  if (spec.swell) for (let i = 0; i < out.length; i++) out[i] *= 1 - Math.exp(-i / (rate * spec.swell));
  if (spec.trem) for (let i = 0; i < out.length; i++) out[i] *= 1 + spec.trem[1] * Math.sin((TWO_PI * spec.trem[0] * i) / rate);
  if (spec.drive) for (let i = 0; i < out.length; i++) out[i] = Math.tanh(spec.drive * out[i]);
}

/**
 * Additive engine: a sum of decaying sine partials. spec: ring [base, per, lo, hi] (decay time by pitch) or
 * sustain: true (no decay, `len` seconds); parts [[ratio, amp, decayMult, absTau?]] or n + amp(k) + decay(k);
 * detune (several strings / voices); stiff (string stiffness); lp / sweep (filters); swell, trem, drive; click;
 * attack.
 */
function additive(spec) {
  return (m, rate) => {
    const f0 = midiFreq(m);
    const tau = spec.sustain ? 1e4 : ring(m, ...spec.ring);
    const seconds = spec.sustain ? (spec.len ?? 3.5) : Math.min(spec.maxLen ?? 4.5, tau * (spec.lenMul ?? 2.6));
    const out = new Float32Array(Math.max(1, Math.floor(rate * seconds)));
    const dets = spec.detune ?? [0];
    const stiff = typeof spec.stiff === 'function' ? spec.stiff(m) : (spec.stiff ?? 0);
    const parts = spec.parts ?? Array.from({ length: spec.n }, (_, i) => [i + 1, spec.amp(i + 1), spec.decay ? spec.decay(i + 1) : 1]);
    parts.forEach(([k, a, d = 1, abs], pi) => {
      for (const det of dets) partial(out, rate, f0 * k * Math.sqrt(1 + stiff * k * k) * (1 + det), a / dets.length, abs ?? tau * d, pi * 1.3 + det * 500);
    });
    if (spec.lp) lowpass(out, rate, clamp(spec.lp(f0), 200, rate * 0.45));
    if (spec.sweep) sweep(out, rate, spec.sweep(f0));
    shape(out, rate, spec);
    if (spec.click) click(out, rate, spec.click[0], spec.click[1], m + 11, spec.click[2]);
    return finish(out, rate, spec.attack ?? 0.003);
  };
}

/** FM engine: one carrier bent by a modulator whose depth (index) falls from i0 + i1 to i0; an optional bright tine. */
function fmVoice(spec) {
  return (m, rate) => {
    const f0 = midiFreq(m);
    const tau = ring(m, ...spec.ring);
    const out = new Float32Array(Math.floor(rate * Math.min(spec.maxLen ?? 3.2, tau * 2.6)));
    const w = (TWO_PI * f0) / rate;
    const wm = w * spec.r;
    const [tr, ta, td] = spec.tine ?? [0, 0, 1];
    const tine = tr && f0 * tr < rate * 0.45;
    const [ke, ki, kt] = [Math.exp(-1 / (rate * tau)), Math.exp(-1 / (rate * spec.di)), Math.exp(-1 / (rate * td))];
    let [env, idx, te] = [1, spec.i1, ta];
    for (let i = 0; i < out.length; i++) {
      out[i] = env * Math.sin(w * i + (spec.i0 + idx) * Math.sin(wm * i)) + (tine ? te * Math.sin(w * tr * i) : 0);
      env *= ke;
      idx *= ki;
      te *= kt;
    }
    if (spec.lp) lowpass(out, rate, clamp(spec.lp(f0), 200, rate * 0.45));
    shape(out, rate, spec);
    return finish(out, rate, 0.003);
  };
}

/**
 * Bowed / blown engine: harmonics of a phase that carries vibrato. spec: n, amp(k, f0), detune, vib [Hz, cents, delay],
 * swell (rise time), noise [amp, tone] (breath), lp, len.
 */
function bowed(spec) {
  return (m, rate) => {
    const f0 = midiFreq(m);
    const out = new Float32Array(Math.floor(rate * (spec.len ?? 3.5)));
    const K = Math.min(spec.n, Math.floor((rate * 0.45) / f0));
    const amps = Array.from({ length: K + 1 }, (_, k) => (k ? spec.amp(k, f0) : 0));
    const dets = spec.detune ?? [0];
    for (const det of dets) {
      let phase = det * 900;
      for (let i = 0; i < out.length; i++) {
        const t = i / rate;
        const vib = spec.vib ? Math.sin(TWO_PI * spec.vib[0] * t) * spec.vib[1] * 0.000578 * Math.min(1, t / spec.vib[2]) : 0;
        phase += (TWO_PI * f0 * (1 + det) * (1 + vib)) / rate;
        const [s1, c1] = [Math.sin(phase), Math.cos(phase)];
        let [sk, ck, sum] = [s1, c1, amps[1] * s1];
        for (let k = 2; k <= K; k++) {
          [sk, ck] = [sk * c1 + ck * s1, ck * c1 - sk * s1]; // sin / cos of k * phase without calling sin again
          sum += amps[k] * sk;
        }
        out[i] += sum / dets.length;
      }
    }
    if (spec.noise) {
      const r = noise(m * 3 + 2);
      let y = 0;
      for (let i = 0; i < out.length; i++) {
        y += spec.noise[1] * (r() - y);
        out[i] += spec.noise[0] * y * (1 - Math.exp(-i / (rate * 0.05)));
      }
    }
    if (spec.lp) lowpass(out, rate, clamp(spec.lp(f0), 200, rate * 0.45));
    shape(out, rate, spec);
    return finish(out, rate, 0.01);
  };
}

const stiffness = (m) => 0.00008 * 2 ** (Math.max(0, m - 40) / 14);
/** A vowel: loud near the formant frequencies. */
const formant = (f) => [[650, 110, 1], [1080, 120, 0.7], [2600, 200, 0.3]].reduce((s, [c, w, a]) => s + a * Math.exp(-(((f - c) / w) ** 2)), 0.04);

const SPECS = {
  // pianos
  dark: additive({ ring: [3.4, 17, 0.5, 5], maxLen: 5, n: 12, amp: (k) => 1 / k, decay: (k) => 1 / (1 + 0.9 * (k - 1)), stiff: stiffness, detune: [-0.0002, 0.0002], lp: (f) => clamp(f * 6, 900, 5000), click: [0.25, 25] }),
  bright: additive({ ring: [2.4, 18, 0.35, 3.5], n: 14, amp: (k) => 1 / k ** 0.7, decay: (k) => 1 / (1 + 0.5 * (k - 1)), stiff: stiffness, detune: [-0.0003, 0.0003], click: [0.45, 12, true] }),
  // electric pianos
  dxep: fmVoice({ ring: [2.2, 22, 0.5, 3], r: 1, i0: 1, i1: 3.2, di: 0.18, tine: [14, 0.1, 0.04] }),
  softep: fmVoice({ ring: [2.6, 22, 0.5, 3.2], r: 1, i0: 0.2, i1: 1, di: 0.5, lp: (f) => clamp(f * 5, 800, 2400) }),
  clav: additive({ ring: [0.7, 26, 0.25, 1.2], lenMul: 3, n: 12, amp: (k) => 1 / k ** 0.75, decay: (k) => 1 / (1 + 0.4 * (k - 1)), lp: () => 5500, drive: 1.6, click: [0.5, 6, true] }),
  suitcase: fmVoice({ ring: [3, 22, 0.6, 3.5], r: 1, i0: 0.3, i1: 2, di: 0.3, tine: [7, 0.15, 0.06], trem: [4.8, 0.22] }),
  // mallets and bells
  glock: additive({ ring: [1.4, 28, 0.3, 2.2], parts: [[1, 1, 1], [2.76, 0.5, 0.5], [5.4, 0.4, 0.3], [8.93, 0.3, 0.2], [13.3, 0.2, 0.12]], click: [0.3, 2] }),
  marimba: additive({ ring: [0.9, 24, 0.25, 1.6], parts: [[1, 1, 1], [4, 0.35, 0.3], [10, 0.08, 0.1]], click: [0.35, 5] }),
  xylo: additive({ ring: [0.45, 24, 0.18, 0.8], lenMul: 3, parts: [[1, 1, 0.6], [3, 0.5, 0.3], [6, 0.2, 0.12]], click: [0.5, 4, true] }),
  kalimba: additive({ ring: [1.1, 26, 0.3, 1.8], parts: [[1, 1, 1], [5.8, 0.14, 0.12], [9.7, 0.06, 0.06]], click: [0.25, 3] }),
  tubular: additive({ ring: [3.4, 30, 1, 4.5], lenMul: 1.8, maxLen: 5, parts: [[1, 1, 1], [2, 0.55, 0.8], [3, 0.4, 0.6], [4.2, 0.5, 0.5], [5.4, 0.3, 0.4], [6.8, 0.2, 0.3]], click: [0.2, 2] }),
  // plucked strings
  nylon: ksVoice({ pluck: 0.35, damp: 0.9972, lp: () => 2500 }),
  steel: ksVoice({ pluck: 0.85, damp: 0.9968, len: [3.2, 24, 0.8, 3.6] }),
  harp: ksVoice({ pluck: 0.5, damp: 0.9976, lp: () => 3800, len: [3.6, 24, 1, 4.2] }),
  banjo: ksVoice({ pluck: 0.95, damp: 0.9935, len: [1.6, 24, 0.5, 2], click: [0.4, 5, true] }),
  pizz: ksVoice({ pluck: 0.6, damp: 0.9925, lp: () => 3200, len: [1.4, 24, 0.4, 1.8] }),
  // basses
  upright: ksVoice({ pluck: 0.3, damp: 0.9978, lp: () => 800, len: [2.6, 24, 0.8, 3.2] }),
  ebass: additive({ ring: [1.3, 26, 0.4, 2.2], lenMul: 3, n: 10, amp: (k) => 1 / k ** 0.9, decay: (k) => 1 / (1 + 0.5 * (k - 1)), lp: (f) => clamp(f * 7, 300, 1800), drive: 1.3, click: [0.3, 8] }),
  synbass: additive({ ring: [1.8, 26, 0.5, 2.8], lenMul: 3, n: 12, amp: (k) => 1 / k, sweep: (f) => [f * 14, f * 2.5, 0.22], attack: 0.004 }),
  subbass: additive({ ring: [2.4, 30, 0.6, 3.4], lenMul: 3, parts: [[1, 1, 1], [2, 0.12, 0.6]], attack: 0.01 }),
  // organs and reeds
  organ: additive({ sustain: true, parts: [[0.5, 0.5], [1, 1], [2, 0.8], [3, 0.5], [4, 0.35], [6, 0.3], [8, 0.25]], trem: [6.3, 0.1], click: [0.15, 3], attack: 0.006 }),
  church: additive({ sustain: true, parts: [[0.5, 0.7], [1, 1], [2, 0.7], [3, 0.45], [4, 0.5], [5, 0.3], [6, 0.3], [8, 0.25], [10, 0.12]], detune: [-0.0015, 0.0015], lp: (f) => clamp(f * 9, 1200, 6000), swell: 0.03, attack: 0.03 }),
  harmonium: additive({ sustain: true, n: 10, amp: (k) => 1 / k ** 0.8, trem: [5.4, 0.1], lp: (f) => clamp(f * 6, 1000, 3500), swell: 0.05, attack: 0.02 }),
  accordion: additive({ sustain: true, n: 10, amp: (k) => (k % 2 ? 1 : 0.5) / k ** 0.7, detune: [-0.004, 0, 0.004], trem: [5, 0.06], lp: (f) => clamp(f * 8, 1500, 5000), swell: 0.025, attack: 0.015 }),
  rockorgan: additive({ sustain: true, parts: [[1, 1], [2, 0.5], [3, 0.9], [4, 0.45], [6, 0.3], [2, 0.5, 1, 0.25], [3, 0.6, 1, 0.18]], trem: [6.7, 0.14], drive: 1.6, attack: 0.004 }),
  // synths
  saw: additive({ sustain: true, n: 18, amp: (k) => 1 / k, lp: (f) => clamp(f * 14, 1500, 9000), attack: 0.005 }),
  square: additive({ sustain: true, n: 16, amp: (k) => (k % 2 ? 1 / k : 0), attack: 0.005 }),
  softlead: bowed({ n: 6, amp: (k) => 1 / k ** 1.6, vib: [5.4, 14, 0.25], swell: 0.04 }),
  pluckSyn: additive({ ring: [0.9, 26, 0.3, 1.4], lenMul: 3, n: 14, amp: (k) => 1 / k, decay: (k) => 1 / (1 + 0.9 * (k - 1)), attack: 0.002 }),
  pad: additive({ sustain: true, n: 8, amp: (k) => 1 / k ** 1.2, detune: [-0.005, -0.002, 0.002, 0.005], swell: 0.35, lp: (f) => clamp(f * 4, 600, 3000), attack: 0.01 }),
  chip: additive({ sustain: true, n: 18, amp: (k) => Math.abs(Math.sin(Math.PI * k * 0.25)) / k, attack: 0.001 }),
  supersaw: additive({ sustain: true, n: 8, amp: (k) => 1 / k, detune: [-0.012, -0.006, 0, 0.006, 0.012], lp: (f) => clamp(f * 12, 1500, 8000), swell: 0.02 }),
  glass: additive({ ring: [3, 26, 0.8, 4], lenMul: 2.2, parts: [[1, 1, 1], [2, 0.4, 0.8], [3.01, 0.3, 0.6], [5.04, 0.2, 0.4], [7.1, 0.12, 0.3]], detune: [-0.003, 0.003], swell: 0.15, attack: 0.01 }),
  // strings, winds, voices
  strings: additive({ sustain: true, n: 10, amp: (k) => 1 / k ** 0.9, detune: [-0.007, -0.0025, 0.0025, 0.007], swell: 0.25, lp: (f) => clamp(f * 5, 700, 4000), attack: 0.01 }),
  violin: bowed({ n: 12, amp: (k) => 1 / k ** 0.8, vib: [5.5, 18, 0.25], swell: 0.09, lp: (f) => clamp(f * 7, 1000, 5000) }),
  flute: bowed({ n: 5, amp: (k) => [1, 0.22, 0.07, 0.03, 0.01][k - 1], vib: [5, 9, 0.4], swell: 0.05, noise: [0.05, 0.25] }),
  clarinet: additive({ sustain: true, parts: [[1, 1], [2, 0.03], [3, 0.55], [4, 0.02], [5, 0.4], [6, 0.02], [7, 0.25], [9, 0.15], [11, 0.08]], swell: 0.03, lp: (f) => clamp(f * 9, 1500, 5000) }),
  trumpet: additive({ sustain: true, n: 14, amp: (k) => 1 / k ** 0.7, sweep: (f) => [f * 2, f * 11, 0.07], attack: 0.015 }),
  choir: bowed({ n: 14, amp: (k, f0) => formant(k * f0) / k, detune: [-0.003, 0.003], vib: [5.2, 10, 0.35], swell: 0.15 }),
};

/**
 * The sound menu, in groups. div: 2 = rendered at half the sample rate (soft sounds: half the work, the browser resamples); sustained: holds its level (no decay); unpitched: bells / bars whose pitch cannot be
 * measured by following the waveform (only used by the tests).
 */
export const SOUND_GROUPS = [
  { name: 'Pianos', sounds: [
    { id: 'recorded', name: 'Recorded grand (samples)' },
    { id: 'additive', name: 'Grand (additive)' },
    { id: 'felt', name: 'Felt piano' },
    { id: 'honky', name: 'Honky-tonk' },
    { id: 'dark', name: 'Dark grand' },
    { id: 'bright', name: 'Bright studio piano' },
  ] },
  { name: 'Electric pianos', sounds: [
    { id: 'ep', name: 'Rhodes (FM)' },
    { id: 'wurli', name: 'Wurlitzer' },
    { id: 'dxep', name: 'Bell EP (DX style)' },
    { id: 'softep', name: 'Soft Rhodes' },
    { id: 'clav', name: 'Clavinet', unpitched: true },
    { id: 'suitcase', name: 'Tremolo EP' },
  ] },
  { name: 'Mallets and bells', sounds: [
    { id: 'celesta', name: 'Celesta', unpitched: true },
    { id: 'vibe', name: 'Vibraphone' },
    { id: 'toy', name: 'Toy piano', unpitched: true },
    { id: 'glock', name: 'Glockenspiel', unpitched: true },
    { id: 'marimba', name: 'Marimba' },
    { id: 'xylo', name: 'Xylophone', unpitched: true },
    { id: 'kalimba', name: 'Kalimba', unpitched: true },
    { id: 'tubular', name: 'Tubular bells', unpitched: true },
  ] },
  { name: 'Plucked strings', sounds: [
    { id: 'ks', name: 'Plucked string' },
    { id: 'harpsi', name: 'Harpsichord' },
    { id: 'nylon', name: 'Nylon guitar' },
    { id: 'steel', name: 'Steel guitar' },
    { id: 'harp', name: 'Harp' },
    { id: 'banjo', name: 'Banjo', unpitched: true },
    { id: 'pizz', name: 'Pizzicato strings' },
  ] },
  { name: 'Basses', sounds: [
    { id: 'upright', name: 'Upright bass' },
    { id: 'ebass', name: 'Electric bass' },
    { id: 'synbass', name: 'Synth bass' },
    { id: 'subbass', name: 'Sub bass' },
  ] },
  { name: 'Organs and reeds', sounds: [
    { id: 'organ', name: 'Drawbar organ', sustained: true },
    { id: 'church', name: 'Church organ', div: 2, sustained: true },
    { id: 'harmonium', name: 'Harmonium', div: 2, sustained: true },
    { id: 'accordion', name: 'Accordion', div: 2, sustained: true },
    { id: 'rockorgan', name: 'Rock organ', sustained: true },
  ] },
  { name: 'Synths', sounds: [
    { id: 'saw', name: 'Saw lead', sustained: true },
    { id: 'square', name: 'Square lead', sustained: true },
    { id: 'softlead', name: 'Soft lead', sustained: true },
    { id: 'pluckSyn', name: 'Pluck synth' },
    { id: 'pad', name: 'Warm pad', div: 2, sustained: true },
    { id: 'chip', name: 'Chiptune pulse', sustained: true },
    { id: 'supersaw', name: 'Super saw', div: 2, sustained: true },
    { id: 'glass', name: 'Glass pad', unpitched: true },
  ] },
  { name: 'Strings, winds and voices', sounds: [
    { id: 'strings', name: 'String ensemble', div: 2, sustained: true },
    { id: 'violin', name: 'Violin', sustained: true },
    { id: 'flute', name: 'Flute', sustained: true },
    { id: 'clarinet', name: 'Clarinet', sustained: true },
    { id: 'trumpet', name: 'Trumpet', sustained: true },
    { id: 'choir', name: 'Choir (ooh)', div: 2, sustained: true },
  ] },
];
/** All the sounds in one list. */
export const SOUNDS = SOUND_GROUPS.flatMap((g) => g.sounds);

const VOICES = { additive: pianoSamples, felt, honky, ep, wurli, ks, harpsi, celesta, vibe, toy, ...SPECS };

/** One note of a synthesized voice (`id` from SOUNDS, not 'recorded') as samples at `rate` (see `div` in SOUNDS). */
export function renderVoice(id, m, rate = SAMPLE_RATE_FALLBACK) {
  return (VOICES[id] ?? pianoSamples)(m, rate);
}
