import { REST, beatsOf, midi, parsePitch, voiceNotes, voicesOf } from './score.js';
import { SOUNDS, pianoSamples, renderVoice } from './voices.js';

export { SOUNDS, pianoSamples };

// The sound is the recorded piano in sounds/piano (or one of the synthesized voices in voices.js). Until a recording is loaded (and for keys outside its range) a
// synthesized piano stands in: additive synthesis, every note rendered once into a buffer (a few slightly inharmonic
// partials that die away at their own pace, two strings a hair apart, a soft hammer knock).

// ---- the recorded piano (sounds/piano, 89 keys A0 to Db8) ----

const SAMPLE_DIR = new URL('../sounds/piano/', import.meta.url);
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** File name (without .mp3) of a MIDI note, or null outside the recorded range. */
export const sampleName = (m) => (m >= 21 && m <= 109 ? NAMES[m % 12] + (Math.floor(m / 12) - 1) : null);

let ctx;
let master;
const recorded = new Map(); // midi -> decoded buffer
const pending = new Map(); // midi -> loading promise (or null once it failed)
const synth = new Map(); // 'voice:midi' -> synthesized buffer (the stand-in until a recording is there, and the other voices)

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

let sound = 'recorded';
/** Choose the instrument (an id from SOUNDS). */
export function setSound(id) {
  if (!SOUNDS.some((s) => s.id === id) || id === sound) return;
  sound = id;
  warmSynth();
}

let warming = 0;
/** Render the usual range of the chosen voice in the background, a note per tick, so Play does not stall on a phone. */
function warmSynth() {
  if (sound === 'recorded') return;
  const token = ++warming;
  let c;
  try {
    c = context();
  } catch {
    return;
  }
  const todo = [];
  for (let m = 36; m <= 96; m++) todo.push(m);
  const step = () => {
    const m = todo.shift();
    if (token !== warming || m === undefined) return;
    synthBuffer(c, sound, m);
    setTimeout(step, 4);
  };
  setTimeout(step, 60);
}

/** One synthesized note as a buffer, rendered once per voice and pitch. */
function synthBuffer(c, id, m) {
  const key = `${id}:${m}`;
  let buf = synth.get(key);
  if (!buf) {
    const data = renderVoice(id, m, c.sampleRate);
    buf = c.createBuffer(1, data.length, c.sampleRate);
    buf.copyToChannel(data, 0);
    synth.set(key, buf);
  }
  return buf;
}

function bufferFor(c, pitch) {
  const m = midi(parsePitch(pitch));
  if (sound !== 'recorded') return synthBuffer(c, sound, m);
  const buf = recorded.get(m);
  if (buf) return buf;
  load(c, m); // not there yet: start fetching it, play the synthesized piano this time
  return synthBuffer(c, 'additive', m);
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

/** A short arpeggio in the current sound, to compare the sounds by ear. */
export function demo() {
  try {
    const c = audio();
    ['C4', 'E4', 'G4', 'C5', 'G4'].forEach((p, i) => tone(c, p, c.currentTime + 0.05 + i * 0.26, i === 4 ? 1.2 : 0.5, 0.5));
  } catch {}
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
