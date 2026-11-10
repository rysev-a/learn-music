// Score format (JSON):
// {
//   "version": 1,
//   "title": "Ode to Joy",
//   "clef": "treble" | "bass",
//   "key": "C" | "G" | "D" | ... (major keys),
//   "time": "4/4",
//   "tempo": 90,
//   "notes": [ { "pitch": "E4", "dur": "q" }, { "pitch": "r", "dur": "h" }, { "pitch": "G4", "dur": "q", "dot": true } ],
//   "voice2": [ ... ]   // optional second voice on the same staff, same note format (stems down)
// }
// pitch: scientific notation, letter + optional "#" / "b" + octave ("F#5", "Bb3"); "r" is a rest.
// dur:   "w" whole, "h" half, "q" quarter, "e" eighth.
// dot:   optional, true = dotted note (lasts 1.5x as long).
// key:   major ("C", "Bb") or minor ("Am", "F#m") - a key only sets the key signature.
// Both voices start at beat 0 and play together; fill gaps with rests.
// Bars are not stored: they are computed from the time signature.
// Accidentals are the *sounding* pitch; the renderer decides which signs to draw.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const REST = 'r';

export const DURATIONS = {
  w: { beats: 4, name: 'whole' },
  h: { beats: 2, name: 'half' },
  q: { beats: 1, name: 'quarter' },
  e: { beats: 0.5, name: 'eighth' },
};

export const CLEFS = {
  treble: { bottom: 'E4' },
  bass: { bottom: 'G2' },
};

// key -> number of sharps (negative = flats)
export const KEYS = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5,
  Am: 0, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, Dm: -1, Gm: -2, Cm: -3, Fm: -4, Bbm: -5,
};
export const TIMES = ['2/4', '3/4', '4/4', '3/8', '6/8'];

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

export function parsePitch(str) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(str ?? '');
  if (!m) return null;
  return { letter: m[1], acc: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]) };
}

export function formatPitch({ letter, acc, octave }) {
  return letter + (acc > 0 ? '#' : acc < 0 ? 'b' : '') + octave;
}

/** Position on the staff ignoring accidentals: C0 = 0, D0 = 1, ... */
export const diatonic = (p) => p.octave * 7 + LETTERS.indexOf(p.letter);

export const fromDiatonic = (dia, acc = 0) => ({
  letter: LETTERS[((dia % 7) + 7) % 7],
  octave: Math.floor(dia / 7),
  acc,
});

export const midi = (p) => 12 * (p.octave + 1) + SEMITONES[p.letter] + p.acc;

export function keySignature(key) {
  const n = KEYS[key] ?? 0;
  return n >= 0 ? { acc: 1, letters: SHARP_ORDER.slice(0, n) } : { acc: -1, letters: FLAT_ORDER.slice(0, -n) };
}

/** { F: 1, C: 1 } for G/D majors etc. */
export function keyAlterations(key) {
  const { acc, letters } = keySignature(key);
  return Object.fromEntries(letters.map((l) => [l, acc]));
}

export const beatsOf = (n) => DURATIONS[n.dur].beats * (n.dot ? 1.5 : 1);
export const durationName = (n) => (n.dot ? 'dotted ' : '') + DURATIONS[n.dur].name;

export function parseTime(str) {
  const m = /^(\d{1,2})\/(2|4|8)$/.exec(str ?? '');
  if (!m || Number(m[1]) < 1) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  return { num, den, beats: (num * 4) / den };
}

export function emptyScore(overrides = {}) {
  return { version: 1, title: 'Untitled', clef: 'treble', key: 'C', time: '4/4', tempo: 90, notes: [], voice2: [], ...overrides };
}

/** Voice 1 is score.notes, voice 2 is score.voice2. */
export const voiceNotes = (score, voice) => (voice === 2 ? score.voice2 ?? [] : score.notes);
export const hasSecondVoice = (score) => (score.voice2?.length ?? 0) > 0;
export const voicesOf = (score) => (hasSecondVoice(score) ? [1, 2] : [1]);

export const barLength = (score) => parseTime(score.time)?.beats ?? 4;

/** [{ start, end }] in beats for each note of a voice. */
export function timeline(notes) {
  let t = 0;
  return notes.map((n) => {
    const start = t;
    t += beatsOf(n);
    return { start, end: t };
  });
}

export const endTime = (notes) => timeline(notes).at(-1)?.end ?? 0;
export const startOf = (notes, index) => timeline(notes)[index]?.start ?? 0;

/** Split one voice into bars by where each note starts. Returns [{ index, notes: [note indexes], beats, length }]. */
export function measures(score, voice = 1) {
  const length = barLength(score);
  const notes = voiceNotes(score, voice);
  const bars = [];
  timeline(notes).forEach(({ start }, i) => {
    const index = Math.floor(start / length + 1e-9);
    let bar = bars.at(-1);
    if (!bar || bar.index !== index) {
      bar = { index, notes: [], beats: 0, length };
      bars.push(bar);
    }
    bar.notes.push(i);
    bar.beats += beatsOf(notes[i]);
  });
  return bars;
}

export function barIssues(score) {
  const issues = [];
  const several = hasSecondVoice(score);
  for (const voice of voicesOf(score)) {
    const prefix = several ? `Voice ${voice}: ` : '';
    const bars = measures(score, voice);
    bars.forEach((m, k) => {
      if (Math.abs(m.beats - m.length) < 1e-9) return;
      const bar = m.index + 1;
      if (m.beats > m.length) {
        issues.push({ voice, bar, type: 'overfull', message: `${prefix}Bar ${bar} has ${m.beats} beats, but ${score.time} allows ${m.length}` });
      } else if (k === bars.length - 1) {
        issues.push({ voice, bar, type: 'incomplete', message: `${prefix}${several ? 'last' : 'Last'} bar is incomplete (${m.beats} of ${m.length} beats)` });
      }
    });
  }
  return issues;
}

/**
 * Validate raw JSON and return a normalized copy.
 * errors  -> the score can't be used; warnings -> usable but suspicious.
 */
export function validateScore(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Score must be a JSON object'], warnings: [], score: null };
  }
  const score = emptyScore({
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    clef: raw.clef ?? 'treble',
    key: raw.key ?? 'C',
    time: raw.time ?? '4/4',
    tempo: raw.tempo ?? 90,
  });
  if (!(score.clef in CLEFS)) errors.push(`clef must be one of: ${Object.keys(CLEFS).join(', ')}`);
  if (!(score.key in KEYS)) errors.push(`key must be one of: ${Object.keys(KEYS).join(', ')}`);
  if (!parseTime(score.time)) errors.push('time must look like "4/4", "3/4" or "6/8"');
  if (!Number.isFinite(score.tempo) || score.tempo < 20 || score.tempo > 300) errors.push('tempo must be a number between 20 and 300');

  const readVoice = (list, name, required) => {
    if (list === undefined && !required) return [];
    if (!Array.isArray(list)) {
      errors.push(`"${name}" must be an array`);
      return [];
    }
    const out = [];
    list.forEach((n, i) => {
      const where = `${name}[${i}]`;
      if (!n || typeof n !== 'object') return errors.push(`${where}: must be an object like { "pitch": "C4", "dur": "q" }`);
      const pitchOk = n.pitch === REST || parsePitch(n.pitch);
      if (!pitchOk) errors.push(`${where}: bad pitch ${JSON.stringify(n.pitch)} (use "C4", "F#5", "Bb3" or "r" for a rest)`);
      if (!(n.dur in DURATIONS)) errors.push(`${where}: bad dur ${JSON.stringify(n.dur)} (use w, h, q or e)`);
      if (n.dot !== undefined && typeof n.dot !== 'boolean') errors.push(`${where}: dot must be true or false`);
      if (pitchOk && n.dur in DURATIONS) out.push({ pitch: n.pitch, dur: n.dur, ...(n.dot === true && { dot: true }) });
    });
    return out;
  };
  score.notes = readVoice(raw.notes, 'notes', true);
  score.voice2 = readVoice(raw.voice2, 'voice2', false);
  const warnings = errors.length ? [] : barIssues(score).map((i) => i.message);
  return { ok: errors.length === 0, errors, warnings, score: errors.length ? null : score };
}

/** Pretty JSON with one note per line. */
export function stringifyScore(s) {
  const head = { version: s.version, title: s.title, clef: s.clef, key: s.key, time: s.time, tempo: s.tempo };
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const list = (notes) => {
    const rows = notes.map((n) => `    ${JSON.stringify({ pitch: n.pitch, dur: n.dur, ...(n.dot && { dot: true }) })}`).join(',\n');
    return `[${rows ? `\n${rows}\n  ` : ''}]`;
  };
  const second = s.voice2?.length ? `,\n  "voice2": ${list(s.voice2)}` : '';
  return `{\n${lines.join(',\n')},\n  "notes": ${list(s.notes)}${second}\n}`;
}

/** "E4q C#5e. rh" -> notes. pitch + duration letter (+ "." for dotted); "r" = rest. */
export function parseNotes(text) {
  return text.trim().split(/\s+/).map((tok) => {
    const m = /^([A-G][#b]?\d|r)([whqe])(\.?)$/.exec(tok);
    if (!m) throw new Error(`bad note token ${tok}`);
    return { pitch: m[1], dur: m[2], ...(m[3] && { dot: true }) };
  });
}

export function noteLabel(n) {
  const d = durationName(n);
  return n.pitch === REST ? `${d} rest` : `${n.pitch} ${d}`;
}
