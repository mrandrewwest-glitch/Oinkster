// Builds the static clickable demo into demo-dist/ (what Netlify publishes).
// The demo imports the real engine from src/, copied in as demo-dist/engine/.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}demo-dist`;

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/engine/providers`, { recursive: true });
cpSync(`${root}demo`, out, { recursive: true });
cpSync(`${root}src/domain`, `${out}/engine/domain`, { recursive: true });
cpSync(`${root}src/services`, `${out}/engine/services`, { recursive: true });
cpSync(`${root}src/store.js`, `${out}/engine/store.js`);
cpSync(`${root}src/providers/mock.js`, `${out}/engine/providers/mock.js`);
console.log('Demo built into demo-dist/');
