import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScore, barIssues, measures, stringifyScore, emptyScore } from '../src/score.js';
import { compare } from '../src/checker.js';
import { renderScore, hitTest, layoutScore, gridLines } from '../src/render.js';
import { readFileSync } from 'node:fs';
import { LIBRARY, allExercises, setLibrary } from '../src/library.js';
import { keyLayout, lookupKey, keyFromCode } from '../src/keyboard.js';
import { MAX_FAVORITES, TEMPO_DEFAULT, addFav, clampTempo, normalizeFavs, removeFav, tempoName } from '../src/tempo.js';
import { pianoSamples, sampleName, SOUNDS, SOUND_GROUPS } from '../src/audio.js';
import { renderVoice } from '../src/voices.js';
import { LEGACY_TOOLS, addNewTools, DEFAULT_ORDER, PALETTE, REQUIRED, normalizeColors, normalizeOrder, placeTool, removeTool, removeGaps, hiddenTools, withColor } from '../src/panel.js';
import { placeNote, insertIndex, deleteNote, restsFor, deleteBar } from '../src/edit.js';

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

test('deleteBar removes a whole bar from both voices and closes the gap', () => {
  const s = score([q('C4'), q('D4'), q('E4'), q('F4'), q('G4'), q('A4'), q('B4'), q('C5')], { time: '4/4' });
  s.voice2 = [{ pitch: 'C3', dur: 'w' }, { pitch: 'G3', dur: 'w' }];
  deleteBar(s, 0);
  assert.deepEqual(s.notes.map((n) => n.pitch), ['G4', 'A4', 'B4', 'C5']);
  assert.deepEqual(s.voice2.map((n) => n.pitch), ['G3']);
  deleteBar(s, 5); // past the end: nothing happens
  assert.equal(s.notes.length, 4);
});

test('piano samples: finite, normalised, decaying, and lower notes ring longer', () => {
  const a4 = pianoSamples(69, 8000);
  const c2 = pianoSamples(36, 8000);
  assert.ok(a4.every(Number.isFinite));
  const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(Math.abs(peak(a4) - 0.9) < 1e-3);
  const rms = (x, from, to) => Math.sqrt(x.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
  assert.ok(rms(a4, 4000, 6000) < rms(a4, 400, 2400), 'it dies away');
  assert.ok(c2.length > a4.length, 'low notes are longer');
});

test('endless board with a bar limit: at most 5 bars on a line, the lines go down', () => {
  const notes = Array.from({ length: 12 * 4 }, () => q('C4')); // 12 bars of 4/4
  const s = score(notes, { time: '4/4' });
  const endless = layoutScore(s, 0, false);
  assert.equal(endless.systems.length, 1);
  const wrapped = layoutScore(s, 0, false, false, false, { maxBars: 5 });
  assert.deepEqual(wrapped.systems.map((sys) => sys.bars.length), [5, 5, 2]);
  assert.ok(wrapped.height > endless.height && wrapped.width < endless.width);
  // full lines are equally wide, so the bar lines line up; the notes keep their order
  const ends = wrapped.systems.slice(0, 2).map((sys) => sys.x1);
  assert.ok(Math.abs(ends[0] - ends[1]) < 1e-6);
  assert.ok(wrapped.systems.every((sys) => Number.isFinite(sys.x1)));
  assert.equal(wrapped.pos[1].length, notes.length);
  assert.deepEqual([0, 19, 20, 39, 40, 47].map((i) => wrapped.pos[1][i].system), [0, 0, 1, 1, 2, 2]);
});

test('one-bar view: beats are equally wide and the dotted lines are equally spaced', () => {
  const s = score([q('C4'), { pitch: 'D4', dur: 'e' }, { pitch: 'E4', dur: 'e' }, { pitch: 'F4', dur: 'h' }], { time: '4/4' });
  const mode = { timed: true, bare: true };
  const layout = layoutScore(s, 400, true, false, true, mode);
  const x = (t) => layout.slots.find((sl) => Math.abs(sl.t - t) < 1e-9).x;
  // notes at 0, 1, 1.5, 2: x is linear in time
  const perBeat = (x(2) - x(0)) / 2;
  assert.ok(Math.abs(x(1) - x(0) - perBeat) < 1e-6);
  assert.ok(Math.abs(x(1.5) - x(0) - 1.5 * perBeat) < 1e-6);
  for (const size of [4, 2, 1, 0.5, 0.25, 4 / 3, 2 / 3]) {
    const lines = gridLines(layout, 4, size);
    assert.equal(lines[0].t, 0);
    assert.equal(lines.at(-1).t, 4);
    const gaps = lines.slice(1).map((l, i) => (l.x - lines[i].x) / (l.t - lines[i].t));
    assert.ok(gaps.every((g) => Math.abs(g - gaps[0]) < 1e-6), 'x per beat is constant for size ' + size);
  }
  // a note sits exactly on its dotted line, and the bar line is where the last line is
  const lines = gridLines(layout, 4, 1);
  assert.ok(Math.abs(lines[1].x - x(1)) < 1e-6);
  assert.ok(Math.abs(lines.at(-1).x - layout.systems[0].x1) < 1e-6);
  // bare: the staff starts right after the key signature (none in C), not after a clef
  assert.ok(layout.systems[0].header < 10);
});

test('recorded piano: every key of A0..Db8 has a sample file, none outside', () => {
  assert.equal(sampleName(21), 'A0');
  assert.equal(sampleName(60), 'C4');
  assert.equal(sampleName(61), 'Db4');
  assert.equal(sampleName(108), 'C8');
  assert.equal(sampleName(109), 'Db8');
  assert.equal(sampleName(20), null);
  assert.equal(sampleName(110), null);
  for (let m = 21; m <= 109; m++) {
    assert.ok(readFileSync(new URL(`../sounds/piano/${sampleName(m)}.mp3`, import.meta.url)).length > 1000, `sample for ${m}`);
  }
});

test('sound menu: 50 sounds in groups, unique ids and names', () => {
  assert.equal(SOUNDS.length, 50);
  assert.ok(SOUND_GROUPS.length >= 6 && SOUND_GROUPS.every((g) => g.name && g.sounds.length >= 4));
  assert.equal(new Set(SOUNDS.map((v) => v.id)).size, 50);
  assert.equal(new Set(SOUNDS.map((v) => v.name)).size, 50);
  assert.equal(SOUNDS[0].id, 'recorded');
});

test('synthesized voices: finite, normalised, in range, die away (or hold), and in tune', () => {
  const synthesized = SOUNDS.filter((v) => v.id !== 'recorded');
  assert.equal(synthesized.length, 49);
  const baseRate = 8000;
  const rms = (x, from, to) => Math.sqrt(x.slice(from, to).reduce((a, v) => a + v * v, 0) / (to - from));
  // strongest repeat of the waveform: the period, compared with the one expected
  const period = (x, lo, hi) => {
    let best = lo;
    let bestScore = -Infinity;
    for (let lag = lo; lag <= hi; lag++) {
      let sum = 0;
      for (let i = 400; i < 400 + 2400; i++) sum += x[i] * x[i + lag];
      if (sum > bestScore) [best, bestScore] = [lag, sum];
    }
    return best;
  };
  const failures = [];
  for (const v of synthesized) {
    const rate = baseRate / (v.div ?? 1);
    for (const m of [45, 60, 84]) {
      const x = renderVoice(v.id, m, rate);
      const tag = `${v.id} ${m}`;
      if (!(x.length > rate * 0.5 && x.length < rate * 7)) failures.push(`${tag}: length ${x.length}`);
      if (!x.every(Number.isFinite)) failures.push(`${tag}: not finite`);
      const peak = x.reduce((a, q) => Math.max(a, Math.abs(q)), 0);
      if (Math.abs(peak - 0.9) > 1e-3) failures.push(`${tag}: peak ${peak}`);
      if (!(rms(x, 0, rate) > 0.02)) failures.push(`${tag}: silent in the first second`);
      if (!(Math.abs(x[x.length - 1]) < 1e-3)) failures.push(`${tag}: does not end at zero`);
      const mid = Math.floor(x.length * 0.6);
      if (!v.sustained && !(rms(x, mid, mid + rate / 2) < rms(x, 0, rate / 2))) failures.push(`${tag}: does not die away`);
    }
  }
  assert.deepEqual(failures, []);
  // tuned: A3 (220 Hz) and A4 (440 Hz), for everything that has a pitch to follow (not bells and bars)
  const tuned = [];
  for (const v of synthesized.filter((q) => !q.unpitched)) {
    const rate = baseRate / (v.div ?? 1);
    for (const [m, f] of [[57, 220], [69, 440]]) {
      const expected = rate / f;
      const got = period(renderVoice(v.id, m, rate), Math.floor(expected * 0.7), Math.ceil(expected * 1.3));
      const multiple = Math.round(got / expected);
      if (!(multiple >= 1 && Math.abs(got / multiple - expected) / expected < 0.03)) tuned.push(`${v.id} at ${f} Hz: period ${got}, expected ${expected}`);
    }
  }
  assert.deepEqual(tuned, []);
});

test('tool panel layout: move, swap, gaps, hiding, and always a way out', () => {
  const o = ['a', 'b', 'c', 'settings', 'exit'];
  const known = [...o, 'd'];
  // a tool dropped on another one: they swap
  assert.deepEqual(placeTool(o, 'a', 2), ['c', 'b', 'a', 'settings', 'exit']);
  // into an empty cell: it moves and leaves a gap behind
  assert.deepEqual(placeTool(o, 'a', 6), [null, 'b', 'c', 'settings', 'exit', null, 'a']);
  // from the hidden tools onto a tool: that one is hidden
  assert.deepEqual(placeTool(o, 'd', 1), ['a', 'd', 'c', 'settings', 'exit']);
  assert.deepEqual(hiddenTools(placeTool(o, 'd', 1), known), ['b']);
  // dropped where it already is: nothing changes
  assert.deepEqual(placeTool(o, 'b', 1), o);
  // hide, and the required ones stay
  assert.deepEqual(removeTool(o, 'b'), ['a', null, 'c', 'settings', 'exit']);
  assert.deepEqual(removeTool(o, 'exit'), o);
  assert.deepEqual(removeTool(o, 'settings'), o);
  assert.deepEqual(removeGaps(['a', null, 'c', null, 'exit']), ['a', 'c', 'exit']);
  // a saved layout is made safe: unknown ids and repeats dropped, required ones put back
  assert.deepEqual(normalizeOrder(['a', 'zzz', 'a', null, 'b'], known), ['a', null, null, null, 'b', 'settings', 'exit']);
  assert.deepEqual(normalizeOrder('garbage'), DEFAULT_ORDER);
  assert.deepEqual(normalizeOrder(null), DEFAULT_ORDER);
  assert.ok(REQUIRED.every((id) => normalizeOrder([]).includes(id)));
  // the default has no repeats and has the required tools
  assert.equal(new Set(DEFAULT_ORDER).size, DEFAULT_ORDER.length);
  assert.ok(REQUIRED.every((id) => DEFAULT_ORDER.includes(id)));
});

test('tool icon colours: only known tools and #rrggbb survive, set and reset', () => {
  assert.deepEqual(normalizeColors({ undo: '#E03131', nope: '#e03131', redo: 'red', play: '#12345', check: 5 }), { undo: '#e03131' });
  assert.deepEqual(normalizeColors(null), {});
  assert.deepEqual(normalizeColors(['#e03131']), {});
  assert.deepEqual(withColor({}, 'undo', '#e03131'), { undo: '#e03131' });
  assert.deepEqual(withColor({ undo: '#e03131', redo: '#2f9e44' }, 'undo', null), { redo: '#2f9e44' });
  assert.ok(PALETTE.every(([name, hex]) => name && /^#[0-9a-f]{6}$/.test(hex)));
  assert.equal(new Set(PALETTE.map((p) => p[1])).size, PALETTE.length);
});

test('speed: limits, favourites, names', () => {
  assert.equal(TEMPO_DEFAULT, 120);
  assert.equal(clampTempo(120.4), 120);
  assert.equal(clampTempo(5), 20);
  assert.equal(clampTempo(999), 300);
  assert.equal(clampTempo('abc'), 120);
  assert.equal(clampTempo(null), 120);
  assert.deepEqual(normalizeFavs([90, 60, 90, 'x', 2.5, 5, 400, 120]), [60, 90, 120]);
  assert.deepEqual(normalizeFavs('nope'), []);
  assert.deepEqual(addFav([60, 120], 90), [60, 90, 120]);
  assert.deepEqual(addFav([60, 120], 120), [60, 120]);
  assert.deepEqual(removeFav([60, 90, 120], 90), [60, 120]);
  const full = Array.from({ length: MAX_FAVORITES }, (_, i) => 40 + i);
  assert.deepEqual(addFav(full, 200), full, 'a full list does not grow');
  assert.equal(tempoName(40), 'Grave');
  assert.equal(tempoName(120), 'Allegro');
  assert.equal(tempoName(200), 'Presto');
});

test('tool panel: a tool added later joins a saved layout, unless it was hidden on purpose', () => {
  assert.ok(!LEGACY_TOOLS.includes('tempo') && DEFAULT_ORDER.includes('tempo'));
  assert.ok(!LEGACY_TOOLS.includes('wrap') && DEFAULT_ORDER.includes('wrap'));
  // a layout saved before the speed tool: it gets the first empty cell
  const saved = ['dur-w', null, 'dur-h', 'settings', 'exit'];
  const r = addNewTools(saved, LEGACY_TOOLS);
  assert.deepEqual(r.order, ['dur-w', 'tempo', 'dur-h', 'settings', 'exit', 'wrap']);
  assert.ok(r.seen.includes('tempo'));
  // no empty cell: at the end
  assert.deepEqual(addNewTools(['dur-w', 'exit'], LEGACY_TOOLS).order, ['dur-w', 'exit', 'tempo', 'wrap']);
  // already known (the user hid it): it stays hidden
  assert.deepEqual(addNewTools(['dur-w', 'exit'], DEFAULT_ORDER).order, ['dur-w', 'exit']);
  // nothing new: nothing changes
  assert.deepEqual(addNewTools(saved, DEFAULT_ORDER).order, saved);
});

test('second voice: padding before a late note is invisible, stays padding when cut, and is saved', () => {
  const v2 = [];
  const idx = placeNote(v2, 8, q('C3'), true); // two bars in, nothing before it
  assert.equal(idx, v2.length - 1);
  assert.ok(v2.slice(0, idx).every((n) => n.pitch === 'r' && n.pad === true), 'the gap is padding');
  assert.equal(v2.slice(0, idx).reduce((a, n) => a + (n.dur === 'w' ? 4 : n.dur === 'h' ? 2 : n.dur === 'q' ? 1 : 0.5) * (n.dot ? 1.5 : 1), 0), 8);

  // it is not drawn and cannot be hit: only the real note has a handle
  const s = score(Array.from({ length: 12 }, () => q('E4')), { time: '4/4' });
  s.voice2 = v2;
  const { svg } = renderScore(s, { width: 900 });
  assert.equal((svg.match(/data-v="2"/g) ?? []).length, 1);
  assert.ok(svg.includes(`data-v="2" data-i="${idx}"`));

  // a real note over a piece of padding leaves padding on both sides, not visible rests
  const cut = [{ pitch: 'r', dur: 'w', pad: true }, { pitch: 'r', dur: 'w', pad: true }];
  placeNote(cut, 1, q('G3'), true);
  assert.ok(cut.filter((n) => n.pitch === 'r').every((n) => n.pad === true));
  assert.equal(cut.filter((n) => n.pitch !== 'r').length, 1);

  // an ordinary rest stays visible, and a deleted note in the second voice leaves padding
  const mixed = [{ pitch: 'r', dur: 'q' }, q('C3'), q('D3')];
  deleteNote(mixed, 1, true);
  assert.deepEqual(mixed[1], { pitch: 'r', dur: 'q', pad: true });
  assert.equal(mixed[0].pad, undefined);

  // saved and loaded: the flag survives, and only on rests
  const text = stringifyScore({ ...s, voice2: [{ pitch: 'r', dur: 'w', pad: true }, q('C3')] });
  const back = validateScore(JSON.parse(text)).score;
  assert.equal(back.voice2[0].pad, true);
  assert.equal(back.voice2[1].pad, undefined);
  assert.equal(validateScore({ notes: [{ pitch: 'C4', dur: 'q', pad: true }] }).score.notes[0].pad, undefined, 'a note cannot be padding');
});
