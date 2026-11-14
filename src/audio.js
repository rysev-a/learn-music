import { REST, beatsOf, midi, parsePitch, voiceNotes, voicesOf } from './score.js';

// The sound is the recorded piano in sounds/piano. Until a recording is loaded (and for keys outside its range) a
// synthesized piano stands in: additive synthesis, every note rendered once into a buffer (a few slightly inharmonic
// partials that die away at their own pace, two strings a hair apart, a soft hammer knock).

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

// ---- the recorded piano (sounds/piano, 89 keys A0 to Db8) ----

const SAMPLE_DIR = new URL('../sounds/piano/', import.meta.url);
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** File name (without .mp3) of a MIDI note, or null outside the recorded range. */
export const sampleName = (m) => (m >= 21 && m <= 109 ? NAMES[m % 12] + (Math.floor(m / 12) - 1) : null);

let ctx;
let master;
const recorded = new Map(); // midi -> decoded buffer
const pending = new Map(); // midi -> loading promise (or null once it failed)
const synth = new Map(); // midi -> synthesized buffer, used until the recording is there (and outside its range)

function context() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createDynamicsCompressor(); // many notes at once must not clip
    master.threshold.value = -14;
    master.ratio.value = 4;
    master.connect(ctx.destination);
  }
  return ctx;
}

function audio() {
  const c = context();
  c.resume();
  return c;
}

const decode = (c, data) =>
  new Promise((resolve, reject) => {
    const p = c.decodeAudioData(data, resolve, reject); // older Safari only knows the callback form
    p?.then?.(resolve, reject);
  });

/** The recordings are quiet (peaks around 0.08): bring each to the same level. */
function normalise(buf) {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
  const gain = peak ? Math.min(40, 0.8 / peak) : 1;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= gain;
  }
}

function load(c, m) {
  const name = sampleName(m);
  if (!name || pending.get(m) === null) return Promise.resolve(null);
  if (!pending.has(m)) {
    pending.set(
      m,
      fetch(new URL(`${name}.mp3`, SAMPLE_DIR))
        .then((r) => {
          if (!r.ok) throw new Error(`${name}: ${r.status}`);
          return r.arrayBuffer();
        })
        .then((data) => decode(c, data))
        .then((buf) => {
          normalise(buf);
          recorded.set(m, buf);
          return buf;
        })
        .catch(() => {
          pending.set(m, null); // no recording for this key: the synthesized note stays
          return null;
        })
    );
  }
  return pending.get(m);
}

/** Fetch every recording in the background (a few at a time), so the first notes already sound like the piano. */
export function warmUp() {
  let c;
  try {
    c = context();
  } catch {
    return;
  }
  const keys = [];
  for (let m = 21; m <= 109; m++) keys.push(m);
  const worker = async () => {
    while (keys.length) await load(c, keys.shift());
  };
  for (let i = 0; i < 4; i++) worker();
}

function bufferFor(c, pitch) {
  const m = midi(parsePitch(pitch));
  const buf = recorded.get(m);
  if (buf) return buf;
  load(c, m); // not there yet: start fetching it, play the synthesized note this time
  let alt = synth.get(m);
  if (!alt) {
    const data = pianoSamples(m, c.sampleRate);
    alt = c.createBuffer(1, data.length, c.sampleRate);
    alt.copyToChannel(data, 0);
    synth.set(m, alt);
  }
  return alt;
}

/** Strike a key at `start`, let go after `dur` seconds (a short release, so it does not stop with a click). */
function tone(c, pitch, start, dur, volume = 0.5) {
  const src = c.createBufferSource();
  const buf = bufferFor(c, pitch);
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.setValueAtTime(volume, start);
  // let go after the note, but always fade out before the recording runs out
  const off = Math.max(start + 0.05, Math.min(start + Math.max(0.12, dur), start + buf.duration - 0.2));
  gain.gain.setValueAtTime(volume, off);
  gain.gain.linearRampToValueAtTime(0, off + 0.18);
  src.connect(gain).connect(master);
  src.start(start);
  src.stop(off + 0.2);
  return {
    stop() {
      const now = c.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.05);
      try {
        src.stop(now + 0.06);
      } catch {}
    },
  };
}

/** Short preview of a single pitch. */
export function beep(pitch) {
  if (pitch === REST) return;
  try {
    const c = audio();
    tone(c, pitch, c.currentTime, 0.9, 0.55);
  } catch {
    // no sound (no Web Audio, or the browser refused): editing must go on
  }
}

/** Play a whole score (both voices together). Returns a stop() function. onNote(voice, index) fires as each note starts. */
export function playScore(score, { onNote, onEnd } = {}) {
  const c = audio();
  const spb = 60 / score.tempo;
  const t0 = c.currentTime + 0.1;
  let finish = t0;
  const timers = [];
  const voices = [];
  for (const voice of voicesOf(score)) {
    let t = t0;
    voiceNotes(score, voice).forEach((n, i) => {
      const d = beatsOf(n) * spb;
      if (n.pitch !== REST) voices.push(tone(c, n.pitch, t, d, voice === 1 ? 0.5 : 0.4));
      timers.push(setTimeout(() => onNote?.(voice, i), (t - c.currentTime) * 1000));
      t += d;
    });
    finish = Math.max(finish, t);
  }
  timers.push(setTimeout(() => onEnd?.(), (finish - c.currentTime) * 1000));
  return () => {
    timers.forEach(clearTimeout);
    voices.forEach((v) => v.stop());
    onEnd?.();
  };
}
