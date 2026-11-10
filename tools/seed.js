import { emptyScore, parseNotes } from '../src/score.js';
import { CARCASSI } from './carcassi.js';

const seq = parseNotes;

const SONGS = [
  {
    name: 'Ode to Joy (simplified)',
    score: emptyScore({
      title: 'Ode to Joy',
      tempo: 100,
      notes: seq('E4q E4q F4q G4q G4q F4q E4q D4q C4q C4q D4q E4q E4q D4q D4h'),
    }),
  },
  {
    name: 'Twinkle, Twinkle',
    score: emptyScore({
      title: 'Twinkle, Twinkle',
      tempo: 100,
      notes: seq('C4q C4q G4q G4q A4q A4q G4h F4q F4q E4q E4q D4q D4q C4h'),
    }),
  },
  {
    name: 'Waltz with a rest (F major, 3/4)',
    score: emptyScore({
      title: 'Waltz',
      key: 'F',
      time: '3/4',
      notes: seq('C5q A4q F4q G4q A4q Bb4q C5h rq'),
    }),
  },
];

const DRILLS = [
  {
    name: 'G major scale (F#)',
    score: emptyScore({ title: 'G major scale', key: 'G', notes: seq('G4q A4q B4q C5q D5q E5q F#5q G5q') }),
  },
  {
    name: 'Bass clef steps',
    score: emptyScore({ title: 'Bass clef steps', clef: 'bass', notes: seq('C3q D3q E3q F3q G3q A3q B3q C4q') }),
  },
  {
    name: 'Dotted rhythm & beamed eighths',
    score: emptyScore({
      title: 'Dotted rhythm',
      notes: seq('E4q. D4e C4q D4q E4q. E4e E4h D4q. D4e D4h E4e G4e A4e G4e C5h'),
    }),
  },
  {
    name: 'A minor (G#)',
    score: emptyScore({ title: 'A minor', key: 'Am', notes: seq('A4q B4q C5q B4q A4q G#4q A4h') }),
  },
];

// pieces -> exercises; the UI picks a piece, then an exercise from it
export const LIBRARY = [
  { title: 'Carcassi - Etudes Op.60', exercises: CARCASSI },
  { title: 'Simple songs', exercises: SONGS },
  { title: 'Theory drills', exercises: DRILLS },
];

export const SAMPLES = LIBRARY.flatMap((p) => p.exercises);
