#!/usr/bin/env node
// Sequential test runner — node --test is known to hang on this machine, so
// we import every test file in order and report pass/fail aggregates ourselves.
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const testDir = join(root, '..', 'tests');

const harness = { passed: 0, failed: 0, current: null, failures: [] };

export function test(name, fn) {
  harness.current = name;
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') throw new Error('async tests not supported by runner');
    harness.passed++;
  } catch (err) {
    harness.failed++;
    harness.failures.push({ name, err: String(err && err.message || err) });
  }
  harness.current = null;
}

export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${b}, got ${a}`);
  }
}

export function ok(cond, msg = '') {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function near(actual, expected, tol, msg = '') {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${expected} ±${tol}, got ${actual}`);
  }
}

const files = readdirSync(testDir).filter(f => f.endsWith('.test.mjs')).sort();
const t0 = Date.now();
for (const f of files) {
  const before = `${harness.passed}/${harness.failed}`;
  await import(pathToFileURL(join(testDir, f)));
  const gained = harness.passed + harness.failed;
  console.log(`  ${f}: ${harness.passed + harness.failed - (Number(before.split('/')[0]) + Number(before.split('/')[1]))} checks [${gained}]`);
}
const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${harness.passed} passed, ${harness.failed} failed in ${dt}s (${files.length} files)`);
if (harness.failures.length) {
  for (const f of harness.failures) console.error(`  FAIL ${f.name}: ${f.err}`);
  process.exit(1);
}
