// Speed ("rhythm") in beats per minute, and the favourite speeds a user keeps.

export const TEMPO_MIN = 20;
export const TEMPO_MAX = 300;
export const TEMPO_DEFAULT = 120;
export const MAX_FAVORITES = 12;

/** A whole number of BPM inside the allowed range (the default for anything that is not a number). */
export const clampTempo = (v) => Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(Number(v)) || TEMPO_DEFAULT));

/** Saved favourites made safe: whole numbers in range, no repeats, ascending, at most MAX_FAVORITES. */
export function normalizeFavs(list) {
  if (!Array.isArray(list)) return [];
  const ok = list.filter((v) => Number.isInteger(v) && v >= TEMPO_MIN && v <= TEMPO_MAX);
  return [...new Set(ok)].sort((a, b) => a - b).slice(0, MAX_FAVORITES);
}

export const hasFav = (list, bpm) => list.includes(bpm);

/** The favourites with `bpm` added (when the list is full, the new one is not added). */
export const addFav = (list, bpm) => (list.length >= MAX_FAVORITES && !list.includes(bpm) ? [...list] : normalizeFavs([...list, bpm]));

export const removeFav = (list, bpm) => list.filter((v) => v !== bpm);

/** The traditional word for a speed, as a hint. */
export function tempoName(bpm) {
  if (bpm < 45) return 'Grave';
  if (bpm < 60) return 'Largo';
  if (bpm < 76) return 'Adagio';
  if (bpm < 108) return 'Andante';
  if (bpm < 120) return 'Moderato';
  if (bpm < 156) return 'Allegro';
  if (bpm < 176) return 'Vivace';
  return 'Presto';
}
