import { REST, beatsOf, timeline } from './score.js';

// Editing one voice of a score by time (in beats), so a second voice stays lined up with the first.

const EPS = 1e-9;
const REST_SIZES = [
  { beats: 4, dur: 'w' },
  { beats: 3, dur: 'h', dot: true },
  { beats: 2, dur: 'h' },
  { beats: 1.5, dur: 'q', dot: true },
  { beats: 1, dur: 'q' },
  { beats: 0.5, dur: 'e' },
];

/** Rests that add up to `beats` (longest first). */
export function restsFor(beats) {
  const out = [];
  let left = beats;
  for (const { beats: size, dur, dot } of REST_SIZES) {
    while (left >= size - EPS) {
      out.push({ pitch: REST, dur, ...(dot && { dot: true }) });
      left -= size;
    }
  }
  return out;
}

/**
 * Put `note` at time `t` of a voice, replacing whatever sounds there (the part of an old note that
 * sticks out becomes a rest). Past the end of the voice the gap is filled with rests.
 * @returns the index of the new note
 */
export function placeNote(notes, t, note) {
  const times = timeline(notes);
  const end = times.at(-1)?.end ?? 0;
  if (t >= end - EPS) {
    notes.push(...restsFor(t - end), note);
    return notes.length - 1;
  }
  const stop = t + beatsOf(note);
  const first = times.findIndex((x) => x.end > t + EPS);
  let last = first;
  while (last + 1 < notes.length && times[last + 1].start < stop - EPS) last++;
  const head = times[first].start < t - EPS ? restsFor(t - times[first].start) : [];
  const tail = times[last].end > stop + EPS ? restsFor(times[last].end - stop) : [];
  notes.splice(first, last - first + 1, ...head, note, ...tail);
  return first + head.length;
}

/** Index where a note starting at `t` would be inserted (before the first note that starts at or after t). */
export function insertIndex(notes, t) {
  const i = timeline(notes).findIndex((x) => x.start >= t - EPS);
  return i === -1 ? notes.length : i;
}

/**
 * Remove a note. In the second voice the note becomes a rest (so the following notes keep their time),
 * and rests at the very end are dropped.
 */
export function deleteNote(notes, index, keepTime) {
  if (!keepTime) {
    notes.splice(index, 1);
    return;
  }
  notes[index] = { pitch: REST, dur: notes[index].dur, ...(notes[index].dot && { dot: true }) };
  while (notes.length && notes.at(-1).pitch === REST) notes.pop();
}
