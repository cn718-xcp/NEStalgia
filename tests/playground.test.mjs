// Playground demos: assemble each with src/lib/asm.mjs, run on the console,
// assert real rendered/behavioral outcomes — the exact pipeline the browser
// playground uses.
import { assemble, buildINES } from '../src/lib/asm.mjs';
import { buildPlaygroundCHR, DEMOS } from '../src/lib/demos.mjs';
import { Console } from '../src/core/console.mjs';
import { NES_PALETTE } from '../src/core/ppu.mjs';
import { test, eq, ok } from './harness.mjs';

function buildRom(source) {
  const { chunks } = assemble(source);
  const prg = new Uint8Array(16384);
  for (const c of chunks) prg.set(c.bytes, (c.addr - 0x8000) % 16384);
  return buildINES({ prg, chr: buildPlaygroundCHR(), mapper: 0, mirroring: 'H' });
}

const [hello, bounce, input] = DEMOS;

test('demo HELLO renders text and color bars', () => {
  const c = new Console(buildRom(hello.source));
  c.runFrames(6);
  // 'H' at row 10 (y80-87), col 8 (x64-71): glyph row 1 = %10001 → x64 lit
  eq(c.ppu.framebuffer[81 * 256 + 67], NES_PALETTE[0x30], 'H left stroke white');
  eq(c.ppu.framebuffer[81 * 256 + 71], NES_PALETTE[0x30], 'H right stroke white');
  eq(c.ppu.framebuffer[81 * 256 + 64], NES_PALETTE[0x0F], 'left margin black');
  // bars: row 20 (y160-167) tile $02 = color1, row 24 (y192) tile $03 = color2
  eq(c.ppu.framebuffer[163 * 256 + 100], NES_PALETTE[0x30], 'bar 1 color1');
  eq(c.ppu.framebuffer[195 * 256 + 100], NES_PALETTE[0x21], 'bar 2 color2');
});

test('demo BOUNCE integrates velocity and reflects at walls', () => {
  const c = new Console(buildRom(bounce.source));
  c.runFrames(30);
  // boot consumes ~2-3 frames, so allow 27-30 updates: x in [100+27*3, 100+30*3]
  ok(c.ram[0x00] >= 181 && c.ram[0x00] <= 190, `x integrates velocity (x=${c.ram[0x00]})`);
  // OAM mirrors the position one NMI behind (DMA runs before the update)
  const prevX = c.ram[0x00];
  c.runFrame();
  eq(c.ppu.oam[3], prevX, 'OAM follows one frame behind');
  // at x>=244 the ball reverses; after 100 frames it must have bounced
  c.runFrames(70);
  eq(c.ram[0x02], 0xFF, 'dx flipped to -1 after right wall');
  ok(c.ram[0x00] <= 244 && c.ram[0x00] >= 12, 'x stays within walls');
  ok(c.ram[0x01] <= 216 && c.ram[0x01] >= 16, 'y stays within walls');
});

test('demo INPUT moves the sprite with the controller', () => {
  const c = new Console(buildRom(input.source));
  c.runFrames(8); // boot
  c.controllers[0] = 0x80; // console bit7 -> game Right
  c.runFrames(20);
  c.controllers[0] = 0;
  ok(c.ram[0x00] > 120 + 34, `held right moves +2/frame (x=${c.ram[0x00]})`);
  const prevX = c.ram[0x00];
  c.runFrame();
  eq(c.ppu.oam[3], prevX, 'OAM follows one frame behind');
  c.controllers[0] = 0x40; // console bit6 -> game Left
  c.runFrames(10);
  ok(c.ram[0x00] < 160, 'held left moves back');
});

test('all demos assemble within a 16K PRG', () => {
  for (const d of DEMOS) {
    const { chunks } = assemble(d.source);
    for (const c of chunks) {
      if (c.addr >= 0xFFFA) continue; // vectors live in the 16K mirror
      ok(c.addr + c.bytes.length <= 0xC000, `${d.name}: code crosses 16K window at $${c.addr.toString(16)}`);
    }
  }
});
