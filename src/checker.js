import { REST, durationName, hasSecondVoice, measures, midi, noteLabel, parsePitch, voiceNotes } from './score.js';

// Compare the user's notes with the original.
// Notes are aligned with an edit-distance walk so one missing/extra note
// doesn't mark everything after it as wrong.

const samePitch = (a, b) => a.pitch === b.pitch;
const sameDur = (a, b) => a.dur === b.dur && !!a.dot === !!b.dot;

function subCost(a, b) {
  if (samePitch(a, b) && sameDur(a, b)) return 0;
  return samePitch(a, b) || sameDur(a, b) ? 0.5 : 1;
}

function barOf(score, voice) {
  const bars = [];
  measures(score, voice).forEach((m) => m.notes.forEach((i, pos) => (bars[i] = { bar: m.index + 1, pos: pos + 1 })));
  return bars;
}

function enharmonic(a, b) {
  if (a.pitch === REST || b.pitch === REST || a.pitch === b.pitch) return false;
  return midi(parsePitch(a.pitch)) === midi(parsePitch(b.pitch));
}

function pairMessage(exp, got) {
  const pitchWrong = !samePitch(exp, got);
  const durWrong = !sameDur(exp, got);
  const kind = (n) => (n.pitch === REST ? 'rest' : n.pitch);
  const parts = [];
  if (pitchWrong) {
    parts.push(
      enharmonic(exp, got)
        ? `${got.pitch} sounds the same as ${exp.pitch}, but the notation is different (expected ${exp.pitch})`
        : `expected ${kind(exp)}, you wrote ${kind(got)}`,
    );
  }
  if (durWrong) parts.push(`expected ${durationName(exp)}, you wrote ${durationName(got)}`);
  return parts.join('; ');
}

/** Edit-distance alignment of two note lists: [{ o, m }] with null on the missing side. */
function align(a, b) {
  const n = a.length;
  const m = b.length;
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) cost[i][0] = i;
  for (let j = 1; j <= m; j++) cost[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[i][j] = Math.min(cost[i - 1][j - 1] + subCost(a[i - 1], b[j - 1]), cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + subCost(a[i - 1], b[j - 1])) {
      ops.push({ o: i - 1, m: j - 1 });
      i--;
      j--;
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      ops.push({ o: i - 1, m: null });
      i--;
    } else {
      ops.push({ o: null, m: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

/**
 * Compare the user's notes with the original, voice by voice.
 * byOriginal / byMine: { 1: { noteIndex: status }, 2: { ... } }
 */
export function compare(original, mine) {
  const byOriginal = { 1: {}, 2: {} };
  const byMine = { 1: {}, 2: {} };
  const items = [];
  const several = hasSecondVoice(original) || hasSecondVoice(mine);

  for (const voice of [1, 2]) {
    const a = voiceNotes(original, voice);
    const b = voiceNotes(mine, voice);
    const barsO = barOf(original, voice);
    const barsM = barOf(mine, voice);
    for (const { o, m: k } of align(a, b)) {
      const exp = o === null ? null : a[o];
      const got = k === null ? null : b[k];
      let status;
      let message = '';
      if (!got) {
        status = 'missing';
        message = `missing ${noteLabel(exp)}`;
      } else if (!exp) {
        status = 'extra';
        message = `extra note ${noteLabel(got)}`;
      } else {
        const pw = !samePitch(exp, got);
        const dw = !sameDur(exp, got);
        status = pw && dw ? 'both' : pw ? 'pitch' : dw ? 'duration' : 'ok';
        message = pairMessage(exp, got);
      }
      if (o !== null) byOriginal[voice][o] = status;
      if (k !== null) byMine[voice][k] = status;
      const where = (o !== null ? barsO[o] : barsM[k]) ?? { bar: 1, pos: 1 };
      items.push({ voice, several, status, message, originalIndex: o, mineIndex: k, bar: where.bar, pos: where.pos });
    }
  }

  const count = (s) => items.filter((it) => it.status === s).length;
  const ok = count('ok');
  const stats = {
    total: items.length,
    ok,
    wrongPitch: count('pitch'),
    wrongDuration: count('duration'),
    wrongBoth: count('both'),
    missing: count('missing'),
    extra: count('extra'),
    percent: items.length ? Math.round((100 * ok) / items.length) : 0,
  };

  const meta = [];
  for (const key of ['clef', 'key', 'time']) {
    if (original[key] !== mine[key]) meta.push(`${key}: expected ${original[key]}, you used ${mine[key]}`);
  }

  const passed = original.notes.length > 0 && ok === items.length && meta.length === 0;
  return { items, stats, meta, byOriginal, byMine, passed };
}
