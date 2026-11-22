// Rubik's cube model (no DOM). The cube is 27 cubies x 6 faces = 162 face records
// {p: cubie position (-1..1)^3, n: outward normal, c: colour letter or null for inner faces}.
// A move rotates every face whose cubie lies in the layer by whole quarter turns.

export const COLORS = { U: '#f4f4f4', D: '#ffd500', F: '#00a651', B: '#0046ad', R: '#d62839', L: '#ff6a13' };
const NORMALS = { U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1], R: [1, 0, 0], L: [-1, 0, 0] };

export function solvedCube() {
  const faces = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++)
    for (const [name, n] of Object.entries(NORMALS)) {
      const p = [x, y, z];
      const outer = p[0] * n[0] + p[1] * n[1] + p[2] * n[2] === 1;
      faces.push({ p, n: [...n], c: outer ? name : null });
    }
  return faces;
}

// axis index, layer coordinate, dir = sign of the +90deg-about-axis rotation that is a clockwise turn seen from outside
const MOVES = {
  U: { axis: 1, layer: 1, dir: -1 }, D: { axis: 1, layer: -1, dir: 1 },
  R: { axis: 0, layer: 1, dir: -1 }, L: { axis: 0, layer: -1, dir: 1 },
  F: { axis: 2, layer: 1, dir: -1 }, B: { axis: 2, layer: -1, dir: 1 },
};

// "R" "R'" "R2" -> { axis, layer, quarter } where angle = quarter * 90deg about +axis
export function parseMove(s) {
  const m = MOVES[s[0]];
  if (!m) throw new Error('bad move ' + s);
  const q = s[1] === "'" ? -1 : s[1] === '2' ? 2 : 1;
  return { axis: m.axis, layer: m.layer, quarter: m.dir * q };
}

export function invertMove(s) {
  if (s[1] === '2') return s;
  return s[1] === "'" ? s[0] : s[0] + "'";
}

function rot90(v, axis, dir) {
  const [x, y, z] = v;
  if (axis === 0) return dir > 0 ? [x, -z, y] : [x, z, -y];
  if (axis === 1) return dir > 0 ? [z, y, -x] : [-z, y, x];
  return dir > 0 ? [-y, x, z] : [y, -x, z];
}

export function applyMove(cube, s) {
  const { axis, layer, quarter } = parseMove(s);
  const dir = Math.sign(quarter);
  for (const f of cube) {
    if (f.p[axis] !== layer) continue;
    for (let i = 0; i < Math.abs(quarter); i++) { f.p = rot90(f.p, axis, dir); f.n = rot90(f.n, axis, dir); }
  }
}

export function stateKey(cube) {
  return cube.filter((f) => f.c).map((f) => `${f.p}|${f.n}|${f.c}`).sort().join(';');
}
export const isSolved = (cube) => stateKey(cube) === stateKey(solvedCube());

const FACE_OF = (n) => (n[1] === 1 ? 'U' : n[1] === -1 ? 'D' : n[2] === 1 ? 'F' : n[2] === -1 ? 'B' : n[0] === 1 ? 'R' : 'L');
// Where each face sits in the unfolded net (cell units)
const NET_ORIGIN = { U: [3, 0], L: [0, 3], F: [3, 3], R: [6, 3], B: [9, 3], D: [3, 6] };
export const NET_SIZE = [12, 9];

// Flat "net" cells: one per coloured sticker, with its column/row in the 12x9 net.
export function netCells(cube) {
  const out = [];
  for (const f of cube) {
    if (!f.c) continue;
    const [x, y, z] = f.p;
    const face = FACE_OF(f.n);
    let col, row;
    switch (face) {
      case 'U': col = x + 1; row = z + 1; break;
      case 'D': col = x + 1; row = 1 - z; break;
      case 'F': col = x + 1; row = 1 - y; break;
      case 'B': col = 1 - x; row = 1 - y; break;
      case 'R': col = 1 - z; row = 1 - y; break;
      case 'L': col = z + 1; row = 1 - y; break;
    }
    out.push({ face, color: f.c, col: NET_ORIGIN[face][0] + col, row: NET_ORIGIN[face][1] + row });
  }
  return out;
}

export function randomScramble(n = 20, rnd = Math.random) {
  const letters = 'UDLRFB', mods = ['', "'", '2'], out = [];
  let lastAxis = -1;
  while (out.length < n) {
    const l = letters[Math.floor(rnd() * 6)];
    const axis = parseMove(l).axis;
    if (axis === lastAxis) continue; // avoid same-axis repeats (cancelling moves)
    lastAxis = axis;
    out.push(l + mods[Math.floor(rnd() * 3)]);
  }
  return out;
}
