// Regenerates init.json (the seed library) from the seed definitions: node tools/build-init.js
import { writeFileSync } from 'node:fs';
import { LIBRARY } from './seed.js';

writeFileSync(new URL('../init.json', import.meta.url), JSON.stringify({ version: 1, library: LIBRARY }, null, 1) + '\n');
console.log(`wrote init.json: ${LIBRARY.length} pieces, ${LIBRARY.reduce((n, p) => n + p.exercises.length, 0)} exercises`);
