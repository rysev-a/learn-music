import { createCanvas } from '../../plugins/canvas/index.js';
import { COLORS, solvedCube, applyMove, parseMove, invertMove, isSolved, netCells, NET_SIZE, randomScramble } from './cube.js';

let cube = solvedCube();
let queue = [];            // { m, record }
let anim = null;           // { m, record, t, parsed }
let history = [];
let yaw = -0.6, pitch = 0.5;
let turnTime = 0.35;

// ---------- move handling ----------
const enqueue = (m, record = true) => { queue.push({ m, record }); };
function finishAnim() {
  if (!anim) return;
  applyMove(cube, anim.m);
  if (anim.record) history.push(anim.m);
  anim = null;
  renderHistory();
}
function flush() { finishAnim(); while (queue.length) { anim = { ...queue.shift() }; finishAnim(); } }
function step(dt) {
  if (!anim && queue.length) anim = { ...queue.shift(), t: 0, parsed: null };
  if (!anim) return;
  anim.parsed ||= parseMove(anim.m);
  anim.t += dt / (turnTime * (Math.abs(anim.parsed.quarter) === 2 ? 1.5 : 1));
  if (anim.t >= 1) finishAnim();
}
const ease = (t) => t * t * (3 - 2 * t);

function scramble() { flush(); randomScramble(20).forEach((m) => enqueue(m)); }
function reset() { queue = []; anim = null; cube = solvedCube(); history = []; renderHistory(); }
function solve() {
  flush();
  const undo = [...history].reverse().map(invertMove);
  history = [];
  undo.forEach((m) => enqueue(m, false));
  renderHistory();
}

// ---------- 3D ----------
const rotF = (v, axis, a) => {
  const c = Math.cos(a), s = Math.sin(a), [x, y, z] = v;
  if (axis === 0) return [x, y * c - z * s, y * s + z * c];
  if (axis === 1) return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function draw3d(ctx, { w, h, dt }) {
  step(dt);
  const D = 9, f = Math.min(w, h) * 1.55;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cam = (v) => { // yaw about y, then pitch about x
    const x = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
    return [x, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
  };
  const proj = (v) => { const k = f / (D - v[2]); return [w / 2 + v[0] * k, h / 2 - v[1] * k]; };

  const turning = anim && anim.parsed;
  const angle = turning ? anim.parsed.quarter * (Math.PI / 2) * ease(Math.min(1, anim.t)) : 0;

  const quads = [];
  for (const face of cube) {
    let p = face.p, n = face.n;
    if (turning && p[anim.parsed.axis] === anim.parsed.layer) {
      p = rotF(p, anim.parsed.axis, angle); n = rotF(n, anim.parsed.axis, angle);
    }
    const c = [p[0] + n[0] * 0.5, p[1] + n[1] * 0.5, p[2] + n[2] * 0.5];
    const cc = cam(c), nc = cam(n);
    if (nc[0] * -cc[0] + nc[1] * -cc[1] + nc[2] * (D - cc[2]) <= 0) continue; // back-facing
    const helper = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = cross(n, helper), len = Math.hypot(...u), uu = u.map((x) => x / len), vv = cross(n, uu);
    quads.push({ depth: D - cc[2], c, uu, vv, color: face.c });
  }
  quads.sort((a, b) => b.depth - a.depth);

  const corners = (q, s) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) =>
    proj(cam(q.c.map((x, i) => x + q.uu[i] * a * s + q.vv[i] * b * s))));
  const poly = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  ctx.lineJoin = 'round';
  for (const q of quads) {
    ctx.fillStyle = '#0b0b0b'; ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = 1;
    poly(corners(q, 0.5)); ctx.fill(); ctx.stroke();
    if (q.color) { ctx.fillStyle = COLORS[q.color]; poly(corners(q, 0.43)); ctx.fill(); }
  }
}

// ---------- flat diagram ----------
function drawFlat(ctx, { w, h }) {
  const [cols, rows] = NET_SIZE;
  const cell = Math.min((w - 24) / cols, (h - 36) / rows);
  const ox = (w - cell * cols) / 2, oy = (h - cell * rows) / 2 + 8;
  for (const t of netCells(cube)) {
    const x = ox + t.col * cell + cell / 2, y = oy + t.row * cell + cell / 2;
    ctx.fillStyle = COLORS[t.color];
    ctx.beginPath(); ctx.arc(x, y, cell * 0.38, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.font = `600 ${Math.max(10, cell * 0.28)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = getComputedStyle(document.body).color; ctx.globalAlpha = 0.5;
  for (const [name, [c, r]] of Object.entries({ U: [3, 0], L: [0, 3], F: [3, 3], R: [6, 3], B: [9, 3], D: [3, 6] }))
    ctx.fillText(name, ox + (c + 1.5) * cell, oy + (r + 1.5) * cell);
  ctx.globalAlpha = 1;
  if (isSolved(cube) && !anim && !queue.length) { ctx.textAlign = 'left'; ctx.fillText('solved', 12, h - 12); }
}

// ---------- UI ----------
createCanvas(document.getElementById('v3d'), {
  draw: draw3d,
  onDrag: ({ type, dx, dy }) => {
    if (type !== 'move') return;
    yaw += dx * 0.01; pitch = Math.max(-1.4, Math.min(1.4, pitch + dy * 0.01));
  },
});
createCanvas(document.getElementById('vflat'), { draw: drawFlat });

const controls = document.getElementById('controls');
const btn = (label, fn, title) => { const b = document.createElement('button'); b.textContent = label; if (title) b.title = title; b.onclick = fn; controls.append(b); };
const sep = () => { const s = document.createElement('span'); s.className = 'sep'; controls.append(s); };
for (const l of 'UDLRFB') { btn(l, () => enqueue(l)); btn(l + "'", () => enqueue(l + "'")); }
sep(); btn('Scramble', scramble); btn('Solve', solve, 'play the history backwards'); btn('Reset', reset);
sep();
const speed = document.createElement('input'); speed.type = 'range'; speed.min = 0.08; speed.max = 1; speed.step = 0.01; speed.value = 1.08 - turnTime;
speed.title = 'speed'; speed.oninput = () => { turnTime = 1.08 - speed.value; }; controls.append(speed);

function renderHistory() { document.getElementById('hist').textContent = history.length ? history.join(' ') : 'Keys: U D L R F B (Shift = counter-clockwise)'; }
renderHistory();
addEventListener('keydown', (e) => {
  const k = e.key.toUpperCase();
  if (k.length === 1 && 'UDLRFB'.includes(k) && !e.ctrlKey && !e.metaKey) enqueue(e.shiftKey ? k + "'" : k);
});
