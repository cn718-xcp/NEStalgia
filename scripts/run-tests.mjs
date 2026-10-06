#!/usr/bin/env node
// Sequential test runner — `node --test` is known to hang on this machine,
// so we import every test file in order and aggregate with tests/harness.mjs.
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setFile, summary } from '../tests/harness.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const testDir = join(root, '..', 'tests');
const files = readdirSync(testDir).filter(f => f.endsWith('.test.mjs')).sort();

const t0 = Date.now();
for (const f of files) {
  setFile(f);
  await import(pathToFileURL(join(testDir, f)));
}
const dt = ((Date.now() - t0) / 1000).toFixed(1);
const okAll = summary();
console.log(`(${files.length} files, ${dt}s)`);
if (!okAll) process.exit(1);
