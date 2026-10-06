// NEStalgia — two-pass 6502 assembler, written from scratch.
// The opcode encoding map is derived from the CPU core's own TABLE, so the
// assembler and the emulator can never disagree about the instruction set.
//
// Syntax:
//   labels:   name:            (own line or leading an instruction)
//   numbers:  $hex  %bin  dec  'c'   ; expressions with + - * / & | ^ << >> ()
//   low/high: <expr  >expr      ; zero-page forward refs assemble as abs
//   directives: .org .byte/.db .word/.dw .align [fill]
//   comments: ; to end of line
import { TABLE } from '../src/core/cpu.mjs';

// name -> { mode -> lowest opcode }
const ENCODE = {};
for (let op = 0; op < 256; op++) {
  const [name, mode] = TABLE[op] || [];
  if (!name) continue;
  (ENCODE[name] ||= {});
  if (ENCODE[name][mode] === undefined) ENCODE[name][mode] = op;
}
ENCODE['NOP']['imp'] = 0xEA; // prefer the official NOP over illegal single-byte NOPs

const BRANCHES = new Set(['BPL', 'BMI', 'BVC', 'BVS', 'BCC', 'BCS', 'BNE', 'BEQ']);

export function assemble(src) {
  const symbols = Object.create(null);
  const errors = [];
  const lines = src.split(/\r?\n/);

  const items = []; // { kind, line, ... }
  lines.forEach((raw, idx) => {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) return;
    let rest = line;
    // leading label(s)
    while (true) {
      const m = rest.match(/^([A-Za-z_.][\w.]*)\s*:\s*/);
      if (!m) break;
      items.push({ kind: 'label', name: m[1], line: idx + 1 });
      rest = rest.slice(m[0].length);
    }
    if (!rest) return;
    if (rest.startsWith('.')) {
      const m = rest.match(/^\.(\w+)\s*(.*)$/);
      items.push({ kind: 'dir', dir: m[1].toLowerCase(), arg: m[2].trim(), line: idx + 1 });
    } else {
      const m = rest.match(/^([A-Za-z]{3})\s*(.*)$/);
      if (!m) { errors.push(`line ${idx + 1}: cannot parse "${raw.trim()}"`); return; }
      const name = m[1].toUpperCase();
      if (!ENCODE[name]) { errors.push(`line ${idx + 1}: unknown mnemonic ${name}`); return; }
      items.push({ kind: 'insn', name, operand: m[2].trim(), line: idx + 1 });
    }
  });

  // operand shape → asm addressing class
  function classify(operand, name, syms) {
    if (!operand) return { mode: 'imp', expr: null };
    if (/^[Aa]$/.test(operand) && ['ASL', 'LSR', 'ROL', 'ROR'].includes(name)) return { mode: 'acc', expr: null };
    if (operand.startsWith('#')) return { mode: 'imm', expr: operand.slice(1) };
    let m;
    if ((m = operand.match(/^\((.+),\s*[Xx]\)$/))) return { mode: 'izx', expr: m[1] };
    if ((m = operand.match(/^\((.+)\)\s*,\s*[Yy]$/))) return { mode: 'izy', expr: m[1] };
    if ((m = operand.match(/^\((.+)\)$/))) return { mode: 'ind', expr: m[1] };
    if ((m = operand.match(/^(.+)\s*,\s*[Xx]$/))) return splitXY(m[1], 'x', syms);
    if ((m = operand.match(/^(.+)\s*,\s*[Yy]$/))) return splitXY(m[1], 'y', syms);
    if (name === 'JMP' || name === 'JSR') return { mode: 'abs', expr: operand, force: true };
    if (BRANCHES.has(name)) return { mode: 'rel', expr: operand, force: true };
    return splitXY(operand, null, syms);
  }
  function splitXY(expr, axis, syms) {
    const v = tryEval(expr, syms);
    if (v === null) return axis === 'x' ? { mode: 'absx', expr } : axis === 'y' ? { mode: 'absy', expr } : { mode: 'abs', expr };
    if (v < 0x100) return axis === 'x' ? { mode: 'zpx', expr } : axis === 'y' ? { mode: 'zpy', expr } : { mode: 'zp', expr };
    return axis === 'x' ? { mode: 'absx', expr } : axis === 'y' ? { mode: 'absy', expr } : { mode: 'abs', expr };
  }
  function tryEval(expr, syms) {
    try { return evalExpr(expr, syms); } catch { return null; }
  }

  function sizeOf(mode) {
    switch (mode) {
      case 'imp': case 'acc': return 1;
      case 'imm': case 'zp': case 'zpx': case 'zpy': case 'izx': case 'izy': case 'rel': return 2;
      case 'abs': case 'absx': case 'absy': case 'ind': return 3;
      default: throw new Error(`bad mode ${mode}`);
    }
  }

  // ---- pass 1: sizes + symbol addresses ------------------------------------
  let pc = 0;
  const laid = [];
  for (const it of items) {
    if (it.kind === 'label') { symbols[it.name] = pc; continue; }
    if (it.kind === 'dir') {
      if (it.dir === 'org') { pc = evalExpr(it.arg, symbols); it.addr = pc; laid.push({ ...it, size: 0 }); continue; }
      if (it.dir === 'byte' || it.dir === 'db') {
        const vals = splitList(it.arg);
        it.size = vals.length; it.addr = pc; pc += it.size; laid.push(it); continue;
      }
      if (it.dir === 'word' || it.dir === 'dw') {
        const vals = splitList(it.arg);
        it.size = vals.length * 2; it.addr = pc; pc += it.size; laid.push(it); continue;
      }
      if (it.dir === 'align') {
        const n = evalExpr(it.arg, symbols);
        const fill = 0;
        const pad = (n - (pc % n)) % n;
        it.addr = pc; it.pad = pad; it.fillv = fill; pc += pad; laid.push(it); continue;
      }
      errors.push(`line ${it.line}: unknown directive .${it.dir}`);
      continue;
    }
    const cls = classify(it.operand, it.name, symbols);
    if (!ENCODE[it.name][cls.mode]) {
      errors.push(`line ${it.line}: ${it.name} has no ${cls.mode} addressing mode`);
      continue;
    }
    it.mode = cls.mode; it.expr = cls.expr;
    it.size = sizeOf(cls.mode); it.addr = pc; pc += it.size;
    laid.push(it);
  }

  // ---- pass 2: emit ---------------------------------------------------------
  const chunks = []; // {addr, bytes:[]}
  function emit(addr, byte) {
    let c = chunks[chunks.length - 1];
    if (!c || c.addr + c.bytes.length !== addr) { c = { addr, bytes: [] }; chunks.push(c); }
    c.bytes.push(byte & 0xFF);
  }
  for (const it of laid) {
    if (it.kind === 'dir') {
      if (it.dir === 'org') continue;
      if (it.dir === 'align') { for (let i = 0; i < it.pad; i++) emit(it.addr + i, it.fillv); continue; }
      const vals = splitList(it.arg);
      vals.forEach((v, i) => {
        const val = evalExpr(v, symbols);
        if (it.dir === 'byte' || it.dir === 'db') emit(it.addr + i, val);
        else { emit(it.addr + i * 2, val & 0xFF); emit(it.addr + i * 2 + 1, (val >> 8) & 0xFF); }
      });
      continue;
    }
    const opcode = ENCODE[it.name][it.mode];
    emit(it.addr, opcode);
    if (it.size === 1) continue;
    let val;
    if (it.mode === 'rel') {
      const target = evalExpr(it.expr, symbols);
      const off = target - (it.addr + 2);
      if (off < -128 || off > 127) throw new Error(`line ${it.line}: branch out of range (${off})`);
      val = off & 0xFF;
    } else {
      val = evalExpr(it.expr, symbols);
    }
    if (it.size === 2) emit(it.addr + 1, val);
    else { emit(it.addr + 1, val & 0xFF); emit(it.addr + 2, (val >> 8) & 0xFF); }
  }

  if (errors.length) { const e = new Error('assemble failed:\n  ' + errors.join('\n  ')); e.symbols = symbols; throw e; }
  return { chunks, symbols };
}

function splitList(arg) {
  if (!arg) return [];
  const out = []; let depth = 0, cur = '', q = false;
  for (const ch of arg) {
    if (ch === "'") { q = !q; cur += ch; continue; }
    if (!q) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// tiny recursive-descent expression evaluator: + - * / & | ^ << >> unary < > - ~ parens
export function evalExpr(src, syms) {
  let s = String(src).trim(), pos = 0;
  const peek = () => s[pos];
  function ws() { while (pos < s.length && /\s/.test(s[pos])) pos++; }
  function primary() {
    ws();
    const ch = peek();
    if (ch === undefined) throw new Error('unexpected end of expression');
    if (ch === '(') { pos++; const v = orE(); ws(); if (peek() !== ')') throw new Error('expected )'); pos++; return v; }
    if (ch === '<') { pos++; return primary() & 0xFF; }
    if (ch === '>') { pos++; return (primary() >> 8) & 0xFF; }
    if (ch === '-') { pos++; return -primary(); }
    if (ch === '+') { pos++; return primary(); }
    if (ch === '~') { pos++; return ~primary(); }
    if (ch === '$') {
      pos++; const m = s.slice(pos).match(/^[0-9a-fA-F]+/); if (!m) throw new Error('bad hex');
      pos += m[0].length; return parseInt(m[0], 16);
    }
    if (ch === '%') {
      pos++; const m = s.slice(pos).match(/^[01]+/); if (!m) throw new Error('bad bin');
      pos += m[0].length; return parseInt(m[0], 2);
    }
    if (ch === "'") {
      pos++; const c = s[pos]; pos++;
      if (s[pos] === "'") pos++;
      return c.charCodeAt(0);
    }
    if (/[0-9]/.test(ch)) {
      const m = s.slice(pos).match(/^[0-9]+/); pos += m[0].length; return parseInt(m[0], 10);
    }
    if (/[A-Za-z_.]/.test(ch)) {
      const m = s.slice(pos).match(/^[A-Za-z_.][\w.]*/); pos += m[0].length;
      const v = syms[m[0]];
      if (v === undefined) throw new Error(`undefined symbol ${m[0]}`);
      return v;
    }
    throw new Error(`unexpected '${ch}' in expression`);
  }
  function mulE() {
    let v = primary();
    while (true) {
      ws(); const c = peek();
      if (c === '*') { pos++; v *= primary(); }
      else if (c === '/') { pos++; v = Math.floor(v / primary()); }
      else if (c === '&') { pos++; v &= primary(); }
      else break;
    }
    return v;
  }
  function addE() {
    let v = mulE();
    while (true) {
      ws(); const c = peek();
      if (c === '+') { pos++; v += mulE(); }
      else if (c === '-') { pos++; v -= mulE(); }
      else if (c === '|') { pos++; v |= mulE(); }
      else if (c === '^') { pos++; v ^= mulE(); }
      else break;
    }
    return v;
  }
  function orE() {
    let v = addE();
    while (true) {
      ws();
      if (s.startsWith('<<', pos)) { pos += 2; v <<= addE(); }
      else if (s.startsWith('>>', pos)) { pos += 2; v >>= addE(); }
      else break;
    }
    return v;
  }
  const v = orE();
  ws();
  if (pos < s.length) throw new Error(`trailing input '${s.slice(pos)}'`);
  return v;
}

// Build an iNES-format ROM around assembled PRG/CHR.
export function buildINES({ prg, chr, mapper = 0, mirroring = 'H', battery = false }) {
  const prgBytes = typeof prg === 'number' ? new Uint8Array(prg) : prg;
  const chrBytes = typeof chr === 'number' ? new Uint8Array(chr) : chr;
  const prgBlocks = prgBytes.length / 16384;
  const chrBlocks = chrBytes.length / 8192;
  const header = new Uint8Array(16);
  header.set([0x4E, 0x45, 0x53, 0x1A]); // "NES\x1a"
  header[4] = prgBlocks;
  header[5] = chrBlocks;
  header[6] = (mirroring === 'V' ? 0x01 : 0x00) | (battery ? 0x02 : 0x00) | ((mapper & 0x0F) << 4);
  header[7] = (mapper & 0xF0);
  const out = new Uint8Array(16 + prgBytes.length + chrBytes.length);
  out.set(header, 0);
  out.set(prgBytes, 16);
  if (chrBytes.length) out.set(chrBytes, 16 + prgBytes.length);
  return out;
}
