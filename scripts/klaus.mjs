#!/usr/bin/env node
// Runs the Klaus Dormann 6502 functional test (if tmp/klaus.bin exists) on a
// flat 64K bus with BCD enabled. Success = PC trapped in the success loop at
// $3469. Any other self-loop is a failing trap whose address pinpoints the
// broken instruction class.
//   Download: https://github.com/Klaus2m5/6502_65C02_functional_tests
//   bin_files/6502_functional_test.bin -> tmp/klaus.bin
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CPU } from '../src/core/cpu.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(root, 'tmp', 'klaus.bin');
if (!existsSync(binPath)) {
  console.error('tmp/klaus.bin not found — skipping Klaus functional test.');
  process.exit(2);
}

const mem = new Uint8Array(0x10000);
mem.set(readFileSync(binPath));
const bus = { cpuRead: a => mem[a], cpuWrite: (a, v) => { mem[a] = v; } };
const cpu = new CPU(bus, { bcd: true });
cpu.PC = 0x0400; // test entry; the reset vector points at the success loop

const SUCCESS = 0x3469; // documented success loop of this build (verified empirically)
const MAX = 500_000_000;
const t0 = Date.now();
let lastPC = -1, sameSamples = 0, prevPC = -1;

for (let i = 0; i < MAX; i++) {
  cpu.step();
  if (cpu.PC === SUCCESS) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`KLAUS FUNCTIONAL TEST: PASS (reached success loop at $${SUCCESS.toString(16)} after ${i + 1} instructions, ${dt}s)`);
    process.exit(0);
  }
  if ((i & 0xFFFFF) === 0) {
    if (cpu.PC === prevPC && cpu.PC !== lastPC) sameSamples = 1; else if (cpu.PC === prevPC) sameSamples++;
    else sameSamples = 0;
    lastPC = prevPC; prevPC = cpu.PC;
    if (sameSamples >= 3) {
      console.error(`KLAUS FUNCTIONAL TEST: FAIL — trapped in self-loop at $${cpu.PC.toString(16).padStart(4, '0')} after ${i + 1} instructions`);
      process.exit(1);
    }
    if ((i % 0x1000000) === 0) console.error(`  ... ${i} instrs, PC=$${cpu.PC.toString(16).padStart(4, '0')}`);
  }
}
console.error('KLAUS FUNCTIONAL TEST: FAIL — instruction budget exhausted');
process.exit(1);
