// The right-hand tool panel (full screen) is a list of slots: a tool id, or null for an empty position. The list is
// laid out in rows of 2 or 3 cells. A tool that is not in the list is hidden. These are the pure operations on it.

/** Tools that cannot be hidden: without them the user could not leave full screen or open the settings again. */
export const REQUIRED = ['settings', 'exit'];

/** The factory layout: the bar-view controls first (they only show in that view), then the tools as they always were. */
export const DEFAULT_ORDER = [
  'bar-prev', 'bar-label', 'bar-next', 'grid-size',
  'dur-w', 'dur-h', 'dur-q', 'dur-e', 'dot',
  'acc-#', 'acc-b', 'acc-n',
  'voice-1', 'voice-2', 'rest',
  'piano', 'sound',
  'erase', 'erase-note', 'erase-bar',
  'undo', 'redo', 'check',
  'play', 'zoom-out', 'zoom-in', 'bar-mode', 'pin', 'settings', 'exit',
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
