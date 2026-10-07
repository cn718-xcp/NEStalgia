#!/usr/bin/env node
// NEStalgia web server — zero-dependency static file server (node:http).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const romsDir = join(root, 'roms');
const PORT = Number(process.env.PORT || 8612);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.nes': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';

    // ROM files are served from roms/ (bundled homebrew only)
    let base = publicDir;
    if (path.startsWith('/roms/')) { base = romsDir; path = path.slice('/roms'.length); }
    // emulator core + lib ES modules are served straight from src/
    else if (path.startsWith('/core/')) { base = join(root, 'src', 'core'); path = path.slice('/core'.length); }
    else if (path.startsWith('/lib/')) { base = join(root, 'src', 'lib'); path = path.slice('/lib'.length); }

    const file = normalize(join(base, path));
    // must stay *inside* base, not merely share its name prefix — otherwise a
    // sibling like "public-notes" passes a bare startsWith(base) check
    const baseN = normalize(base);
    if (file !== baseN && !file.startsWith(baseN + sep)) { res.writeHead(403); res.end('forbidden'); return; }

    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    res.end(data);
  } catch {
    // no e.message here — ENOENT text contains the server's absolute paths
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404: not found');
  }
});

server.listen(PORT, () => {
  console.log(`NEStalgia running at http://localhost:${PORT}`);
});
