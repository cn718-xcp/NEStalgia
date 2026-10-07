import { Console } from '../src/core/console.mjs';
import { NES_PALETTE } from '../src/core/ppu.mjs';
import { makeColorBars, makeSpriteScene, makeSpriteZeroHit } from '../tools/testroms.mjs';
import { buildStarfall } from '../tools/game.mjs';
import { test, eq, ok } from './harness.mjs';

function px(console_, x, y) { return console_.ppu.framebuffer[y * 256 + x]; }

test('colorbars ROM renders 4-palette striped scene', () => {
  const c = new Console(makeColorBars().rom);
  c.runFrames(6);
  eq(px(c, 8, 100), NES_PALETTE[0x21], 'pal0 color2');
  eq(px(c, 16, 100), NES_PALETTE[0x06], 'pal1 color1');
  eq(px(c, 8, 152), NES_PALETTE[0x2A], 'pal2 color2');
  eq(px(c, 16, 152), NES_PALETTE[0x0C], 'pal3 color1');
  eq(px(c, 0, 0), NES_PALETTE[0x01], 'top-left pal0 color1');
});

test('sprite scene: DMA, palettes, h/v flips', () => {
  const c = new Console(makeSpriteScene().rom);
  c.runFrames(6);
  eq(px(c, 62, 62), NES_PALETTE[0x14], 'sprite 0 solid');
  eq(px(c, 62, 81), NES_PALETTE[0x14], 'h-flip moves row-0 pattern to left half');
  eq(px(c, 66, 81), NES_PALETTE[0x0A], 'right half shows bg');
  eq(px(c, 62, 102), NES_PALETTE[0x1A], 'attr palette 1');
  eq(px(c, 66, 128), NES_PALETTE[0x14], 'v-flip moves row0 pattern to row7 (right half)');
  eq(px(c, 62, 121), NES_PALETTE[0x2C], 'top row empty after v-flip (pal3 c2 bg)');
});

test('sprite 0 hit polled by 6502 code (full loop: PPU flag -> CPU branch)', () => {
  const c = new Console(makeSpriteZeroHit().rom);
  c.runFrames(60);
  eq(c.ram[0x200], 1, 'ROM stored hit marker');
  eq(px(c, 100, 10), NES_PALETTE[0x21], 'bg intact above the hit line');
});

test('OAM DMA copies a page through the CPU bus', () => {
  const c = new Console(makeColorBars().rom);
  c.ram[0x300] = 42; c.ram[0x3FF] = 7;
  c.cpuWrite(0x4014, 0x03); // DMA $0300 -> OAM (applied on next CPU step)
  c.stepCycles();
  eq(c.ppu.oam[0], 42);
  eq(c.ppu.oam[255], 7);
});

test('OAM DMA fetches avoid PPU register side effects', () => {
  // regression: DMA reads used to go through cpuRead, so a source page in
  // $2000-$3FFF would clear the vblank flag via a $2002 "read"
  const c = new Console(makeColorBars().rom);
  c.ppu.status |= 0x80; // pretend vblank is set
  c.ppu.oamAddr = 0x00;
  c.ppu.oamDMA(0x20, (a) => c.dmaRead(a)); // source $2000-$20FF
  ok(c.ppu.status & 0x80, 'vblank flag survives a DMA fetch over $20xx');
  eq(c.ppu.oam[2], 0, 'side-effect registers read as 0 through the DMA path');
});

test('OAM DMA cycle count follows the get/put alignment (513/514)', () => {
  const c = new Console(makeColorBars().rom);
  c.runFrames(1);
  // hijack the PC into RAM NOPs so each step is a known 2-cycle instruction
  c.cpu.PC = 0x0010;
  c.ram[0x10] = 0xEA; c.ram[0x11] = 0xEA; c.ram[0x12] = 0xEA;
  for (let i = 0; i < 3; i++) {
    const c0 = c.cpu.cycles;
    c.dmaPending = 0x02;
    const total = c.stepCycles(); // NOP(2) + 513 + alignment cycle when odd
    eq(total, 515 + (c0 & 1), `DMA step ${i} (clock parity ${c0 & 1})`);
  }
});

test('controller shift register reads A,B,Select,Start,U,D,L,R', () => {
  const c = new Console(makeColorBars().rom);
  c.controllers[0] = 0b10110110;
  c.cpuWrite(0x4016, 1);
  c.cpuWrite(0x4016, 0);
  const reads = [];
  for (let i = 0; i < 8; i++) reads.push(c.cpuRead(0x4016) & 1);
  // bit0=A read first: buttons byte bit0 = 0 → reads: 0,1,1,0,1,1,0,1
  eq(reads, [0, 1, 1, 0, 1, 1, 0, 1]);
  eq(c.cpuRead(0x4016) & 0x0F, 0x01, 'signature after 8 reads');
  // strobe held: always returns A
  c.cpuWrite(0x4016, 1);
  eq(c.cpuRead(0x4016) & 1, 0);
  eq(c.cpuRead(0x4016) & 1, 0, 'still A while strobe held');
});

test('save state determinism: snapshot + replay matches original run', () => {
  const rom = makeSpriteScene().rom;
  const a = new Console(rom);
  a.runFrames(12);
  const snap = JSON.parse(JSON.stringify(a.toState()));
  a.runFrames(10);
  const b = new Console(rom);
  b.fromState(snap);
  b.runFrames(10);
  eq([...b.ppu.framebuffer.slice(0, 512)], [...a.ppu.framebuffer.slice(0, 512)]);
  eq(b.ppu.frameCount, a.ppu.frameCount);
  eq([...b.ram.slice(0, 64)], [...a.ram.slice(0, 64)]);
});

test('save states exclude the audio sample ring (rewind memory)', () => {
  // regression: apu.toState used to carry the 8192-float sampleBuf, bloating
  // every rewind-ring entry and IndexedDB save slot
  const c = new Console(makeSpriteScene().rom);
  c.runFrames(4);
  const s = JSON.parse(JSON.stringify(c.toState()));
  ok(!('sampleBuf' in s.apu) && !('sampleHead' in s.apu) && !('sampleTail' in s.apu),
    'audio ring must not be serialized');
  const b = new Console(makeSpriteScene().rom);
  b.fromState(s);
  eq(b.apu.pulse1.lengthCounter, c.apu.pulse1.lengthCounter, 'channel state still restored');
  b.runFrames(1);
  ok(b.apu.drainSamples(new Float32Array(64)) > 0, 'audio ring still produces after a load');
});

test('frame loop is bounded even for a jammed CPU', () => {
  // A ROM with no valid reset vector: PRG filled with 0x00 (BRK) — vector 0.
  const rom = new Uint8Array(16 + 16384);
  rom.set([0x4E, 0x45, 0x53, 0x1A, 1, 1, 0, 0]);
  const c = new Console(rom);
  let frames = 0;
  try { c.runFrames(2); frames = 2; } catch { /* jammed is fine */ }
  ok(frames === 2 || frames === 0, 'does not hang forever');
});

test('RAM write watchpoints fire through the console hook', () => {
  const c = new Console(buildStarfall().rom);
  const hits = [];
  c.watchWrites.add(0x05); // frameReady — written by every NMI
  c.onWatchHit = (addr, val) => hits.push([addr, val]);
  c.runFrames(8);
  ok(hits.length >= 3, `watchpoint fired ${hits.length} times`);
  ok(hits.every(([a]) => a === 0x05));
  c.watchWrites.delete(0x05);
  const n = hits.length;
  c.runFrames(2);
  eq(hits.length, n, 'removed watchpoints stop firing');
});

test('watchpoints survive console reset', () => {
  // regression: reset() used to replace watchWrites with a fresh Set and null
  // onWatchHit, silently killing debugger watchpoints after ⟲ reset
  const c = new Console(makeColorBars().rom);
  const dbgWatchSet = new Set([0x05]); // the debugger owns this instance
  let hits = 0;
  c.watchWrites = dbgWatchSet; // debugger attach()
  c.onWatchHit = () => hits++;
  c.cpuWrite(0x05, 0x11);
  eq(hits, 1);
  c.reset();
  eq(c.watchWrites, dbgWatchSet, 'reset keeps the debugger-attached set');
  c.cpuWrite(0x05, 0x22);
  eq(hits, 2, 'watchpoint still fires after reset');
});
