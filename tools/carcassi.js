import { emptyScore, parseNotes } from '../src/score.js';

// Matteo Carcassi, Etude Op.60 No.1 (Allegro, C major, 4/4), bars 1-41.
// One line per bar, the top voice as written: the guitar bass note that sits in a
// beam counts as the first eighth. Stem-down bass half notes, other rests and the
// chords of the last two bars are left out (the format holds a single voice).
const EIGHTHS = (s) => s.trim().split(/\s+/).map((p) => `${p}e`).join(' ');

const BARS = [
  /*  1 */ EIGHTHS('C4 C5 B4 A4 G4 F4 E4 D4'),
  /*  2 */ EIGHTHS('C4 E5 D5 C5 B4 A4 G4 F4'),
  /*  3 */ EIGHTHS('E4 G5 F5 E5 D5 C5 B4 A4'),
  /*  4 */ EIGHTHS('G4 F#4 E4 D4 C4 B3 A3 D4'),
  /*  5 */ EIGHTHS('G3 G4 F#4 E4 D4 C4 B3 A3'),
  /*  6 */ EIGHTHS('G3 B4 A4 G4 F#4 E4 D4 C4'),
  /*  7 */ EIGHTHS('B3 D5 C5 B4 A4 G4 F4 E4'),
  /*  8 */ EIGHTHS('D4 C4 B3 A3 G3 F4 E4 D4'),
  /*  9 */ EIGHTHS('C4 C5 D5 E5 F5 G5 A5 B5'),
  /* 10 */ EIGHTHS('C6 B5 A5 G5 F5 E5 D5 C5'),
  /* 11 */ EIGHTHS('B4 E3 F#3 G#3 A3 B3 C4 D4'),
  /* 12 */ EIGHTHS('E4 D#4 E4 F4 E4 D4 C4 B3'),
  /* 13 */ EIGHTHS('A3 A4 B4 C5 D5 E5 F#5 G#5'),
  /* 14 */ EIGHTHS('A5 G5 F5 E5 F5 E5 D5 C5'),
  /* 15 */ EIGHTHS('B4 G3 A3 B3 C4 D4 E4 F#4'),
  /* 16 */ EIGHTHS('G4 F#4 G4 A4 G4 F4 E4 D4'),
  /* 17 */ EIGHTHS('C4 C5 D5 E5 F5 E5 D5 C5'),
  /* 18 */ EIGHTHS('B4 G3 B3 D4 G4 F4 E4 D4'),
  /* 19 */ EIGHTHS('C4 E5 F#5 G5 A5 G5 F#5 E5'),
  /* 20 */ EIGHTHS('D#5 B3 D#4 F#4 B4 A4 G4 F#4'),
  /* 21 */ EIGHTHS('E4 G4 B4 E5 D#5 E5 D#5 E5'),
  /* 22 */ EIGHTHS('D4 G4 B4 F5 E5 F5 E5 F5'),
  /* 23 */ EIGHTHS('E5 G5 F5 E5 D5 F5 E5 D5'),
  /* 24 */ EIGHTHS('C5 E5 D5 C5 B4 D5 C5 B4'),
  /* 25 */ EIGHTHS('A4 B4 C5 B4 C5 C#5 D5 C5'),
  /* 26 */ EIGHTHS('D5 E5 F5 E5 D5 C5 B4 A4'),
  /* 27 */ EIGHTHS('G3 G4 A4 B4 C5 D5 E5 F5'),
  /* 28 */ EIGHTHS('G5 G3 B3 D4 G4 F4 E4 D4'),
  /* 29 */ EIGHTHS('C4 G4 C5 E5 G4 B4 D5 G5'),
  /* 30 */ EIGHTHS('C5 E5 G5 C6 G4 B4 D5 G5'),
  /* 31 */ EIGHTHS('C4 G4 C5 E5 F#4 C5 D#5 A5'),
  /* 32 */ EIGHTHS('G4 C5 E5 G5 G4 D5 F5 B5'),
  /* 33 */ EIGHTHS('C5 E5 G5 C6 G4 B4 D5 G5'),
  /* 34 */ EIGHTHS('C4 G4 C5 E5 B3 E4 G#4 D5'),
  /* 35 */ EIGHTHS('A3 E4 A4 C5 F3 F4 A4 D5'),
  /* 36 */ EIGHTHS('G3 E4 G4 C5 G3 D4 G4 B4'),
  /* 37 */ EIGHTHS('C5 C4 D4 E4 F4 G4 A4 B4'),
  /* 38 */ EIGHTHS('C4 C5 D5 E5 F5 G5 A5 B5'),
  /* 39 */ EIGHTHS('C5 C6 B5 A5 G5 F5 E5 D5'),
  /* 40 */ EIGHTHS('C4 C5 B4 A4 G4 F4 E4 D4'),
  /* 41 */ 'C4q rq rh',
];

const exercise = (from, to, name = `bars ${from}-${to}`) => ({
  name: `Carcassi Op.60 No.1, ${name}`,
  label: `No.1 \u00B7 ${name}`,
  score: emptyScore({
    title: `Carcassi Op.60 No.1, ${name}`,
    tempo: 80,
    notes: parseNotes(BARS.slice(from - 1, to).join(' ')),
  }),
});

// the whole etude at once, no splitting into bars
export const CARCASSI = [exercise(1, 41, 'whole etude')];
