import { REST, beatsOf, midi, parsePitch, voiceNotes, voicesOf } from './score.js';

let ctx;
const audio = () => {
  ctx ??= new AudioContext();
  ctx.resume();
  return ctx;
};

const freq = (pitch) => 440 * 2 ** ((midi(parsePitch(pitch)) - 69) / 12);

function tone(c, pitch, start, dur) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq(pitch);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.05, dur * 0.95));
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur);
  return osc;
}

/** Short preview of a single pitch. */
export function beep(pitch) {
  if (pitch === REST) return;
  const c = audio();
  tone(c, pitch, c.currentTime, 0.35);
}

/** Play a whole score (both voices together). Returns a stop() function. onNote(voice, index) fires as each note starts. */
export function playScore(score, { onNote, onEnd } = {}) {
  const c = audio();
  const spb = 60 / score.tempo;
  const t0 = c.currentTime + 0.1;
  let finish = t0;
  const timers = [];
  const oscs = [];
  for (const voice of voicesOf(score)) {
    let t = t0;
    voiceNotes(score, voice).forEach((n, i) => {
      const d = beatsOf(n) * spb;
      if (n.pitch !== REST) oscs.push(tone(c, n.pitch, t, d));
      timers.push(setTimeout(() => onNote?.(voice, i), (t - c.currentTime) * 1000));
      t += d;
    });
    finish = Math.max(finish, t);
  }
  timers.push(setTimeout(() => onEnd?.(), (finish - c.currentTime) * 1000));
  return () => {
    timers.forEach(clearTimeout);
    oscs.forEach((o) => {
      try {
        o.stop();
      } catch {}
    });
    onEnd?.();
  };
}
