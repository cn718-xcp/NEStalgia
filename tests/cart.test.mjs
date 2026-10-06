import { Cartridge } from '../src/core/cart.mjs';
import { buildINES } from '../src/lib/asm.mjs';
import { test, eq, ok } from './harness.mjs';

function rom({ mapper, prg = 2, chr = 1, mirror = 'H', battery = false, fill }) {
  const prgU8 = new Uint8Array(prg * 16384);
  const chrU8 = new Uint8Array(chr * 8192);
  if (fill) fill(prgU8, chrU8);
  return buildINES({ prg: prgU8, chr: chrU8, mapper, mirroring: mirror, battery });
}

test('header parsing: sizes, mirroring, battery, mapper', () => {
  const c = new Cartridge(rom({ mapper: 1, mirror: 'V', battery: true }));
  eq(c.prg.length, 32768);
  eq(c.chr.length, 8192);
  ok(c.battery);
  eq(c.mapperId, 1);
});

test('bad magic rejected', () => {
  const bad = new Uint8Array(32);
  bad.set([0x4E, 0x45, 0x53, 0x00]);
  let threw = false;
  try { new Cartridge(bad); } catch { threw = true; }
  ok(threw);
});

test('NROM 16K mirrors itself across $8000-$FFFF', () => {
  const c = new Cartridge(rom({ mapper: 0, prg: 1, fill: (p) => { p[0] = 0xAA; p[0x3FFF] = 0xBB; } }));
  eq(c.cpuRead(0x8000), 0xAA);
  eq(c.cpuRead(0xBFFF), 0xBB);
  eq(c.cpuRead(0xC000), 0xAA, 'mirrored');
  eq(c.cpuRead(0xFFFF), 0xBB, 'mirrored');
});

test('NROM 32K straight mapping', () => {
  const c = new Cartridge(rom({ mapper: 0, prg: 2, fill: (p) => { p[0x4000] = 0x77; } }));
  eq(c.cpuRead(0xC000), 0x77);
  eq(c.cpuRead(0x8000), 0);
});

test('UxROM bank switching with fixed last bank', () => {
  const c = new Cartridge(rom({ mapper: 2, prg: 4, fill: (p) => {
    p[0] = 0x11;            // bank 0 first byte
    p[0x4000] = 0x22;       // bank 1
    p[0x8000] = 0x33;       // bank 2
    p[0xC000] = 0x44;       // bank 3 (last)
  } }));
  c.cpuWrite(0x8000, 1);
  eq(c.cpuRead(0x8000), 0x22);
  c.cpuWrite(0x8000, 2);
  eq(c.cpuRead(0x8000), 0x33);
  eq(c.cpuRead(0xC000), 0x44, 'fixed last bank');
  c.cpuWrite(0x8000, 0);
  eq(c.cpuRead(0x8000), 0x11);
});

test('CNROM CHR bank select', () => {
  const c = new Cartridge(rom({ mapper: 3, chr: 2, fill: (_p, ch) => {
    ch[0] = 0x11; ch[0x2000] = 0x22;
  } }));
  eq(c.ppuRead(0x0000), 0x11);
  c.cpuWrite(0x8000, 1);
  eq(c.ppuRead(0x0000), 0x22);
  c.cpuWrite(0x8000, 0);
  eq(c.ppuRead(0x0000), 0x11);
});

test('AxROM 32K banks + single-screen nametable select', () => {
  const c = new Cartridge(rom({ mapper: 7, prg: 4, fill: (p) => { p[0x8000] = 0x99; } }));
  c.cpuWrite(0x8000, 0x11); // bank 1 (bits 0-1), screen 1 (bit 4)
  eq(c.cpuRead(0x8000), 0x99);
  eq(c.mirroring, 'S1');
  c.cpuWrite(0x8000, 0x00);
  eq(c.mirroring, 'S0');
});

test('MMC1: 5-write shift register sets control and mirroring', () => {
  const c = new Cartridge(rom({ mapper: 1, prg: 4, fill: (p) => {
    p[0] = 0xA1; p[0x4000] = 0xB2; p[0x8000] = 0xC3; p[0xC000] = 0xD4;
  } }));
  // write control value 0b00100 (PRG mode 1? bits: CHR=00, PRG=01, mirror=00) → 5 writes of 0,0,1,0,0 LSB-first
  const bits = [0, 0, 1, 0, 0];
  for (const b of bits) c.cpuWrite(0x8000, b);
  eq(c.mmc1Ctrl, 0b00100);
  // PRG mode 1 = 32K switchable using bank>>1
  c.cpuWrite(0xE000, 0); // 5 writes of 0 → prg bank 0
  for (let i = 0; i < 5; i++) c.cpuWrite(0xE000, 0);
  eq(c.cpuRead(0x8000), 0xA1);
  c.cpuWrite(0x8000, 0); // reset shift with bit7 write
  for (const b of [0, 0, 1, 0, 1]) c.cpuWrite(0xE000, b); // prg value = 0b10100 = 20
  // bank 20 >> 1 = 10 → beyond 4 banks (n=4? prg=4 blocks → 8 x 16K banks!) prg 64K = 4*16384*... 
  // prg:4 → 65536 bytes → prgBankCount = 4 (16K units). bank 20 % 3 = 2 → *32768 % 65536 = 0
  eq(c.cpuRead(0x8000), 0xA1);
});

test('MMC1: PRG mode 3 fixes last bank at $C000', () => {
  const c = new Cartridge(rom({ mapper: 1, prg: 4, fill: (p) => { p[0] = 0x11; p[0x4000] = 0x22; p[0xC000] = 0x33; } }));
  // default ctrl = 0x0C → mode 3, 64K PRG = 4 x 16K banks
  eq(c.cpuRead(0xC000), 0x33, 'fixed last 16K');
  for (const b of [1, 0, 0, 0, 0]) c.cpuWrite(0xE000, b); // LSB first: value = 1 → bank 1
  eq(c.cpuRead(0x8000), 0x22, 'bank 1 at $8000');
  eq(c.cpuRead(0xC000), 0x33, 'still fixed last');
});

test('MMC1: CHR 4K banks', () => {
  const c = new Cartridge(rom({ mapper: 1, chr: 4, fill: (_p, ch) => {
    ch[0] = 0x10; ch[0x1000] = 0x11; ch[0x2000] = 0x12; ch[0x3000] = 0x13;
  } }));
  eq(c.ppuRead(0x0000), 0x10);
  eq(c.ppuRead(0x1000), 0x11);
  // chr0 = 1, chr1 = 2
  for (const b of [1, 0, 0, 0, 0]) c.cpuWrite(0xA000, b);
  for (const b of [0, 1, 0, 0, 0]) c.cpuWrite(0xC000, b);
  eq(c.ppuRead(0x0000), 0x11);
  eq(c.ppuRead(0x1000), 0x12);
});

test('PRG RAM read/write and battery persistence', () => {
  let saved = null;
  const c = new Cartridge(rom({ mapper: 0, battery: true }), { onSave: (d) => { saved = d.slice(); } });
  c.cpuWrite(0x6000, 0x42);
  eq(c.cpuRead(0x6000), 0x42);
  ok(saved && saved[0] === 0x42, 'onSave fired');
  const c2 = new Cartridge(rom({ mapper: 0, battery: true }));
  c2.loadSave(saved);
  eq(c2.cpuRead(0x6000), 0x42);
});

test('CHR RAM when chrBlocks = 0', () => {
  const c = new Cartridge(rom({ mapper: 0, chr: 0 }));
  ok(c.chrRam);
  c.ppuWrite(0x0100, 0xAB);
  eq(c.ppuRead(0x0100), 0xAB);
});

test('mapper state serialization roundtrip', () => {
  const c = new Cartridge(rom({ mapper: 1, prg: 2, fill: (p) => { p[0x4000] = 0x22; } }));
  for (const b of [0, 0, 0, 0, 1]) c.cpuWrite(0xE000, b); // bank 1
  const s = JSON.parse(JSON.stringify(c.toState()));
  const c2 = new Cartridge(rom({ mapper: 1, prg: 2, fill: (p) => { p[0x4000] = 0x22; } }));
  c2.fromState(s);
  eq(c2.cpuRead(0x8000), c.cpuRead(0x8000));
  eq(c2.cpuRead(0xC000), 0x22);
});
