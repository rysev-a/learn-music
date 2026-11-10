// Computer keyboard as a note keyboard: three rows of keys, three octaves.
//   q w e r t y u i o  -> C D E F G A B C D   the top octave  (base + 2), i and o are the next C and D
//   a s d f g h j k    -> C D E F G A B C     the middle one  (base + 1, last key is the next C)
//   z x c v b n m      -> C D E F G A B       the lowest one  (base)
// "base" is the octave of the bottom row; the octave buttons move all three rows at once.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const ROWS = [
  { keys: 'qwertyuio', offset: 2 },
  { keys: 'asdfghjk', offset: 1 },
  { keys: 'zxcvbnm', offset: 0 },
];
export const MIN_BASE = 0;
export const MAX_BASE = 5; // the 'i' and 'o' keys reach base + 3, and octaves stop at 8

/** [{ key, letter, octave }] per row, top row first. */
export function keyLayout(base) {
  return ROWS.map((row) =>
    [...row.keys].map((key, i) => ({
      key,
      letter: LETTERS[i % 7],
      octave: base + row.offset + Math.floor(i / 7),
    })),
  );
}

/** Which note does this letter key play? null when it is not a note key. */
export function lookupKey(key, base) {
  for (const row of keyLayout(base)) {
    const hit = row.find((k) => k.key === key);
    if (hit) return { letter: hit.letter, octave: hit.octave };
  }
  return null;
}

/** "KeyQ" -> "q" (physical key, so it works with any keyboard language). */
export const keyFromCode = (code) => (/^Key[A-Z]$/.test(code ?? '') ? code[3].toLowerCase() : null);
