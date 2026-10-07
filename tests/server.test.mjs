import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Console } from '../src/core/console.mjs';
import { makeColorBars } from '../tools/testroms.mjs';
import { test, eq, ok } from './harness.mjs';

const PORT = 8677;
const BASE = `http://localhost:${PORT}`;

function waitForServer(timeoutMs = 6000) {
  const t0 = Date.now();
  return (async function poll() {
    while (Date.now() - t0 < timeoutMs) {
      const up = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false);
      if (up) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  })();
}

test('static server: traversal blocked, index served, core modules reachable', async () => {
  const srv = spawn(process.execPath, ['scripts/server.mjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  try {
    ok(await waitForServer(), 'server came up');
    const index = await fetch(`${BASE}/`);
    eq(index.status, 200);
    ok((await index.text()).includes('NESTALGIA'), 'index served');

    // ../ escape attempts via percent-encoded dots and slashes
    for (const evil of [
      '/%2e%2e%2fpackage.json',
      '/..%2f..%2fpackage.json',
      '/%2e%2e/package.json',
      '/js/%2e%2e%2f%2e%2e%2fpackage.json',
    ]) {
      const res = await fetch(BASE + evil);
      ok(res.status === 404 || res.status === 403, `blocked ${evil} (got ${res.status})`);
    }
    // a 404 must not echo the server's absolute paths back
    const missing = await fetch(`${BASE}/no-such-file-${Date.now()}.nes`);
    eq(missing.status, 404);
    ok(!(await missing.text()).includes('nestalgia'), '404 body leaks no server paths');
    // legitimate deep paths still work
    const core = await fetch(`${BASE}/core/cpu.mjs`);
    eq(core.status, 200, 'core module reachable');
    ok((await core.text()).includes('class CPU'), 'core module content sane');
  } finally {
    srv.kill();
  }
});

test('static server: sibling dirs sharing the base name prefix are not readable', async () => {
  // regression: startsWith(base) without a trailing separator accepted
  // "public-notes" as if it were inside "public" — both vectors below used
  // to serve secret.txt with a 200
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  mkdirSync(join(root, 'public-notes'), { recursive: true });
  writeFileSync(join(root, 'public-notes', 'secret.txt'), 'TOPSECRET');
  const srv = spawn(process.execPath, ['scripts/server.mjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  try {
    ok(await waitForServer(), 'server came up');
    for (const evil of [
      '/js/..%2f..%2fpublic-notes%2fsecret.txt',
      '/%2f..%2fpublic-notes%2fsecret.txt',
    ]) {
      const res = await fetch(BASE + evil);
      ok(res.status === 404 || res.status === 403, `blocked ${evil} (got ${res.status})`);
    }
  } finally {
    rmSync(join(root, 'public-notes'), { recursive: true, force: true });
    srv.kill();
  }
});

test('console watch hook normalizes mirrored addresses', () => {
  const c = new Console(makeColorBars().rom);
  const hits = [];
  c.watchWrites.add(0x05);
  c.onWatchHit = (a) => hits.push(a);
  // a write to the $0805 mirror must hit the watch on $05
  c.cpuWrite(0x0805, 0x77);
  eq(hits, [0x05]);
});
