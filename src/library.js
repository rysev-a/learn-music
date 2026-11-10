import { validateScore } from './score.js';

// The exercise library: pieces -> exercises. Seeded from init.json (plain static file),
// cached in localStorage so the app still starts if the file can't be fetched.
const CACHE_KEY = 'learn-music:library:v1';

/** Live list, filled by setLibrary/loadLibrary; importers always see the current contents. */
export const LIBRARY = [];

function clean(data) {
  const list = Array.isArray(data) ? data : data?.library;
  if (!Array.isArray(list)) return null;
  const pieces = list
    .map((p) => ({
      title: String(p?.title ?? 'Untitled'),
      exercises: (Array.isArray(p?.exercises) ? p.exercises : []).filter((e) => e && validateScore(e.score).ok),
    }))
    .filter((p) => p.exercises.length > 0);
  return pieces.length ? pieces : null;
}

export function setLibrary(data) {
  const pieces = clean(data);
  if (!pieces) return false;
  LIBRARY.splice(0, LIBRARY.length, ...pieces);
  return true;
}

export const allExercises = () => LIBRARY.flatMap((p) => p.exercises);

export async function loadLibrary(url = 'init.json') {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const data = await res.json();
    if (setLibrary(data)) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
      return;
    }
  } catch (err) {
    console.warn('init.json not loaded, trying the localStorage copy', err);
  }
  try {
    if (setLibrary(JSON.parse(localStorage.getItem(CACHE_KEY)))) return;
  } catch {}
  throw new Error('No exercise library: init.json could not be loaded (serve the folder over http, not file://).');
}
