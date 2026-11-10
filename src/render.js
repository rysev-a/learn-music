import { CLEFS, REST, barLength, diatonic, endTime, keyAlterations, keySignature, parsePitch, parseTime, timeline, voiceNotes, voicesOf } from './score.js';

// Score -> SVG string. One staff step (line or space) = STEP px; line gap = 2 * STEP.
export const STEP = 5;
export const STAFF_H = 40;
export const MIN_STEP = -7;
export const MAX_STEP = 15;
const TOP_PAD = 44; // minimum room above / below the staff; grows when notes need more
const BOT_PAD = 44;
const STEM = 34;
const MARGIN_X = 10;
const ACC_W = 12;
const DOT_W = 8;
const NOTE_W = { w: 70, h: 50, q: 36, e: 28 };
const SECOND_W = 11; // room for a head shifted aside when the two voices are a second apart
const EPS = 1e-9;

// glyph baseline sits on the clef's reference line (G line / F line), counted in steps from the bottom line
const CLEF_GLYPH = {
  treble: { ch: '\u{1D11E}', step: 2, size: 84 },
  bass: { ch: '\u{1D122}', step: 6, size: 64 },
};

const FONT = `font-family="'Noto Music','Bravura Text','Apple Symbols','Segoe UI Symbol',serif"`;

export const bottomDia = (clef) => diatonic(parsePitch(CLEFS[clef].bottom));

// Which accidental sign (if any) each note needs: signs[voice][index]. Honours the key signature and
// bar memory, shared by both voices because they sit on the same staff.
function accidentals(score, times) {
  const keyMap = keyAlterations(score.key);
  const L = barLength(score);
  const signs = { 1: new Array(score.notes.length).fill(null), 2: new Array(score.voice2.length).fill(null) };
  const all = [];
  for (const v of voicesOf(score)) voiceNotes(score, v).forEach((n, i) => all.push({ v, i, n, start: times[v][i].start }));
  all.sort((a, b) => a.start - b.start || a.v - b.v);
  const memos = new Map();
  for (const { v, i, n, start } of all) {
    const p = parsePitch(n.pitch);
    if (!p) continue;
    const bar = Math.floor(start / L + EPS);
    if (!memos.has(bar)) memos.set(bar, {});
    const memo = memos.get(bar);
    const id = p.letter + p.octave;
    const current = id in memo ? memo[id] : keyMap[p.letter] ?? 0;
    if (p.acc !== current) signs[v][i] = p.acc > 0 ? '♯' : p.acc < 0 ? '♭' : '♮';
    memo[id] = p.acc;
  }
  return signs;
}

const f = (n) => Math.round(n * 10) / 10;

/** Stem direction of a single note. With two voices: voice 1 up, voice 2 down (up when it hangs below the staff). */
const stemDown = (v, step, two) => (two ? v === 2 && step >= 0 : step >= 4);

function drawRest(n, cx, mid, cls, v, i) {
  const dur = n.dur;
  let shape = '';
  if (dur === 'w') shape = `<rect class="fill" x="${cx - 8}" y="${mid - 10}" width="16" height="5"/>`;
  else if (dur === 'h') shape = `<rect class="fill" x="${cx - 8}" y="${mid - 5}" width="16" height="5"/>`;
  else if (dur === 'q') {
    shape = `<path class="line" d="M${cx - 3} ${mid - 15} L${cx + 3} ${mid - 7} L${cx - 3} ${mid + 1} L${cx + 3} ${mid + 9} C${cx - 7} ${mid + 6} ${cx - 7} ${mid + 15} ${cx - 1} ${mid + 14}"/>`;
  } else {
    shape = `<circle class="fill" cx="${cx - 3}" cy="${mid - 5}" r="2.6"/><path class="line" d="M${cx - 3} ${mid - 5} Q${cx + 2} ${mid - 4} ${cx + 4} ${mid - 8} L${cx - 2} ${mid + 12}"/>`;
  }
  if (n.dot) shape += `<circle class="fill" cx="${cx + 12}" cy="${mid - 5}" r="1.8"/>`;
  return `<g class="note ${cls}" data-v="${v}" data-i="${i}"><rect class="hit" x="${cx - 14}" y="${mid - 18}" width="32" height="36" rx="6"/>${shape}</g>`;
}

// two = both voices are on the staff: voice 1 stems up, voice 2 stems down, rests pushed apart
function drawNote(n, v, i, cx, sys, bDia, sign, cls, beam, two) {
  if (n.pitch === REST) return drawRest(n, cx, sys.staffBottom - 4 * STEP + (two ? (v === 1 ? -12 : 12) : 0), cls, v, i);
  const p = parsePitch(n.pitch);
  const step = diatonic(p) - bDia;
  const y = sys.staffBottom - step * STEP;
  let g = `<g class="note ${cls}" data-v="${v}" data-i="${i}"><rect class="hit" x="${cx - 15}" y="${f(y - 14)}" width="30" height="28" rx="6"/>`;

  const ledgers = [];
  if (step <= -2) for (let s = -2; s >= step; s -= 2) ledgers.push(s);
  if (step >= 10) for (let s = 10; s <= step; s += 2) ledgers.push(s);
  for (const s of ledgers) {
    const ly = sys.staffBottom - s * STEP;
    g += `<line class="ledger" x1="${cx - 11}" x2="${cx + 11}" y1="${ly}" y2="${ly}"/>`;
  }

  if (sign) g += `<text class="acc" x="${cx - 18}" y="${f(y + 7)}" font-size="24" ${FONT}>${sign}</text>`;

  const hollow = n.dur === 'w' || n.dur === 'h';
  const rot = n.dur === 'w' ? 0 : -20;
  g += `<ellipse class="head ${hollow ? 'hollow' : 'solid'}" cx="${cx}" cy="${f(y)}" rx="${n.dur === 'w' ? 7.2 : 6.4}" ry="4.6" transform="rotate(${rot} ${cx} ${f(y)})"/>`;

  if (n.dot) g += `<circle class="fill" cx="${cx + 12}" cy="${f(step % 2 === 0 ? y - STEP : y)}" r="1.8"/>`;

  if (n.dur !== 'w') {
    const down = beam ? beam.down : stemDown(v, step, two);
    const sx = down ? cx - 5.8 : cx + 5.8;
    const y2 = beam ? beam.endY : down ? y + 34 : y - 34;
    g += `<line class="stem" x1="${f(sx)}" x2="${f(sx)}" y1="${f(y)}" y2="${f(y2)}"/>`;
    if (beam) {
      if (beam.nextX !== null) {
        const nx = down ? beam.nextX - 5.8 : beam.nextX + 5.8;
        const by = down ? y2 - 2.2 : y2 + 2.2;
        g += `<line class="beam" x1="${f(sx - 0.8)}" x2="${f(nx + 0.8)}" y1="${f(by)}" y2="${f(by)}"/>`;
      }
    } else if (n.dur === 'e') {
      g += down
        ? `<path class="line" d="M${f(sx)} ${f(y2)} c0 -8 10 -12 9 -22"/>`
        : `<path class="line" d="M${f(sx)} ${f(y2)} c0 8 10 12 9 22"/>`;
    }
  }
  return `${g}</g>`;
}

// Runs of eighth notes inside one beat (dotted quarter in x/8 times) are joined by a beam, per voice.
function beamGroups(score, voice, tl) {
  const unit = parseTime(score.time).den === 8 ? 1.5 : 1;
  const L = barLength(score);
  const groups = [];
  let cur = null;
  let curBar = null;
  let curKey = null;
  voiceNotes(score, voice).forEach((n, i) => {
    if (n.dur === 'e' && !n.dot && n.pitch !== REST) {
      const bar = Math.floor(tl[i].start / L + EPS);
      const key = Math.floor((tl[i].start - bar * L) / unit + EPS);
      if (cur && bar === curBar && key === curKey) cur.push(i);
      else {
        cur = [i];
        curBar = bar;
        curKey = key;
        groups.push(cur);
      }
    } else cur = null;
  });
  return groups.filter((g) => g.length > 1);
}

export function layoutScore(score, width) {
  const bDia = bottomDia(score.clef);
  const ks = keySignature(score.key);
  const L = barLength(score);
  const voices = voicesOf(score);
  const two = voices.length === 2;
  const times = { 1: timeline(score.notes), 2: timeline(score.voice2) };
  const total = Math.max(endTime(score.notes), endTime(score.voice2));
  const nBars = total > 0 ? Math.ceil(total / L - EPS) : 0;
  const signs = accidentals(score, times);
  const avail = width - 2 * MARGIN_X;
  const headerW = (first) => 44 + (ks.letters.length ? ks.letters.length * 10 + 4 : 0) + (first ? 30 : 0);
  const stepOf = (n) => diatonic(parsePitch(n.pitch)) - bDia;

  // every distinct start time of a bar is one slot; both voices share the slot's x
  const bars = Array.from({ length: nBars }, () => new Map());
  for (const v of voices) {
    voiceNotes(score, v).forEach((n, i) => {
      const t = times[v][i].start;
      const bar = Math.min(nBars - 1, Math.floor(t / L + EPS));
      if (!bars[bar].has(t)) bars[bar].set(t, { t, items: [] });
      bars[bar].get(t).items.push({ v, i, n });
    });
  }
  const laid = bars.map((map) => {
    let x = 0;
    const slots = [...map.values()].sort((a, b) => a.t - b.t).map((slot) => {
      const shortest = slot.items.reduce((m, it) => (beats(it.n) < beats(m.n) ? it : m));
      const extra = slot.items.some((it) => signs[it.v][it.i]) ? ACC_W : 0;
      const dot = slot.items.some((it) => it.n.dot) ? DOT_W : 0;
      const both = slot.items.length === 2 && slot.items.every((it) => it.n.pitch !== REST);
      const aside = both && Math.abs(stepOf(slot.items[0].n) - stepOf(slot.items[1].n)) === 1;
      const base = NOTE_W[shortest.n.dur] + dot + (aside ? SECOND_W : 0);
      const cx = x + extra + base / 2;
      x += extra + base;
      return { ...slot, cx, aside };
    });
    return { slots, w: Math.max(x, 30) + 10 };
  });

  // room above and below the staff for the highest / lowest heads and their stems
  let above = 0;
  let below = 0;
  for (const v of voices) {
    for (const n of voiceNotes(score, v)) {
      if (n.pitch === REST) continue;
      const step = stepOf(n);
      const stem = n.dur === 'w' ? 0 : STEM;
      const down = stemDown(v, step, two);
      above = Math.max(above, (step - 8) * STEP + 6 + (down ? 0 : stem));
      below = Math.max(below, -step * STEP + 6 + (down ? stem : 0));
    }
  }
  const topPad = Math.max(TOP_PAD, Math.ceil(above) + 6);
  const botPad = Math.max(BOT_PAD, Math.ceil(below) + 6);
  const sysH = topPad + STAFF_H + botPad;

  const systems = [];
  let cur = null;
  for (const bar of laid) {
    if (!cur || (cur.bars.length && cur.used + bar.w > avail)) {
      const header = headerW(systems.length === 0);
      cur = { bars: [], header, used: header };
      systems.push(cur);
    }
    cur.bars.push(bar);
    cur.used += bar.w;
  }
  if (!systems.length) systems.push({ bars: [], header: headerW(true), used: headerW(true) });

  const pos = { 1: [], 2: [] };
  const slots = [];
  let maxX = width;
  systems.forEach((sys, si) => {
    const last = si === systems.length - 1;
    sys.top = si * sysH;
    sys.staffTop = sys.top + topPad;
    sys.staffBottom = sys.staffTop + STAFF_H;
    sys.x0 = MARGIN_X;
    const body = sys.used - sys.header;
    const scale = last || !body ? 1 : Math.max(1, (avail - sys.header) / body);
    let offset = 0;
    sys.barlines = [];
    sys.slots = [];
    for (const bar of sys.bars) {
      for (const slot of bar.slots) {
        const x = sys.x0 + sys.header + (offset + slot.cx) * scale;
        const entry = { t: slot.t, x, system: si };
        slots.push(entry);
        sys.slots.push(entry);
        slot.items.forEach((it) => {
          pos[it.v][it.i] = { x: x + (it.v === 2 && slot.aside ? SECOND_W : 0), system: si, t: slot.t };
        });
      }
      offset += bar.w;
      sys.barlines.push(sys.x0 + sys.header + offset * scale);
    }
    sys.x1 = sys.x0 + sys.header + offset * scale;
    if (last && !laid.length) sys.x1 = sys.x0 + avail;
    maxX = Math.max(maxX, sys.x1 + MARGIN_X);
  });

  return { systems, pos, slots, signs, bDia, width: maxX, height: systems.length * sysH, ks, two, times, total };
}

function beats(n) {
  return { w: 4, h: 2, q: 1, e: 0.5 }[n.dur] * (n.dot ? 1.5 : 1);
}

/** x of a point in time (for the input cursor): { x, system }. */
export function timeToX(layout, t) {
  const { slots, systems } = layout;
  if (!slots.length) return { x: systems[0].x0 + systems[0].header + 6, system: 0 };
  const exact = slots.find((s) => Math.abs(s.t - t) < EPS);
  if (exact) return { x: exact.x - 14, system: exact.system };
  const next = slots.find((s) => s.t > t);
  const prev = [...slots].reverse().find((s) => s.t < t);
  if (next && prev && prev.system === next.system) {
    return { x: prev.x + ((next.x - prev.x) * (t - prev.t)) / (next.t - prev.t), system: prev.system };
  }
  if (next) return { x: next.x - 14, system: next.system };
  const end = slots.at(-1);
  return { x: end.x + 26, system: end.system };
}

/** @returns {{ svg: string, layout: object }} */
export function renderScore(score, { width = 860, status = {}, selected = null, cursor = null, dim = null } = {}) {
  const layout = layoutScore(score, width);
  const { systems, bDia, ks } = layout;
  const parts = [];

  const beams = { 1: {}, 2: {} };
  for (const v of voicesOf(score)) {
    for (const g of beamGroups(score, v, layout.times[v])) {
      const sys = systems[layout.pos[v][g[0]].system];
      const steps = g.map((i) => diatonic(parsePitch(voiceNotes(score, v)[i].pitch)) - bDia);
      const avg = steps.reduce((a, b) => a + b, 0) / steps.length;
      const down = layout.two ? v === 2 && avg >= 0 : avg >= 4;
      const ys = steps.map((st) => sys.staffBottom - st * STEP);
      const endY = down ? Math.max(...ys) + 34 : Math.min(...ys) - 34;
      g.forEach((i, k) => {
        beams[v][i] = { down, endY, nextX: k < g.length - 1 ? layout.pos[v][g[k + 1]].x : null };
      });
    }
  }

  systems.forEach((sys, si) => {
    const lastSys = si === systems.length - 1;
    const { staffTop, staffBottom, x0 } = sys;
    // staff lines
    for (let k = 0; k < 5; k++) {
      const y = staffTop + k * 2 * STEP;
      parts.push(`<line class="staff-line" x1="${x0}" x2="${f(sys.x1)}" y1="${y}" y2="${y}"/>`);
    }
    parts.push(`<line class="bar" x1="${x0}" x2="${x0}" y1="${staffTop}" y2="${staffBottom}"/>`);

    // clef
    const clef = CLEF_GLYPH[score.clef];
    parts.push(`<text class="clef" x="${x0 + 4}" y="${staffBottom - clef.step * STEP}" font-size="${clef.size}" ${FONT}>${clef.ch}</text>`);

    // key signature
    const sigPitches = score.clef === 'treble'
      ? (ks.acc > 0 ? ['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4'] : ['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4'])
      : (ks.acc > 0 ? ['F3', 'C3', 'G3', 'D3', 'A2', 'E3', 'B2'] : ['B2', 'E3', 'A2', 'D3', 'G2', 'C3', 'F2']);
    ks.letters.forEach((_, k) => {
      const step = diatonic(parsePitch(sigPitches[k])) - bDia;
      const y = staffBottom - step * STEP;
      parts.push(`<text class="acc" x="${x0 + 44 + k * 10}" y="${f(y + 7)}" font-size="24" ${FONT}>${ks.acc > 0 ? '♯' : '♭'}</text>`);
    });

    // time signature (first system only)
    if (si === 0) {
      const [num, den] = score.time.split('/');
      const tx = x0 + sys.header - 18;
      parts.push(`<text class="time" x="${tx}" y="${staffTop + 19}" text-anchor="middle" font-size="26">${num}</text>`);
      parts.push(`<text class="time" x="${tx}" y="${staffTop + 39}" text-anchor="middle" font-size="26">${den}</text>`);
    }

    // bar lines
    sys.barlines.forEach((bx, k) => {
      const final = lastSys && k === sys.barlines.length - 1;
      parts.push(`<line class="bar" x1="${f(bx)}" x2="${f(bx)}" y1="${staffTop}" y2="${staffBottom}"/>`);
      if (final) parts.push(`<line class="bar thick" x1="${f(bx + 3.5)}" x2="${f(bx + 3.5)}" y1="${staffTop}" y2="${staffBottom}"/>`);
    });

    // notes
    for (const v of voicesOf(score)) {
      voiceNotes(score, v).forEach((n, i) => {
        const p = layout.pos[v][i];
        if (p.system !== si) return;
        const cls = [status[v]?.[i] ?? '', v === 2 ? 'v2' : '', dim === v ? 'dim' : '', selected && selected.voice === v && selected.index === i ? 'selected' : ''].join(' ').replace(/\s+/g, ' ').trim();
        parts.push(drawNote(n, v, i, f(p.x), sys, bDia, layout.signs[v][i], cls, beams[v][i], layout.two));
      });
    }
  });

  if (cursor) {
    const { x, system } = timeToX(layout, cursor.t);
    const sys = systems[system];
    parts.push(`<g class="cursor v${cursor.voice}"><line x1="${f(x)}" x2="${f(x)}" y1="${sys.staffTop - 12}" y2="${sys.staffBottom + 12}"/><circle cx="${f(x)}" cy="${sys.staffTop - 14}" r="7"/><text x="${f(x)}" y="${sys.staffTop - 10.5}" text-anchor="middle">${cursor.voice}</text></g>`);
  }

  const svg = `<svg class="staff-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(layout.width)} ${layout.height}" role="img" aria-label="${score.title}">${parts.join('')}</svg>`;
  return { svg, layout };
}

export const stepY = (sys, step) => sys.staffBottom - step * STEP;

/** Map a point in SVG coordinates to a staff step and a time (the slot to the right of x). */
export function hitTest(layout, x, y) {
  let sys = layout.systems[0];
  let best = Infinity;
  for (const s of layout.systems) {
    const d = Math.abs(y - (s.staffTop + STAFF_H / 2));
    if (d < best) {
      best = d;
      sys = s;
    }
  }
  const step = Math.max(MIN_STEP, Math.min(MAX_STEP, Math.round((sys.staffBottom - y) / STEP)));
  const slot = sys.slots.find((s) => x < s.x);
  let t = layout.total;
  if (slot) t = slot.t;
  else {
    const nextSys = layout.systems[layout.systems.indexOf(sys) + 1];
    if (nextSys?.slots.length) t = nextSys.slots[0].t;
  }
  return { system: sys, step, t, y: stepY(sys, step) };
}
