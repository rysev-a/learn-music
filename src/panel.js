// The right-hand tool panel (full screen) is a list of slots: a tool id, or null for an empty position. The list is
// laid out in rows of 2 or 3 cells (every cell keeps its place whatever is showing). A tool that is not in the list is
// hidden. These are the pure operations on it.

/** Tools that cannot be hidden: without them the user could not leave full screen or open the settings again. */
export const REQUIRED = ['settings', 'exit'];

/**
 * The factory layout. A tool that shows only when it applies (the eraser's two options, the bar-view controls) keeps
 * its cell, empty meanwhile, so the panel is always laid out exactly as the editor shows it.
 */
export const DEFAULT_ORDER = [
  'dur-w', 'dur-h', 'dur-q',
  'dur-e', 'dot', 'acc-#',
  'acc-b', 'acc-n', 'voice-1',
  'voice-2', 'rest', 'piano',
  'sound', 'undo', 'redo',
  'erase', 'erase-note', 'erase-bar',
  'check', 'play', 'pin',
  'zoom-out', 'zoom-in', 'settings',
  'bar-mode', 'bar-prev', 'bar-next',
  'bar-label', 'grid-size', 'exit',
];

const trim = (order) => {
  const out = [...order];
  while (out.length && out.at(-1) === null) out.pop();
  return out;
};

/**
 * A saved layout made safe: only known tools, each once, the required ones present (appended when missing).
 * Anything that is not an array gives the default layout.
 */
export function normalizeOrder(order, known = DEFAULT_ORDER) {
  if (!Array.isArray(order)) return [...DEFAULT_ORDER];
  const seen = new Set();
  const out = order.map((id) => {
    if (id === null) return null;
    if (typeof id !== 'string' || !known.includes(id) || seen.has(id)) return null;
    seen.add(id);
    return id;
  });
  for (const id of REQUIRED) if (!seen.has(id)) out.push(id);
  return trim(out);
}

/**
 * Put tool `id` into cell `index`. From another cell: the two swap (a tool dropped into an empty cell leaves a gap
 * behind). From the hidden tools: whatever was in the cell is hidden.
 */
export function placeTool(order, id, index) {
  const out = [...order];
  while (out.length <= index) out.push(null);
  const from = out.indexOf(id);
  if (from === index) return trim(out);
  const there = out[index];
  out[index] = id;
  if (from >= 0) out[from] = there;
  return trim(out);
}

/** Hide a tool (not a required one). */
export function removeTool(order, id) {
  if (REQUIRED.includes(id)) return [...order];
  return trim(order.map((q) => (q === id ? null : q)));
}

/** Close up the empty cells. */
export const removeGaps = (order) => order.filter((id) => id !== null);

/** Tools not on the panel, in the factory order. */
export const hiddenTools = (order, known = DEFAULT_ORDER) => known.filter((id) => !order.includes(id));

/** Icon colours to choose from: [name, #rrggbb]. */
export const PALETTE = [
  ['Red', '#e03131'], ['Orange', '#e8590c'], ['Yellow', '#f59f00'], ['Green', '#2f9e44'], ['Teal', '#0c8599'],
  ['Blue', '#4c6ef5'], ['Purple', '#845ef7'], ['Pink', '#d6336c'], ['Gray', '#868e96'],
];

/** Saved icon colours made safe: only known tools and #rrggbb values. */
export function normalizeColors(colors, known = DEFAULT_ORDER) {
  const out = {};
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return out;
  for (const [id, c] of Object.entries(colors)) if (known.includes(id) && typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) out[id] = c.toLowerCase();
  return out;
}

/** The colours with `id` set to `color` (null: back to the default colour). */
export function withColor(colors, id, color) {
  const out = { ...colors };
  if (color) out[id] = color;
  else delete out[id];
  return normalizeColors(out, Object.keys(out).concat(id));
}
