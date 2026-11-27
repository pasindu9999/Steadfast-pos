/** Copies the built app to a folder the update tests may change. */
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const built = fileURLToPath(new URL('../../apps/pos/dist', import.meta.url));
const copy = fileURLToPath(new URL('../.tmp/dist', import.meta.url));

rmSync(copy, { recursive: true, force: true });
cpSync(built, copy, { recursive: true });
