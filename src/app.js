import {
  DURATIONS, KEYS, LETTERS, REST, TIMES,
  barIssues, beatsOf, diatonic, emptyScore, endTime, timeline, formatPitch, fromDiatonic, hasSecondVoice, keyAlterations,
  parsePitch, startOf, stringifyScore, validateScore, voiceNotes,
} from './score.js';
import { deleteNote, insertIndex, placeNote } from './edit.js';
import { bottomDia, hitTest, layoutScore, renderScore } from './render.js';
import { compare } from './checker.js';
import { MAX_BASE, MIN_BASE, keyFromCode, keyLayout, lookupKey } from './keyboard.js';
import { beep, playScore } from './audio.js';
import { LIBRARY, loadLibrary } from './library.js';

await loadLibrary(); // init.json -> LIBRARY (before any state is built)

const STORE_KEY = 'learn-music:v1';
const WHICH = ['original', 'mine'];
const LABELS = { original: 'Original', mine: 'My notes' };
const $ = (sel, root = document) => root.querySelector(sel);
const clone = (x) => JSON.parse(JSON.stringify(x));
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
const BOARD_ROOM = 360; // empty staff after the last note on the full-screen board
const landscapeMQ = matchMedia('(orientation: landscape) and (max-height: 600px)'); // a phone held sideways
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- state ----------

function validLib(lib) {
  const exercises = LIBRARY[lib?.piece]?.exercises;
  return exercises?.[lib.ex] ? { piece: lib.piece, ex: lib.ex } : { piece: 0, ex: 0 };
}

function loadSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    const o = validateScore(raw?.original);
    const m = validateScore(raw?.mine);
    if (o.ok && m.ok) return { original: o.score, mine: m.score, hideOriginal: !!raw.hideOriginal, lib: raw.lib, octave: raw.octave, zoom: raw.zoom };
  } catch {}
  return null;
}

const saved = loadSaved();
const state = {
  original: saved?.original ?? clone(LIBRARY[0].exercises[0].score),
  mine: saved?.mine ?? emptyScore({ title: 'My notes' }),
  hideOriginal: saved?.hideOriginal ?? false,
  zoom: Number.isFinite(saved?.zoom) ? clamp(saved.zoom, ZOOM_MIN, ZOOM_MAX) : innerWidth < 640 ? 0.65 : 1, // scale of the notes: the staff is laid out at width / zoom
  lib: validLib(saved?.lib), // which piece / exercise of the library the Original came from
  full: false, // full screen: only the staves and a tool column on the right
  octave: Number.isInteger(saved?.octave) ? clamp(saved.octave, MIN_BASE, MAX_BASE) : 3, // octave of the keyboard's bottom row
  target: 'mine', // which score the toolbar / note list / JSON edit
  dur: 'q',
  dot: false,
  acc: 'auto', // auto = follow key signature
  accLock: false, // true = the accidental stays on for every following note
  rest: false,
  selected: null, // { which, voice, index }
  voiceChoice: null, // 1 or 2 once a voice is picked by hand: only that voice is selected, navigated and edited; null = automatic
  cursor: null, // where the next note goes: { voice, t } in beats; null = after the last note of voice 1
  result: null,
  playing: null, // { which, stop }
};
const layouts = { original: null, mine: null };

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ original: state.original, mine: state.mine, hideOriginal: state.hideOriginal, lib: state.lib, octave: state.octave, zoom: state.zoom }));
  } catch {}
}

const history = [];
const future = []; // undone snapshots, for redo
const snapshot = () => JSON.stringify({ original: state.original, mine: state.mine });

/** Every score change goes through here: undo snapshot, drop stale check result, save, redraw. */
function commit(mutator) {
  history.push(snapshot());
  if (history.length > 100) history.shift();
  future.length = 0;
  mutator();
  state.result = null;
  persist();
  render();
}

function undo() {
  const prev = history.pop();
  if (!prev) return;
  future.push(snapshot());
  Object.assign(state, JSON.parse(prev), { result: null, selected: null, cursor: null });
  persist();
  render();
}

function redo() {
  const next = future.pop();
  if (!next) return;
  history.push(snapshot());
  Object.assign(state, JSON.parse(next), { result: null, selected: null, cursor: null });
  persist();
  render();
}

// ---------- pitch helpers ----------

function accidentalFor(score, letter) {
  if (state.acc === 'auto') return keyAlterations(score.key)[letter] ?? 0;
  return state.acc === '#' ? 1 : state.acc === 'b' ? -1 : 0;
}

function pitchFromDia(score, dia) {
  const d = clamp(dia, 0, 8 * 7 + 6);
  const letter = LETTERS[d % 7];
  return formatPitch(fromDiatonic(d, accidentalFor(score, letter)));
}

const pitchFromStep = (score, step) => pitchFromDia(score, bottomDia(score.clef) + step);

const EPS = 1e-9;
const notesOf = (which, voice) => voiceNotes(state[which], voice);
const activeVoice = () => state.cursor?.voice ?? 1;
const cursorTime = (which = state.target) => (state.cursor ? state.cursor.t : endTime(state[which].notes));

function selectedNote() {
  const sel = state.selected;
  return sel ? notesOf(sel.which, sel.voice)[sel.index] ?? null : null;
}

/** Select a note. Going back onto existing notes puts the cursor beside them: new notes go in voice 2. */
function select(which, voice, index) {
  const notes = notesOf(which, voice);
  if (strict()) state.voiceChoice = voice;
  state.selected = { which, voice, index };
  state.target = which;
  state.cursor = { voice: strict() ? voice : 2, t: startOf(notes, index) };
  if (notes[index]) beep(notes[index].pitch);
  render();
}

const strict = () => state.voiceChoice !== null;

/** Start times (beats) where a note begins in either voice, ascending. */
function slotTimes(score) {
  const all = [...timeline(score.notes), ...timeline(score.voice2)].map((x) => x.start);
  return [...new Set(all.map((x) => Math.round(x * 1000)))].sort((a, b) => a - b).map((x) => x / 1000);
}

/** With a voice picked by hand, the selection is the note of that voice that starts at the cursor (if any). */
function syncSelection() {
  const which = state.target;
  const v = activeVoice();
  const t = cursorTime(which);
  const i = timeline(notesOf(which, v)).findIndex((x) => Math.abs(x.start - t) < EPS);
  state.selected = i >= 0 ? { which, voice: v, index: i } : null;
}

function setCursorTime(v, t) {
  const score = state[state.target];
  state.cursor = v === 1 && t >= endTime(score.notes) - EPS ? null : { voice: v, t };
  syncSelection();
  render();
}

/** Step the cursor to the previous / next moment where something starts (both voices count). */
function moveBySlot(dir) {
  const t = cursorTime();
  const times = slotTimes(state[state.target]);
  const next = dir < 0 ? [...times].reverse().find((x) => x < t - EPS) : times.find((x) => x > t + EPS);
  if (next === undefined) return dir > 0 ? goToEnd(activeVoice()) : undefined;
  setCursorTime(activeVoice(), next);
}

/** After a note is entered: select it and move the cursor behind it. `insert` keeps voice 1 in insert mode. */
/** A sharp / flat / natural is used up by the note it was entered with, unless the lock is on. */
function spendAccidental(note) {
  if (note.pitch !== REST && !state.accLock) state.acc = 'auto';
}

function afterEnter(which, voice, index, insert = false) {
  spendAccidental(notesOf(which, voice)[index]);
  const notes = notesOf(which, voice);
  const t = startOf(notes, index) + beatsOf(notes[index]);
  state.selected = { which, voice, index };
  state.cursor = voice === 1 && t >= endTime(state[which].notes) - EPS ? null : { voice, t, ...(insert && { insert: true }) };
}

/** Pick a voice by hand: from now on only that voice is selected and edited. */
function setVoice(v) {
  const which = state.target;
  const score = state[which];
  state.voiceChoice = v;
  if (v === 2) state.cursor = { voice: 2, t: state.cursor ? state.cursor.t : endTime(score.voice2) };
  else {
    const t = cursorTime(which);
    state.cursor = t >= endTime(score.notes) - EPS ? null : { voice: 1, t };
  }
  syncSelection();
  render();
}

// ---------- DOM: cards ----------

const cards = {};

function buildCards() {
  const tpl = $('#card-tpl');
  for (const which of WHICH) {
    const root = tpl.content.firstElementChild.cloneNode(true);
    root.dataset.which = which;
    root.dataset.label = LABELS[which];
    $('.label', root).textContent = LABELS[which];
    for (const el of root.querySelectorAll('[data-only]')) if (el.dataset.only !== which) el.remove();

    $('[data-meta=clef]', root).innerHTML = ['treble', 'bass'].map((c) => `<option>${c}</option>`).join('');
    $('[data-meta=key]', root).innerHTML = Object.keys(KEYS).map((k) => `<option>${k}</option>`).join('');
    $('[data-meta=time]', root).innerHTML = TIMES.map((t) => `<option>${t}</option>`).join('');
    // the note-entry toolbar lives on the card where the notes are written
    if (which === 'mine') $('header', root).after($('.toolbar'));
    $('#cards').append(root);
    cards[which] = { root, staff: $('.staff', root), lint: $('.lint', root) };

    root.addEventListener('click', (e) => {
      if (e.target.closest('button, select, input') || isHidden(which)) return;
      if (state.target !== which) {
        state.target = which;
        state.selected = null;
        state.cursor = null;
        state.voiceChoice = null;
        render();
      }
    });
    cards[which].staff.addEventListener('click', (e) => onStaffClick(which, e));
    bindPinch(cards[which].staff);
    cards[which].staff.addEventListener('mousemove', (e) => onStaffMove(which, e));
    cards[which].staff.addEventListener('mouseleave', () => $('.ghost', cards[which].staff)?.remove());

    root.addEventListener('change', (e) => {
      const meta = e.target.dataset.meta;
      if (meta) {
        const value = meta === 'tempo' ? clamp(Number(e.target.value) || 90, 20, 300) : e.target.value;
        commit(() => {
          state[which][meta] = value;
        });
      }
    });
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'play') togglePlay(which);
      if (act === 'hide') toggleHideOriginal();
    });
  }
}

// ---------- library: pick a piece, then an exercise to copy below ----------

/** Put an exercise in the Original and start an empty "My notes" with the same clef, key and time. */
function loadExercise(piece, ex) {
  const o = LIBRARY[piece].exercises[ex].score;
  commit(() => {
    state.lib = { piece, ex };
    state.original = clone(o);
    state.mine = emptyScore({ title: 'My notes', clef: o.clef, key: o.key, time: o.time, tempo: o.tempo });
    state.selected = null;
    state.cursor = null;
    state.voiceChoice = null;
    state.target = 'mine';
    state.octave = o.clef === 'bass' ? 2 : 3;
  });
}

const exerciseLabel = (e) => e.label ?? e.name;

function buildLibrary() {
  $('#lib-piece').innerHTML = LIBRARY.map((p, i) => `<option value="${i}">${p.title}</option>`).join('');
  $('#lib-piece').addEventListener('change', (e) => loadExercise(Number(e.target.value), 0));
  $('#lib-exercise').addEventListener('change', (e) => loadExercise(state.lib.piece, Number(e.target.value)));
  $('#lib-prev').addEventListener('click', () => stepExercise(-1));
  $('#lib-next').addEventListener('click', () => stepExercise(1));
}

function stepExercise(dir) {
  const { piece, ex } = state.lib;
  const next = ex + dir;
  if (LIBRARY[piece].exercises[next]) loadExercise(piece, next);
}

function renderLibrary() {
  const { piece, ex } = state.lib;
  const exercises = LIBRARY[piece].exercises;
  $('#lib-piece').value = piece;
  $('#lib-exercise').innerHTML = exercises.map((e, i) => `<option value="${i}">${exerciseLabel(e)}</option>`).join('');
  $('#lib-exercise').value = ex;
  $('#lib-prev').disabled = ex === 0;
  $('#lib-next').disabled = ex === exercises.length - 1;
  $('#lib-count').textContent = `${ex + 1} of ${exercises.length}`;
  $('#zoom-reset').textContent = `${Math.round(state.zoom * 100)}%`;
  $('#zoom-out').disabled = state.zoom <= ZOOM_MIN;
  $('#zoom-in').disabled = state.zoom >= ZOOM_MAX;
  // a composition that is a single piece needs no exercise picker
  $('#lib-exercise').hidden = $('#lib-prev').hidden = $('#lib-next').hidden = exercises.length < 2;
}

function toggleHideOriginal() {
  state.hideOriginal = !state.hideOriginal;
  persist();
  render();
}

// on a phone the original's Play and Hide / Show live in the top bar (the card's own buttons are hidden by CSS)
$('#top-play').addEventListener('click', () => togglePlay('original'));
$('#top-hide').addEventListener('click', toggleHideOriginal);
function renderTop() {
  $('#top-play').textContent = state.playing?.which === 'original' ? '\u25A0' : '\u25B6';
  $('#top-hide').setAttribute('aria-pressed', String(state.hideOriginal));
  $('#top-hide').title = state.hideOriginal ? 'Show the original' : 'Hide the original';
}

function isHidden(which) {
  return which === 'original' && state.hideOriginal && state.target !== 'original' && !state.result;
}

function renderCard(which) {
  const { root, staff, lint } = cards[which];
  const score = state[which];
  root.classList.toggle('active', state.target === which);

  for (const el of root.querySelectorAll('[data-meta]')) {
    if (document.activeElement !== el) el.value = score[el.dataset.meta];
  }
  const play = $('[data-act=play]', root);
  play.textContent = state.playing?.which === which ? '■ Stop' : '▶ Play';
  const hide = $('[data-act=hide]', root);
  if (hide) hide.textContent = state.hideOriginal ? 'Show' : 'Hide original';

  const hidden = isHidden(which);
  root.classList.toggle('collapsed', hidden);
  if (hidden) {
    layouts[which] = null;
    staff.innerHTML = '';
    lint.innerHTML = '';
    return;
  }
  const status = state.result ? (which === 'mine' ? state.result.byMine : state.result.byOriginal) : {};
  const selected = state.selected?.which === which ? state.selected : null;
  const cursor = state.target === which ? { voice: activeVoice(), t: cursorTime(which) } : null;
  const dim = state.target === which && strict() && score.voice2.length ? 3 - state.voiceChoice : null;
  const horizontal = isHorizontal();
  let width = Math.max(220, Math.round((staff.clientWidth || 860) / state.zoom));
  // sideways: both staves are as long as the longer one, so they scroll together without clamping
  if (horizontal) for (const w of WHICH) if (!isHidden(w)) width = Math.max(width, Math.ceil(layoutScore(state[w], 0, false).width));
  // full screen: a board with fixed coordinates. Its size depends on the music only (never on the window or the
  // zoom), so the start and the end of the staves stay where they are while you pan and scale.
  if (state.full) width = Math.max(...WHICH.map((w) => Math.ceil(layoutScore(state[w], 0, false).width))) + BOARD_ROOM;
  const { svg, layout } = renderScore(score, { width, wrap: !horizontal, status, selected, cursor, dim, fill: state.full });
  const scrollLeft = staff.scrollLeft;
  staff.classList.toggle('h-scroll', horizontal && !state.full);
  staff.innerHTML = svg;
  const svgEl = $('svg', staff);
  if (state.full) {
    svgEl.style.width = `${Math.round(layout.width)}px`;
    svgEl.style.height = `${Math.round(layout.height)}px`;
  } else if (horizontal) svgEl.style.width = `${Math.round(layout.width * state.zoom)}px`; // one endless staff at its natural size times the zoom
  staff.scrollLeft = scrollLeft;
  if (state.target === which) {
    if (state.full) keepInBoard(staff);
    else if (horizontal) keepInView(staff);
  }
  layouts[which] = layout;
  lint.innerHTML = barIssues(score).map((i) => `<li>${i.message}</li>`).join('');
}

// ---------- DOM: staff interaction ----------

function svgPoint(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function onStaffClick(which, e) {
  if (state.target !== which || !layouts[which] || Date.now() - gestureEnd < 350) return;
  const noteEl = e.target.closest('[data-i]');
  if (noteEl) {
    const v = Number(noteEl.dataset.v);
    const i = Number(noteEl.dataset.i);
    // a voice picked by hand: notes of the other voice are not selected, a click just moves the cursor there
    if (strict() && v !== state.voiceChoice) return setCursorTime(state.voiceChoice, startOf(notesOf(which, v), i));
    return select(which, v, i);
  }

  const score = state[which];
  const pt = svgPoint($('svg', cards[which].staff), e);
  const hit = hitTest(layouts[which], pt.x, pt.y);
  const note = { pitch: state.rest ? REST : pitchFromStep(score, hit.step), dur: state.dur, ...(state.dot && { dot: true }) };
  const voice = activeVoice();
  const notes = notesOf(which, voice);
  commit(() => {
    let index;
    if (voice === 1) {
      index = insertIndex(notes, hit.t); // first voice: later notes move right
      notes.splice(index, 0, note);
    } else {
      index = placeNote(notes, hit.t, note); // second voice: replaces what sounds there
    }
    afterEnter(which, voice, index, voice === 1);
  });
  beep(note.pitch);
}

function onStaffMove(which, e) {
  const staff = cards[which].staff;
  $('.ghost', staff)?.remove();
  if (state.target !== which || !layouts[which] || e.target.closest('[data-i]')) return;
  const svg = $('svg', staff);
  const pt = svgPoint(svg, e);
  const hit = hitTest(layouts[which], pt.x, pt.y);
  const label = state.rest ? 'rest' : pitchFromStep(state[which], hit.step);
  const head = state.rest ? '' : `<ellipse cx="${pt.x}" cy="${hit.y}" rx="6.4" ry="4.6" transform="rotate(-20 ${pt.x} ${hit.y})"/>`;
  svg.insertAdjacentHTML('beforeend', `<g class="ghost">${head}<text x="${pt.x + 12}" y="${hit.y - 8}">${label}</text></g>`);
}

// ---------- note keyboard ----------

const ACC_SIGN = { '-1': '\u266D', 0: '', 1: '\u266F' };

/**
 * Enter a note at the cursor, then move on. Normally it replaces what is there in that voice;
 * after a Delete in voice 1 (cursor.insert) it is inserted instead, like typing in a single line.
 */
function insertNote(note) {
  const which = state.target;
  const voice = activeVoice();
  const t = cursorTime(which);
  const insert = voice === 1 && !!state.cursor?.insert;
  const notes = notesOf(which, voice);
  commit(() => {
    let index;
    if (insert) {
      index = insertIndex(notes, t);
      notes.splice(index, 0, note);
    } else {
      index = placeNote(notes, t, note);
    }
    afterEnter(which, voice, index, insert);
  });
  beep(note.pitch);
}

const durationOf = () => ({ dur: state.dur, ...(state.dot && { dot: true }) });

function enterNote(letter, octave) {
  const acc = accidentalFor(state[state.target], letter);
  insertNote({ pitch: formatPitch({ letter, acc, octave }), ...durationOf() });
}

function buildKeyboard() {
  const rows = $('#kb-rows');
  keyLayout(3).forEach((row, r) => {
    const el = document.createElement('div');
    el.className = 'kb-row';
    el.dataset.row = r;
    el.innerHTML = row.map((k) => `<button class="key" data-key="${k.key}"><b></b><kbd>${k.key}</kbd></button>`).join('');
    rows.append(el);
  });
  rows.addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]')?.dataset.key;
    const note = key && lookupKey(key, state.octave);
    if (note && note.octave <= 8) enterNote(note.letter, note.octave);
  });
  const shift = (d) => {
    state.octave = clamp(state.octave + d, MIN_BASE, MAX_BASE);
    persist();
    render();
  };
  $('#oct-down').addEventListener('click', () => shift(-1));
  $('#oct-up').addEventListener('click', () => shift(1));
}

function renderKeyboard() {
  const score = state[state.target];
  const sign = state.acc === 'n' ? '\u266E' : null;
  for (const row of keyLayout(state.octave)) {
    for (const k of row) {
      const el = $(`[data-key="${k.key}"]`, $('#kb-rows'));
      const acc = accidentalFor(score, k.letter);
      el.querySelector('b').textContent = `${k.letter}${sign && acc === 0 && (keyAlterations(score.key)[k.letter] ?? 0) !== 0 ? sign : ACC_SIGN[acc]}${k.octave}`;
      el.disabled = k.octave > 8;
    }
  }
  $('#oct-label').textContent = `${state.octave}\u2013${state.octave + 2}`;
  $('#oct-down').disabled = state.octave <= MIN_BASE;
  $('#oct-up').disabled = state.octave >= MAX_BASE;
}

function flashKey(key) {
  const el = $(`[data-key="${key}"]`, $('#kb-rows'));
  el?.classList.add('down');
  setTimeout(() => el?.classList.remove('down'), 140);
}

// ---------- playback ----------

function togglePlay(which) {
  const wasPlaying = state.playing?.which;
  state.playing?.stop();
  if (wasPlaying === which) return;
  const stop = playScore(state[which], {
    onNote: (voice, i) => {
      for (const el of cards[which].staff.querySelectorAll(`.playing[data-v="${voice}"]`)) el.classList.remove('playing');
      cards[which].staff.querySelector(`[data-v="${voice}"][data-i="${i}"]`)?.classList.add('playing');
    },
    onEnd: () => {
      for (const el of cards[which].staff.querySelectorAll('.playing')) el.classList.remove('playing');
      if (state.playing?.which === which) state.playing = null;
      renderCard(which);
    },
  });
  state.playing = { which, stop };
  renderCard(which);
}

// ---------- DOM: toolbar, note list, json, result ----------

function syncToolbar() {
  for (const b of document.querySelectorAll('[data-dur]')) b.classList.toggle('active', b.dataset.dur === state.dur);
  for (const b of document.querySelectorAll('[data-acc]')) b.setAttribute('aria-pressed', String(b.dataset.acc === state.acc));
  $('#tool-rest').setAttribute('aria-pressed', String(state.rest));
  $('#tool-dot').setAttribute('aria-pressed', String(state.dot));
  $('#tool-lock').setAttribute('aria-pressed', String(state.accLock));
  $('#tool-voice').dataset.strict = String(strict());
  for (const b of document.querySelectorAll('[data-voice]')) b.setAttribute('aria-pressed', String(Number(b.dataset.voice) === activeVoice()));
  $('#undo').disabled = history.length === 0;
  $('#redo').disabled = future.length === 0;
  $('#full-play').textContent = state.playing?.which === 'mine' ? '\u25A0' : '\u25B6';
}

const options = (list, current) => list.map(([v, label]) => `<option value="${v}"${String(v) === String(current) ? ' selected' : ''}>${label}</option>`).join('');

function noteRow(n, v, i, selected) {
  const p = parsePitch(n.pitch);
  const letter = p ? p.letter : REST;
  return `<li data-v="${v}" data-i="${i}" class="${selected ? 'sel' : ''}">
        <span class="idx">${i + 1}</span>
        <select data-f="letter">${options([...LETTERS, REST].map((l) => [l, l === REST ? 'rest' : l]), letter)}</select>
        <select data-f="acc"${p ? '' : ' disabled'}>${options([[0, '♮'], [1, '♯'], [-1, '♭']], p?.acc ?? 0)}</select>
        <input data-f="octave" type="number" min="0" max="8" value="${p?.octave ?? 4}"${p ? '' : ' disabled'}>
        <select data-f="dur">${options(Object.entries(DURATIONS).map(([k, d]) => [k, d.name]), n.dur)}</select>
        <label class="dotbox" title="Dotted"><input data-f="dot" type="checkbox"${n.dot ? ' checked' : ''}>.</label>
        <button data-f="del" title="Delete note">×</button>
      </li>`;
}

function renderNoteList() {
  const which = state.target;
  const score = state[which];
  $('#notes-target').textContent = `— ${LABELS[which]}`;
  const sel = state.selected;
  const showTwo = hasSecondVoice(score) || activeVoice() === 2;
  const parts = [];
  for (const v of showTwo ? [1, 2] : [1]) {
    const notes = voiceNotes(score, v);
    if (showTwo) parts.push(`<li class="voice-head v${v}">Voice ${v} <small>${v === 1 ? 'upper' : 'lower'}</small></li>`);
    parts.push(...notes.map((n, i) => noteRow(n, v, i, sel?.which === which && sel.voice === v && sel.index === i)));
    if (!notes.length) parts.push('<li class="muted">No notes yet — click on the staff or type on the keyboard.</li>');
  }
  $('#note-list').innerHTML = parts.join('');
}

function onNoteListChange(e) {
  const li = e.target.closest('li[data-i]');
  if (!li || !e.target.dataset.f) return;
  const index = Number(li.dataset.i);
  const voice = Number(li.dataset.v);
  const which = state.target;
  const field = (f) => li.querySelector(`[data-f=${f}]`).value;
  const note = notesOf(which, voice)[index];
  commit(() => {
    const letter = field('letter');
    note.pitch = letter === REST ? REST : formatPitch({ letter, acc: Number(field('acc')), octave: clamp(Number(field('octave')) || 4, 0, 8) });
    note.dur = field('dur');
    if (li.querySelector('[data-f=dot]').checked) note.dot = true;
    else delete note.dot;
    state.selected = { which, voice, index };
  });
  if (note.pitch !== REST) beep(note.pitch);
}

function renderJson() {
  const ta = $('#json');
  $('#json-target').textContent = `— ${LABELS[state.target]}`;
  if (document.activeElement !== ta) {
    ta.value = stringifyScore(state[state.target]);
    $('#json-errors').innerHTML = '';
  }
}

function applyJson() {
  const errors = $('#json-errors');
  let raw;
  try {
    raw = JSON.parse($('#json').value);
  } catch (err) {
    errors.innerHTML = `<li>Invalid JSON: ${err.message}</li>`;
    return;
  }
  const v = validateScore(raw);
  if (!v.ok) {
    errors.innerHTML = v.errors.map((m) => `<li>${m}</li>`).join('');
    return;
  }
  $('#json').blur();
  const which = state.target;
  commit(() => {
    state[which] = v.score;
    state.selected = null;
    state.cursor = null;
    state.voiceChoice = null;
  });
}

const TAG = { pitch: 'Wrong pitch', duration: 'Wrong length', both: 'Wrong note', missing: 'Missing', extra: 'Extra' };

function renderResult() {
  const el = $('#result');
  const r = state.result;
  if (!r) {
    el.innerHTML = '<h2>Check</h2><p class="muted">Press <b>✔ Check</b> to compare My notes with the Original. Wrong notes are highlighted on both staves.</p>';
    return;
  }
  const { stats } = r;
  const bad = r.items.filter((it) => it.status !== 'ok');
  const mineIssues = barIssues(state.mine).map((i) => i.message);
  el.innerHTML = `
    <div class="summary ${r.passed ? 'pass' : 'fail'}">
      <span class="big">${stats.ok} / ${stats.total}</span>
      <span>${r.passed ? 'Perfect! Every note matches.' : `notes correct (${stats.percent}%)`}</span>
      ${r.passed && LIBRARY[state.lib.piece].exercises[state.lib.ex + 1] ? '<button class="primary" id="next-exercise">Next exercise \u2192</button>' : ''}
    </div>
    ${bad.length ? `<p class="stats">${stats.wrongPitch + stats.wrongBoth} wrong pitch · ${stats.wrongDuration + stats.wrongBoth} wrong length · ${stats.missing} missing · ${stats.extra} extra</p>` : ''}
    ${r.meta.length ? `<ul class="lint">${r.meta.map((m) => `<li>${m}</li>`).join('')}</ul>` : ''}
    ${mineIssues.length ? `<ul class="lint">${mineIssues.map((m) => `<li>My notes: ${m}</li>`).join('')}</ul>` : ''}
    ${bad.length ? `<ul class="issues">${bad
      .map((it) => `<li data-mine="${it.mineIndex === null ? '' : `${it.voice}:${it.mineIndex}`}"><span class="tag ${it.status}">${TAG[it.status]}</span><span>Bar ${it.bar}, note ${it.pos}${it.several ? ` (voice ${it.voice})` : ''}: ${it.message}</span></li>`)
      .join('')}</ul>` : ''}`;
}

// ---------- render ----------

function render() {
  const sel = state.selected;
  if (sel && !notesOf(sel.which, sel.voice)[sel.index]) state.selected = null;
  for (const which of WHICH) renderCard(which);
  renderLibrary();
  renderTop();
  renderKeyboard();
  syncToolbar();
  renderNoteList();
  renderJson();
  renderResult();
}

// ---------- wiring ----------

function bindToolbar() {
  $('#tool-dur').addEventListener('click', (e) => {
    const dur = e.target.closest('[data-dur]')?.dataset.dur;
    if (dur) setDur(dur);
  });
  $('#tool-acc').addEventListener('click', (e) => {
    const acc = e.target.closest('[data-acc]')?.dataset.acc;
    if (acc) setAcc(acc);
  });
  $('#tool-lock').addEventListener('click', () => {
    state.accLock = !state.accLock;
    render();
  });
  $('#tool-dot').addEventListener('click', () => setDot(!state.dot));
  $('#tool-rest').addEventListener('click', () => {
    state.rest = !state.rest;
    render();
  });
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#clear-mine').addEventListener('click', () => {
    commit(() => {
      const o = state.original;
      state.mine = emptyScore({ title: state.mine.title, clef: o.clef, key: o.key, time: o.time, tempo: o.tempo });
      state.selected = null;
      state.cursor = null;
      state.voiceChoice = null;
      state.target = 'mine';
    });
  });
  $('#check').addEventListener('click', () => {
    state.result = compare(state.original, state.mine);
    render();
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  $('#tool-voice').addEventListener('click', (e) => {
    const v = Number(e.target.closest('[data-voice]')?.dataset.voice);
    if (!v) return;
    if (state.voiceChoice === v) {
      state.voiceChoice = null; // pressing the picked voice again goes back to automatic
      render();
    } else setVoice(v);
  });

  $('#add-note').addEventListener('click', () => {
    const score = state[state.target];
    const last = voiceNotes(score, activeVoice()).at(-1);
    const pitch = state.rest ? REST : last && last.pitch !== REST ? last.pitch : score.clef === 'bass' ? 'D3' : 'B4';
    insertNote({ pitch, ...durationOf() });
  });
  $('#note-list').addEventListener('change', onNoteListChange);
  $('#note-list').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const index = Number(li.dataset.i);
    const voice = Number(li.dataset.v);
    if (e.target.dataset.f === 'del') {
      deleteSelectedOrAt(state.target, voice, index);
    } else if (!e.target.closest('select, input')) {
      select(state.target, voice, index);
    }
  });

  $('#result').addEventListener('click', (e) => {
    if (e.target.closest('#next-exercise')) return stepExercise(1);
    const [v, i] = (e.target.closest('li[data-mine]')?.dataset.mine ?? '').split(':');
    if (i !== undefined) select('mine', Number(v), Number(i));
  });

  $('#json-apply').addEventListener('click', applyJson);
  $('#json-copy').addEventListener('click', () => navigator.clipboard?.writeText($('#json').value));
  $('#json-download').addEventListener('click', () => {
    const score = state[state.target];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([stringifyScore(score)], { type: 'application/json' }));
    a.download = `${score.title.replace(/\W+/g, '-').toLowerCase() || 'score'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#json-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $('#json').value = await file.text();
    e.target.value = '';
    applyJson();
  });
}

/** Duration, dot and accidental are modes for the notes you enter next; they never change existing notes. */
function setDur(dur) {
  state.dur = dur;
  render();
}

function setAcc(acc) {
  state.acc = state.acc === acc ? 'auto' : acc;
  render();
}

function setDot(dot) {
  state.dot = dot;
  render();
}

const ACC_KEYS = { Digit3: '#', Digit4: 'b', Digit5: 'n' }; // Shift+3 sharp, Shift+4 flat, Shift+5 natural

/**
 * Delete a note. In voice 2 it becomes a rest so the notes after it keep their time.
 * Voice 1 stays a single line: the selection moves on to the next note and typing inserts at the gap.
 */
function deleteSelectedOrAt(which, voice, index) {
  const notes = notesOf(which, voice);
  commit(() => {
    deleteNote(notes, index, voice === 2);
    if (index < notes.length) {
      state.selected = { which, voice, index };
      state.cursor = { voice, t: startOf(notes, index), ...(voice === 1 && { insert: true }) };
    } else {
      // deleted the last note: the cursor is at the end again
      state.selected = notes.length ? { which, voice, index: notes.length - 1 } : null;
      state.cursor = voice === 1 ? null : { voice: 2, t: endTime(notes) };
    }
  });
}

/** Leave the notes behind: the cursor goes to the end of the voice, ready to add more. */
function goToEnd(voice) {
  const which = state.target;
  state.selected = null;
  state.cursor = voice === 1 ? null : { voice: 2, t: endTime(state[which].voice2) };
  render();
}

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyZ' || e.key.toLowerCase() === 'z')) {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const letterKey = keyFromCode(e.code);
  const played = letterKey && lookupKey(letterKey, state.octave);
  if (played && played.octave <= 8) {
    e.preventDefault();
    if (!e.repeat) {
      flashKey(letterKey);
      enterNote(played.letter, played.octave);
    }
    return;
  }
  if (e.code === 'Space' && !e.target.closest('button')) {
    e.preventDefault();
    if (!e.repeat) insertNote({ pitch: REST, ...durationOf() });
    return;
  }

  if (e.shiftKey && ACC_KEYS[e.code]) {
    e.preventDefault();
    return setAcc(ACC_KEYS[e.code]);
  }
  if (e.key === '.') return setDot(!state.dot);
  if (e.key in { 1: 1, 2: 1, 3: 1, 4: 1 }) return setDur(['w', 'h', 'q', 'e'][Number(e.key) - 1]);

  if (e.code === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    return setVoice(activeVoice() === 1 ? 2 : 1);
  }

  const which = state.target;
  if (e.key === 'Escape' && strict()) {
    state.voiceChoice = null;
    return render();
  }
  if (strict() && ['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    if (e.key === 'Home') return setCursorTime(state.voiceChoice, 0);
    if (e.key === 'End') return goToEnd(state.voiceChoice);
    return moveBySlot(e.key === 'ArrowLeft' ? -1 : 1);
  }
  if (e.key === 'Home') {
    e.preventDefault();
    if (state[which].notes.length) select(which, 1, 0);
    return;
  }
  if (e.key === 'End') {
    e.preventDefault();
    return goToEnd(1);
  }

  const sel = state.selected;
  if (!sel) {
    // nothing selected: the cursor is at the end, so Left steps back onto the last note
    if (e.key === 'ArrowLeft' && state[which].notes.length) {
      e.preventDefault();
      select(which, 1, state[which].notes.length - 1);
    }
    return;
  }
  const notes = notesOf(sel.which, sel.voice);
  const note = notes[sel.index];
  if (!note) return;
  const score = state[sel.which];
  const dir = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;

  if (dir && note.pitch !== REST) {
    e.preventDefault();
    commit(() => (note.pitch = pitchFromDia(score, diatonic(parsePitch(note.pitch)) + dir * (e.shiftKey ? 7 : 1))));
    beep(note.pitch);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    select(sel.which, sel.voice, Math.max(0, sel.index - 1));
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (sel.index < notes.length - 1) select(sel.which, sel.voice, sel.index + 1);
    else goToEnd(sel.voice);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelectedOrAt(sel.which, sel.voice, sel.index);
  }
});

const isHorizontal = () => state.full || landscapeMQ.matches;

function setZoom(z) {
  const old = state.zoom;
  state.zoom = Math.round(clamp(z, ZOOM_MIN, ZOOM_MAX) * 100) / 100;
  persist();
  if (state.full) {
    // scale about the middle of the visible board
    const c = boardCenter();
    board.x = c.x - ((c.x - board.x) * state.zoom) / old;
    board.y = c.y - ((c.y - board.y) * state.zoom) / old;
    applyBoard();
    return;
  }
  render();
}
const stepZoom = (dir) => setZoom(state.zoom * (dir > 0 ? 1.25 : 0.8));
$('#zoom-in').addEventListener('click', () => stepZoom(1));
$('#zoom-out').addEventListener('click', () => stepZoom(-1));
$('#zoom-reset').addEventListener('click', () => setZoom(1));

/** Scroll a sideways staff so the cursor / selected note is visible. */
function keepInView(staff) {
  const el = $('.note.selected', staff) ?? $('.cursor', staff);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const box = staff.getBoundingClientRect();
  if (r.right > box.right - 20) staff.scrollLeft += r.right - box.right + 60;
  else if (r.left < box.left + 20) staff.scrollLeft -= box.left - r.left + 60;
}

// both staves scroll together so the original and my notes stay lined up
let syncing = false;
function syncScroll(from) {
  if (syncing) return;
  syncing = true;
  for (const which of WHICH) if (cards[which].staff !== from) cards[which].staff.scrollLeft = from.scrollLeft;
  syncing = false;
}

// Touch on a sideways staff: one finger pans (with a little momentum), two fingers pinch to scale and keep the
// point between them in place. The staff has touch-action: none, so the browser never takes the gesture over.
const touches = new Map();
let pinch = null;
let gestureEnd = 0; // a tap right after a drag / pinch must not place a note
const scroller = () => (state.full ? $('.layout') : document.scrollingElement);
const staffsOf = () => WHICH.map((w) => cards[w].staff);

function startPinch(staff) {
  const [a, b] = [...touches.values()];
  const box = staff.getBoundingClientRect();
  const cx = (a.x + b.x) / 2 - box.left;
  pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.zoom, z: state.zoom, cx, anchor: (staff.scrollLeft + cx) / state.zoom, raf: 0 };
}

function movePinch(staff) {
  const [a, b] = [...touches.values()];
  if (!pinch) startPinch(staff);
  const z = clamp((pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist, ZOOM_MIN, ZOOM_MAX);
  pinch.z = z;
  $('#zoom-reset').textContent = `${Math.round(z * 100)}%`;
  if (isHorizontal()) {
    // the layout does not depend on the scale here: just resize the drawings, no re-layout while the fingers move
    for (const w of WHICH) {
      const svg = $('svg', cards[w].staff);
      if (svg && layouts[w]) svg.style.width = `${Math.round(layouts[w].width * z)}px`;
    }
    for (const st of staffsOf()) st.scrollLeft = pinch.anchor * z - pinch.cx;
  } else if (!pinch.raf) {
    pinch.raf = requestAnimationFrame(() => {
      if (!pinch) return;
      pinch.raf = 0;
      state.zoom = Math.round(pinch.z * 100) / 100;
      render();
    });
  }
}

function endPinch() {
  cancelAnimationFrame(pinch.raf);
  const { z, anchor, cx } = pinch;
  pinch = null;
  state.zoom = Math.round(z * 100) / 100;
  persist();
  render();
  if (isHorizontal()) for (const st of staffsOf()) st.scrollLeft = anchor * state.zoom - cx;
}

function bindPinch(staff) {
  let drag = null;
  let coast = 0;
  staff.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || state.full) return;
    cancelAnimationFrame(coast);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = touches.size === 1 ? { id: e.pointerId, moved: 0, vx: 0, t: e.timeStamp } : null;
  });
  staff.addEventListener('pointermove', (e) => {
    if (state.full) return;
    const t = touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      drag = null;
      movePinch(staff);
    } else if (drag?.id === e.pointerId && staff.classList.contains('h-scroll')) {
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved < 8) return; // still a tap
      const d = { x: dx, y: dy };
      staff.scrollLeft -= d.x;
      scroller().scrollTop -= d.y;
      const dt = Math.max(1, e.timeStamp - drag.t);
      drag.vx = 0.8 * drag.vx + 0.2 * (d.x / dt);
      drag.t = e.timeStamp;
    }
  });
  const up = (e) => {
    if (state.full || !touches.delete(e.pointerId)) return;
    if (pinch && touches.size < 2) {
      endPinch();
      gestureEnd = Date.now();
    }
    if (drag?.id === e.pointerId) {
      if (drag.moved >= 8) {
        gestureEnd = Date.now();
        let v = Math.abs(drag.vx) > 0.15 && e.timeStamp - drag.t < 80 ? drag.vx : 0; // px/ms, still moving at release
        const step = () => {
          if (Math.abs(v) < 0.02) return;
          staff.scrollLeft -= v * 16;
          v *= 0.95;
          coast = requestAnimationFrame(step);
        };
        step();
      }
      drag = null;
    }
  };
  staff.addEventListener('pointerup', up);
  staff.addEventListener('pointercancel', up);
  staff.addEventListener('scroll', () => syncScroll(staff), { passive: true });
}


// ---------- full screen: an endless board ----------
// The staves sit on one board (#cards) that is moved and scaled with a CSS transform: drag with one finger in any
// direction, pinch with two (the point between the fingers stays put), wheel / ctrl+wheel on a desktop.
const board = { x: 8, y: 20 };
const layoutEl = $('.layout');
const toolbarEl = $('.toolbar');
const boardView = () => {
  const w = toolbarEl.getBoundingClientRect().left || layoutEl.clientWidth; // the tool column is not part of the view
  return { w, h: layoutEl.clientHeight };
};
const boardCenter = () => {
  const v = boardView();
  return { x: v.w / 2, y: v.h / 2 };
};

/** Keep some of the board on screen, so it can be dragged far but never lost. */
function clampBoard() {
  const v = boardView();
  const cards$ = $('#cards');
  const w = cards$.offsetWidth * state.zoom;
  const h = cards$.offsetHeight * state.zoom;
  const keep = 80;
  board.x = clamp(board.x, keep - w, v.w - keep);
  board.y = clamp(board.y, keep - h, v.h - keep);
}

function applyBoard() {
  clampBoard();
  $('#cards').style.transform = `translate(${board.x.toFixed(1)}px, ${board.y.toFixed(1)}px) scale(${state.zoom})`;
  $('#zoom-reset').textContent = `${Math.round(state.zoom * 100)}%`;
}

/** Scale to z keeping the board point under (cx, cy) in place. */
function zoomAt(z, cx, cy) {
  z = clamp(z, ZOOM_MIN, ZOOM_MAX);
  board.x = cx - ((cx - board.x) * z) / state.zoom;
  board.y = cy - ((cy - board.y) * z) / state.zoom;
  state.zoom = z;
  applyBoard();
}

/** Scroll the board so the cursor / selected note is visible. */
function keepInBoard(staff) {
  const el = $('.note.selected', staff) ?? $('.cursor', staff);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const v = boardView();
  const m = 40;
  let moved = false;
  if (r.right > v.w - m) (board.x -= r.right - v.w + 2 * m), (moved = true);
  else if (r.left < m) (board.x += m - r.left + m), (moved = true);
  if (r.bottom > v.h - m) (board.y -= r.bottom - v.h + 2 * m), (moved = true);
  else if (r.top < m) (board.y += m - r.top + m), (moved = true);
  if (moved) applyBoard();
}

function bindBoard() {
  const pts = new Map();
  let drag = null;
  let pinchStart = null;
  let coast = 0;
  const mid = () => {
    const [a, b] = [...pts.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  layoutEl.addEventListener('pointerdown', (e) => {
    if (!state.full || e.pointerType !== 'touch' || e.target.closest('.toolbar')) return;
    cancelAnimationFrame(coast);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = pts.size === 1 ? { id: e.pointerId, moved: 0, vx: 0, vy: 0, t: e.timeStamp } : null;
    pinchStart = pts.size === 2 ? { ...mid(), z: state.zoom } : null;
  });
  layoutEl.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!state.full || !p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (pts.size === 2) {
      const before = mid();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = mid();
      board.x += now.x - before.x; // two fingers also drag the board
      board.y += now.y - before.y;
      if (pinchStart?.d) zoomAt(pinchStart.z * (now.d / pinchStart.d), now.x, now.y);
      else applyBoard();
      gestureEnd = Date.now();
      drag = null;
      return;
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag?.id !== e.pointerId) return;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved < 8) return; // still a tap
    board.x += dx;
    board.y += dy;
    applyBoard();
    const dt = Math.max(1, e.timeStamp - drag.t);
    drag.vx = 0.8 * drag.vx + 0.2 * (dx / dt);
    drag.vy = 0.8 * drag.vy + 0.2 * (dy / dt);
    drag.t = e.timeStamp;
  });
  const up = (e) => {
    if (!pts.delete(e.pointerId)) return;
    if (pinchStart) {
      pinchStart = null;
      gestureEnd = Date.now();
      persist();
      // the finger left over carries on as a pan, not as a tap
      const rest = [...pts.entries()][0];
      drag = rest ? { id: rest[0], moved: 99, vx: 0, vy: 0, t: e.timeStamp } : null;
      return;
    }
    if (drag?.id === e.pointerId) {
      if (drag.moved >= 8) {
        gestureEnd = Date.now();
        let { vx, vy } = e.timeStamp - drag.t < 80 ? drag : { vx: 0, vy: 0 }; // px/ms, still moving at release
        const step = () => {
          if (Math.hypot(vx, vy) < 0.02) return;
          board.x += vx * 16;
          board.y += vy * 16;
          vx *= 0.95;
          vy *= 0.95;
          applyBoard();
          coast = requestAnimationFrame(step);
        };
        step();
      }
      drag = null;
    }
  };
  layoutEl.addEventListener('pointerup', up);
  layoutEl.addEventListener('pointercancel', up);
  layoutEl.addEventListener(
    'wheel',
    (e) => {
      if (!state.full) return;
      e.preventDefault();
      if (e.ctrlKey) zoomAt(state.zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else {
        board.x -= e.deltaX;
        board.y -= e.deltaY;
        applyBoard();
      }
    },
    { passive: false }
  );
}
bindBoard();

/** Full screen: only the staves (an endless canvas to drag and scale) and the tools in a column on the right. */
function setFull(on) {
  state.full = on;
  document.documentElement.classList.toggle('full', on);
  // the tool column is fixed to the window: it cannot live inside the transformed board
  if (on) document.body.append(toolbarEl);
  else $('header', cards.mine.root).after(toolbarEl);
  $('#cards').style.transform = '';
  if (on) Object.assign(board, { x: 8, y: 20 });
  if (on) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  render();
  if (on) applyBoard();
}
$('#fullscreen').addEventListener('click', () => setFull(true));
$('#full-exit').addEventListener('click', () => setFull(false));
$('#full-play').addEventListener('click', () => togglePlay('mine'));
$('#full-zoom-in').addEventListener('click', () => stepZoom(1));
$('#full-zoom-out').addEventListener('click', () => stepZoom(-1));
landscapeMQ.addEventListener('change', render);

// re-lay the staff out when the window (or phone orientation) changes its width
let lastWidth = 0;
new ResizeObserver(() => {
  const w = cards.mine.staff.clientWidth;
  if (w && Math.abs(w - lastWidth) > 2) {
    lastWidth = w;
    render();
  }
}).observe($('#cards'));

buildCards();
buildLibrary();
buildKeyboard();
bindToolbar();
render();
