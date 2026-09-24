import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from './store.js';

/** Store snapshotted to a JSON file (server only). */
export function createFileStore(file) {
  if (!file) return new Store();
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  return new Store({
    data,
    persist: (d) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(d, null, 2));
    },
  });
}
