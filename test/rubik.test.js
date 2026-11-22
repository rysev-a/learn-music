import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solvedCube, applyMove, isSolved, invertMove, netCells, randomScramble } from '../apps/rubik/cube.js';

test('each face turn repeated 4 times is identity, and non-identity once', () => {
  for (const m of 'UDLRFB') {
    const c = solvedCube();
    applyMove(c, m);
    assert.equal(isSolved(c), false);
    for (let i = 0; i < 3; i++) applyMove(c, m);
    assert.equal(isSolved(c), true);
  }
});

test('R U R\' U\' has order 6', () => {
  const c = solvedCube();
  for (let i = 0; i < 6; i++) for (const m of ["R", "U", "R'", "U'"]) applyMove(c, m);
  assert.equal(isSolved(c), true);
});

test('a scramble undone by inverse moves is solved', () => {
  const s = randomScramble(25);
  const c = solvedCube();
  s.forEach((m) => applyMove(c, m));
  [...s].reverse().forEach((m) => applyMove(c, invertMove(m)));
  assert.equal(isSolved(c), true);
});

test('net has 54 distinct cells, 9 per colour on a solved cube', () => {
  const cells = netCells(solvedCube());
  assert.equal(new Set(cells.map((c) => c.col + ',' + c.row)).size, 54);
  const per = {};
  cells.forEach((c) => { per[c.color] = (per[c.color] || 0) + 1; assert.equal(c.color, c.face); });
  assert.deepEqual(Object.values(per), [9, 9, 9, 9, 9, 9]);
});

test('moves keep the net a bijection', () => {
  const c = solvedCube();
  randomScramble(30).forEach((m) => applyMove(c, m));
  assert.equal(new Set(netCells(c).map((x) => x.col + ',' + x.row)).size, 54);
});
