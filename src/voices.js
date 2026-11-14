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

/** 6 · Plucked string (Karplus-Strong): a burst of noise looping through a short, damped delay: a harp / clavichord. */
function ks(m, rate) {
  const f0 = midiFreq(m);
  const out = new Float32Array(Math.floor(rate * clamp(ring(m, 3.2, 24, 0.8, 3.6), 0.8, 3.6)));
  const L = rate / f0;
  // the loop reads the two samples N and N-1 back (their average is N - 0.5 back), so N - 0.5 + d = L
  const N = Math.max(2, Math.floor(L + 0.5));
  const d = clamp(L + 0.5 - N, 0.01, 0.99);
  const a = (1 - d) / (1 + d); // all-pass: the fraction of a sample the delay line cannot do, so the pitch is exact
  const buf = new Float32Array(N);
  const r = noise(m * 7 + 1);
  let y = 0;
  for (let j = 0; j < N; j++) buf[j] = y += 0.55 * (r() - y); // a soft pluck
  const damp = 0.9965 - 0.002 * clamp((m - 36) / 60, 0, 1);
  let [p, zx, zy] = [0, 0, 0];
  for (let i = 0; i < out.length; i++) {
    const avg = 0.5 * (buf[p] + buf[(p + 1) % N]) * damp;
    const v = a * avg + zx - a * zy;
    zx = avg;
    zy = v;
    buf[p] = v;
    p = (p + 1) % N;
    out[i] = v;
  }
  return finish(out, rate, 0.001);
}

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

/** The choices of the sound menu (the first one is the recorded piano, played from sounds/piano). */
export const SOUNDS = [
  { id: 'recorded', name: 'Recorded piano (samples)' },
  { id: 'additive', name: '1 · Grand (additive synth)' },
  { id: 'felt', name: '2 · Felt piano (soft, mellow)' },
  { id: 'honky', name: '3 · Honky-tonk (bright, detuned)' },
  { id: 'ep', name: '4 · Electric piano (FM, Rhodes)' },
  { id: 'wurli', name: '5 · Wurlitzer (reed)' },
  { id: 'ks', name: '6 · Plucked string (Karplus-Strong)' },
  { id: 'harpsi', name: '7 · Harpsichord' },
  { id: 'celesta', name: '8 · Celesta (bells)' },
  { id: 'vibe', name: '9 · Vibraphone' },
  { id: 'toy', name: '10 · Toy piano' },
];

const VOICES = { additive: pianoSamples, felt, honky, ep, wurli, ks, harpsi, celesta, vibe, toy };

/** One note of a synthesized voice (`id` from SOUNDS, not 'recorded') as samples. */
export function renderVoice(id, m, rate = SAMPLE_RATE_FALLBACK) {
  return (VOICES[id] ?? pianoSamples)(m, rate);
}
