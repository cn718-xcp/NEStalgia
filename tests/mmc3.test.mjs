import { Cartridge } from '../src/core/cart.mjs';
import { Console } from '../src/core/console.mjs';
import { NES_PALETTE } from '../src/core/ppu.mjs';
import { buildINES } from '../src/lib/asm.mjs';
import { makeMmc3IrqRom } from '../tools/testroms.mjs';
import { test, eq, ok } from './harness.mjs';

function rom({ mapper, prgBlocks = 8, chr = 8192, prgFill }) {
  const prg = new Uint8Array(prgBlocks * 16384);
  if (prgFill) prgFill(prg);
  return buildINES({ prg, chr, mapper, mirroring: 'H' });
}

// ---- mapper 66 / 11 / 34 ------------------------------------------------------
test('mapper 66 (GNROM): 32K PRG + 8K CHR select', () => {
  const c = new Cartridge(rom({ mapper: 66, prgFill: (p) => {
    p[0x00000] = 0x11; p[0x08000] = 0x22; p[0x10000] = 0x33; p[0x18000] = 0x44;
  } }));
  c.cpuWrite(0x8000, 0x10); // PRG bits 4-5 = 1
  eq(c.cpuRead(0x8000), 0x22);
  c.cpuWrite(0x8000, 0x23); // PRG bank 2, CHR bank 3
  eq(c.cpuRead(0x8000), 0x33);
});

test('mapper 11 (Color Dreams): CHR 4 bits, PRG 2 bits', () => {
  const c = new Cartridge(rom({ mapper: 11, prgFill: (p) => {
    p[0] = 0xAA; p[0x10000] = 0xBB;
  } }));
  c.cpuWrite(0x8000, 0x20); // PRG bank 2 (bits 4-5 = 2)
  eq(c.cpuRead(0x8000), 0xBB);
  c.cpuWrite(0x8000, 0x00);
  eq(c.cpuRead(0x8000), 0xAA);
});

test('mapper 34 (BNROM): 32K PRG select, CHR RAM fixed', () => {
  const c = new Cartridge(rom({ mapper: 34, chr: 0, prgFill: (p) => {
    p[0] = 0x11; p[0x8000] = 0x22; p[0x10000] = 0x33; p[0x18000] = 0x44;
  } }));
  ok(c.chrRam);
  c.ppuWrite(0x0100, 0xAB);
  eq(c.ppuRead(0x0100), 0xAB, 'CHR RAM writable, non-banked');
  c.cpuWrite(0x8000, 0x02);
  eq(c.cpuRead(0x8000), 0x33);
});

// ---- MMC3 (mapper 4) -----------------------------------------------------------
function mmc3Cart() {
  return new Cartridge(rom({ mapper: 4, prgFill: (p) => {
    // every 8KB bank starts with its own index byte
    for (let b = 0; b < p.length; b += 0x2000) p[b] = (b / 0x2000) & 0xFF;
  } }));
}

test('MMC3: PRG mode 0 — $8000/$A000 switchable, $C000 fixed -2, $E000 fixed -1', () => {
  const c = mmc3Cart();
  const n8 = c.prg.length >> 13;
  eq(c.cpuRead(0xE000), n8 - 1, 'fixed last bank');
  eq(c.cpuRead(0xC000), n8 - 2, 'fixed second-to-last');
  c.cpuWrite(0x8000, 0x06); c.cpuWrite(0x8001, 0x03); // R6 = 3
  eq(c.cpuRead(0x8000), 3);
  c.cpuWrite(0x8000, 0x07); c.cpuWrite(0x8001, 0x05); // R7 = 5
  eq(c.cpuRead(0xA000), 5);
});

test('MMC3: PRG mode 1 — $C000 switchable, $8000 fixed -2', () => {
  const c = mmc3Cart();
  c.cpuWrite(0x8000, 0x46); // cmd 6 with PRG mode bit (0x40)
  c.cpuWrite(0x8001, 0x02);
  const n8 = c.prg.length >> 13;
  eq(c.cpuRead(0x8000), n8 - 2, 'fixed');
  eq(c.cpuRead(0xC000), 2, 'switchable');
});

test('MMC3: CHR mode 0 — 2KB windows low, 1KB high', () => {
  const c = new Cartridge(rom({ mapper: 4, prgFill: () => {} }));
  for (let i = 0; i < c.chr.length; i++) c.chr[i] = (i >> 8) & 0xFF; // byte per 256-block
  c.cpuWrite(0x8000, 0x00); c.cpuWrite(0x8001, 5);  // R0 = 5 → 2KB @ $0000 (wraps: chr is 8K)
  eq(c.ppuRead(0x0000), ((5 * 2048) % 8192) >> 8);
  c.cpuWrite(0x8000, 0x02); c.cpuWrite(0x8001, 7);  // R2 = 7 → 1KB @ $1000
  eq(c.ppuRead(0x1000), (7 * 1024 >> 8) & 0xFF);
});

test('MMC3: CHR mode 1 swaps 1KB and 2KB regions', () => {
  const c = new Cartridge(rom({ mapper: 4, prgFill: () => {} }));
  for (let i = 0; i < c.chr.length; i++) c.chr[i] = (i + 1) & 0xFF;
  c.cpuWrite(0x8000, 0x82); // cmd store with CHR mode bit + cmd 2
  c.cpuWrite(0x8001, 3);    // R2 = 3 (1KB) → now at $0000
  eq(c.ppuRead(0x0000), c.chr[(3 * 1024) % 8192], '1KB bank R2 at low region');
  c.cpuWrite(0x8000, 0x80); // cmd 0 (2KB R0)
  c.cpuWrite(0x8001, 1);    // R0 = 1 → now at $1000
  eq(c.ppuRead(0x1000), c.chr[(1 * 2048) % 8192], '2KB bank R0 at high region');
});

test('MMC3: IRQ counter semantics (latch 3, reload, enable, ack)', () => {
  const c = mmc3Cart();
  c.cpuWrite(0xC000, 3);   // latch = 3
  c.cpuWrite(0xE000, 0);   // disable + ack
  c.cpuWrite(0xE001, 0);   // enable
  eq(c.irqLine, false);
  c.clockIrq(); eq(c.irqCounter, 2);
  c.clockIrq(); eq(c.irqCounter, 1);
  c.clockIrq(); eq(c.irqCounter, 0);
  eq(c.irqLine, true, 'asserted when counter hits 0');
  c.cpuWrite(0xE000, 0);   // ack
  eq(c.irqLine, false);
});

test('MMC3: reload flag forces latch on next edge', () => {
  const c = mmc3Cart();
  c.cpuWrite(0xC000, 10);
  c.cpuWrite(0xC001, 0);   // reload
  c.clockIrq();
  eq(c.irqCounter, 9, 'reloaded to latch then decremented once');
});

test('MMC3: IRQ is level-held until acknowledged', () => {
  const c = mmc3Cart();
  c.cpuWrite(0xC000, 1);
  c.cpuWrite(0xE001, 0);
  c.clockIrq(); // 0 -> assert
  c.clockIrq(); c.clockIrq(); // keeps firing / reloading
  eq(c.irqLine, true);
  c.cpuWrite(0xE000, 0);
  eq(c.irqLine, false);
});

test('MMC3: save state roundtrip preserves banks and IRQ counters', () => {
  const c = mmc3Cart();
  c.cpuWrite(0x8000, 0x07); c.cpuWrite(0x8001, 4);
  c.cpuWrite(0xC000, 20); c.cpuWrite(0xC001, 0);
  c.clockIrq(); c.clockIrq();
  const s = JSON.parse(JSON.stringify(c.toState()));
  const c2 = mmc3Cart();
  c2.fromState(s);
  eq(c2.cpuRead(0xA000), c.cpuRead(0xA000));
  eq(c2.irqCounter, c.irqCounter);
});

// ---- integration ROM: full loop through the console -----------------------------
test('MMC3 ROM: bank switching + scanline IRQ fire through real PPU timing', () => {
  const { rom: r } = makeMmc3IrqRom();
  eq(((r[6] >> 4) | (r[7] & 0xF0)), 4, 'header declares mapper 4');
  const c = new Console(r);
  c.runFrames(4);
  eq(c.ram[0x310], 0x5A, 'R6=0 window shows physical bank 0 signature');
  eq(c.ram[0x311], 0xA5, 'R7=1 window shows physical bank 1 signature');
  ok(c.ram[0x300] >= 10, `scanline IRQs fired (count=${c.ram[0x300]})`);
  eq(c.ppu.framebuffer[100 * 256 + 100], NES_PALETTE[0x30], 'NMI repainted palette to white after IRQ threshold');
});
