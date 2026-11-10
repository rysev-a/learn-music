import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScore, barIssues, measures, stringifyScore, emptyScore } from '../src/score.js';
import { compare } from '../src/checker.js';
import { renderScore, hitTest } from '../src/render.js';
import { readFileSync } from 'node:fs';
import { LIBRARY, allExercises, setLibrary } from '../src/library.js';
import { keyLayout, lookupKey, keyFromCode } from '../src/keyboard.js';
import { placeNote, insertIndex, deleteNote, restsFor } from '../src/edit.js';

assert.ok(setLibrary(JSON.parse(readFileSync(new URL('../init.json', import.meta.url), 'utf8'))), 'init.json is a valid library');
const SAMPLES = allExercises();

const score = (notes, extra = {}) => validateScore({ notes, ...extra }).score;
const q = (pitch) => ({ pitch, dur: 'q' });

test('samples are valid, complete and render', () => {
  for (const s of SAMPLES) {
    const v = validateScore(s.score);
    assert.ok(v.ok, `${s.name}: ${v.errors}`);
    assert.deepEqual(v.warnings, [], s.name);
    assert.match(renderScore(s.score).svg, /^<svg/);
  }
});

test('validator reports bad input', () => {
  const v = validateScore({ clef: 'alto', key: 'H', time: '5/16', notes: [{ pitch: 'H4', dur: 'q' }, { pitch: 'C4', dur: 'x' }, null] });
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 6);
  assert.equal(validateScore([]).ok, false);
});

test('stringify round-trips', () => {
  const s = score([q('C4'), q('F#5'), { pitch: 'r', dur: 'h' }], { key: 'G' });
  assert.deepEqual(validateScore(JSON.parse(stringifyScore(s))).score, s);
  assert.deepEqual(validateScore(JSON.parse(stringifyScore(emptyScore()))).score, emptyScore());
});

test('bars are computed from the time signature', () => {
  const s = score([q('C4'), q('D4'), q('E4'), q('F4'), q('G4')]);
  assert.equal(measures(s).length, 2);
  assert.equal(barIssues(s)[0].type, 'incomplete');
  const over = score([q('C4'), q('C4'), q('C4'), { pitch: 'C4', dur: 'w' }]);
  assert.equal(barIssues(over)[0].type, 'overfull');
});

test('checker: identical -> passed', () => {
  const a = score([q('C4'), q('D4'), q('E4'), q('F4')]);
  const r = compare(a, structuredClone(a));
  assert.equal(r.passed, true);
  assert.equal(r.stats.percent, 100);
});

test('checker: wrong pitch, wrong duration, both', () => {
  const a = score([q('C4'), q('D4'), q('E4')]);
  const b = score([q('C4'), q('E4'), { pitch: 'E4', dur: 'h' }]);
  const r = compare(a, b);
  assert.deepEqual(r.items.map((i) => i.status), ['ok', 'pitch', 'duration']);
  assert.equal(r.passed, false);
});

test('checker: a missing note does not shift the rest into errors', () => {
  const a = score([q('C4'), q('D4'), q('E4'), q('F4')]);
  const b = score([q('C4'), q('E4'), q('F4')]);
  const r = compare(a, b);
  assert.deepEqual(r.items.map((i) => i.status), ['ok', 'missing', 'ok', 'ok']);
  assert.equal(r.byOriginal[1][1], 'missing');
});

test('checker: an extra note is flagged', () => {
  const a = score([q('C4'), q('E4')]);
  const b = score([q('C4'), q('D4'), q('E4')]);
  const r = compare(a, b);
  assert.deepEqual(r.items.map((i) => i.status), ['ok', 'extra', 'ok']);
  assert.equal(r.byMine[1][1], 'extra');
});

test('checker: enharmonic spelling is explained', () => {
  const r = compare(score([q('C#4')]), score([q('Db4')]));
  assert.equal(r.items[0].status, 'pitch');
  assert.match(r.items[0].message, /sounds the same/);
});

test('checker: clef/key/time mismatch is reported', () => {
  const a = score([q('C4')], { key: 'G' });
  const b = score([q('C4')], { clef: 'bass' });
  assert.deepEqual(compare(a, b).meta.length, 2);
});

test('hitTest maps a click to a staff step and insert index', () => {
  const s = score([q('C4'), q('D4'), q('E4'), q('F4')]);
  const { layout } = renderScore(s);
  const sys = layout.systems[0];
  const n1 = layout.pos[1][1];
  const hit = hitTest(layout, n1.x - 5, sys.staffBottom); // bottom line, just left of note 1
  assert.equal(hit.step, 0);
  assert.equal(hit.t, 1); // the slot that starts at beat 1
  assert.equal(hitTest(layout, 9999, sys.staffTop).t, 4); // past the last note: the end
});

test('dotted notes: length, validation and checker', () => {
  const dq = { pitch: 'C4', dur: 'q', dot: true };
  const s = score([dq, { pitch: 'D4', dur: 'e' }, q('E4'), q('F4')]);
  assert.deepEqual(barIssues(s), []);
  assert.equal(validateScore({ notes: [{ pitch: 'C4', dur: 'q', dot: 'yes' }] }).ok, false);
  assert.deepEqual(validateScore(JSON.parse(stringifyScore(s))).score, s);
  const r = compare(s, score([q('C4'), { pitch: 'D4', dur: 'e' }, q('E4'), q('F4')]));
  assert.equal(r.items[0].status, 'duration');
  assert.match(r.items[0].message, /dotted quarter/);
});

test('minor keys are accepted and draw their signature', () => {
  assert.ok(validateScore({ key: 'F#m', notes: [] }).ok);
  assert.match(renderScore(score([q('A4')], { key: 'Dm' })).svg, /\u266D|♭/);
});

test('eighth notes in one beat are beamed', () => {
  const e = (pitch) => ({ pitch, dur: 'e' });
  const { svg } = renderScore(score([e('C4'), e('D4'), e('E4'), e('F4'), { pitch: 'G4', dur: 'h' }]));
  assert.equal((svg.match(/class="beam"/g) ?? []).length, 2);
  const lone = renderScore(score([q('C4'), e('D4'), q('E4'), e('F4'), q('G4')])).svg;
  assert.equal(lone.includes('class="beam"'), false);
});

test('library: pieces list their exercises', () => {
  assert.ok(LIBRARY.length >= 2);
  for (const piece of LIBRARY) {
    assert.ok(piece.title && piece.exercises.length > 0);
    for (const e of piece.exercises) assert.ok(validateScore(e.score).ok, e.name);
  }
  assert.match(LIBRARY[0].title, /Carcassi/);
});

test('keyboard: three rows, three octaves, shiftable', () => {
  const rows = keyLayout(3);
  assert.deepEqual(rows.map((r) => r.length), [9, 8, 7]);
  assert.deepEqual(lookupKey('z', 3), { letter: 'C', octave: 3 });
  assert.deepEqual(lookupKey('m', 3), { letter: 'B', octave: 3 });
  assert.deepEqual(lookupKey('a', 3), { letter: 'C', octave: 4 });
  assert.deepEqual(lookupKey('k', 3), { letter: 'C', octave: 5 });
  assert.deepEqual(lookupKey('q', 3), { letter: 'C', octave: 5 });
  assert.deepEqual(lookupKey('u', 3), { letter: 'B', octave: 5 });
  assert.deepEqual(lookupKey('i', 3), { letter: 'C', octave: 6 }); // do and re continue the top row
  assert.deepEqual(lookupKey('o', 3), { letter: 'D', octave: 6 });
  assert.deepEqual(lookupKey('q', 4), { letter: 'C', octave: 6 }); // octave + 1 moves every row
  assert.equal(lookupKey('p', 3), null);
  assert.equal(keyFromCode('KeyQ'), 'q');
  assert.equal(keyFromCode('Space'), null);
});

test('compact layout fits more bars per line', () => {
  const eighths = Array.from({ length: 32 }, (_, i) => ({ pitch: i % 2 ? 'E4' : 'G4', dur: 'e' }));
  const { layout } = renderScore(score(eighths));
  assert.ok(layout.systems.length <= 3, `${layout.systems.length} systems for 8 bars`);
});

// ---------- two voices ----------

const h = (pitch) => ({ pitch, dur: 'h' });
const two = () => score([q('E5'), q('D5'), q('C5'), q('B4')], { voice2: [h('C4'), h('G3')] });

test('second voice: validate, stringify, bar issues per voice', () => {
  const s = two();
  assert.equal(s.voice2.length, 2);
  assert.deepEqual(validateScore(JSON.parse(stringifyScore(s))).score, s);
  assert.equal(validateScore({ notes: [], voice2: [{ pitch: 'X', dur: 'q' }] }).ok, false);
  assert.deepEqual(barIssues(s), []);
  const short = score([q('C5'), q('D5'), q('E5'), q('F5')], { voice2: [h('C4')] });
  assert.match(barIssues(short)[0].message, /^Voice 2: last bar is incomplete/);
  assert.ok(!('voice2' in JSON.parse(stringifyScore(score([q('C4')])))));
});

test('second voice: notes that start together share a slot, stems point opposite ways', () => {
  const { layout, svg } = renderScore(two());
  assert.equal(layout.two, true);
  assert.equal(layout.pos[1][0].x, layout.pos[2][0].x); // E5 and C4 together
  assert.equal(layout.pos[1][2].x, layout.pos[2][1].x); // C5 and G3 together at beat 2
  assert.equal(layout.slots.length, 4);
  assert.match(svg, /data-v="2" data-i="1"/);
});

test('second voice: heads a step apart are moved aside', () => {
  const { layout } = renderScore(score([q('D4')], { voice2: [q('C4')] }));
  assert.ok(layout.pos[2][0].x > layout.pos[1][0].x);
});

test('second voice: checker compares each voice on its own', () => {
  const a = two();
  assert.equal(compare(a, structuredClone(a)).passed, true);
  const noBass = score(a.notes);
  const r = compare(a, noBass);
  assert.equal(r.stats.missing, 2);
  assert.equal(r.byOriginal[2][0], 'missing');
  assert.equal(r.items.find((i) => i.voice === 2).voice, 2);
  const wrong = score(a.notes, { voice2: [h('C4'), h('A3')] });
  assert.equal(compare(a, wrong).byMine[2][1], 'pitch');
});

test('editing by time: place, pad with rests, replace, insert, delete', () => {
  const v = [];
  assert.equal(placeNote(v, 2, h('C4')), 1); // gap of two beats becomes a half rest
  assert.deepEqual(v.map((n) => n.pitch + n.dur), ['rh', 'C4h']);
  assert.equal(placeNote(v, 0, q('E4')), 0); // replaces the first half of the rest
  assert.deepEqual(v.map((n) => n.pitch + n.dur), ['E4q', 'rq', 'C4h']);
  assert.equal(placeNote(v, 1, q('F4')), 1);
  assert.deepEqual(v.map((n) => n.pitch + n.dur), ['E4q', 'F4q', 'C4h']);
  assert.equal(placeNote(v, 2, q('G4')), 2); // half note cut short: the rest of it is a rest
  assert.deepEqual(v.map((n) => n.pitch + n.dur), ['E4q', 'F4q', 'G4q', 'rq']);
  assert.equal(insertIndex(v, 2), 2);
  assert.equal(insertIndex(v, 99), 4);
  deleteNote(v, 0, true); // keeps time: becomes a rest (and the rest at the very end is dropped)
  assert.deepEqual(v.map((n) => n.pitch + n.dur), ['rq', 'F4q', 'G4q']);
  deleteNote(v, 2, true); // the last note disappears completely
  assert.deepEqual(v.map((n) => n.pitch + n.dur), ['rq', 'F4q']);
  deleteNote(v, 0, false); // first voice: the rest closes up
  assert.deepEqual(v.map((n) => n.pitch + n.dur), ['F4q']);
  assert.deepEqual(restsFor(2.5).map((n) => n.dur + (n.dot ? '.' : '')), ['h', 'e']);
});
