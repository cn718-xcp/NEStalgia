import { PPU, NES_PALETTE, SCREEN_W, SCREEN_H } from '../src/core/ppu.mjs';
import { test, eq, ok } from './harness.mjs';

function fakeCart(mirroring = 'H') {
  const chr = new Uint8Array(8192);
  return {
    mirroring, hardwired: true,
    ppuRead: (a) => chr[a & 0x1FFF],
    ppuWrite: (a, v) => { chr[a & 0x1FFF] = v; },
    _chr: chr,
  };
}

function boot(mirroring) {
  const cart = fakeCart(mirroring);
  const ppu = new PPU(cart);
  return { cart, ppu };
}

function runLine(ppu) {
  for (let d = 0; d <= 340; d++) ppu.tick();
}

// ---- registers -----------------------------------------------------------
test('$2002 read clears vblank and write toggle', () => {
  const { ppu } = boot();
  ppu.status |= 0x80;
  ppu.w = 1;
  const v = ppu.cpuRead(2);
  ok(v & 0x80);
  eq(ppu.status & 0x80, 0);
  eq(ppu.w, 0);
});

test('$2005/$2006 loopy writes', () => {
  const { ppu } = boot();
  ppu.cpuWrite(5, 0x7D); // x = coarse 15, fine 5
  ppu.cpuWrite(5, 0x5A); // y = coarse 11, fine 2
  eq(ppu.fineX, 5);
  eq(ppu.t & 0x1F, 0x0F);
  eq((ppu.t >> 5) & 0x1F, 0x0B);
  eq((ppu.t >> 12) & 7, 2);
  ppu.cpuWrite(6, 0x21); ppu.cpuWrite(6, 0x08);
  eq(ppu.v, 0x2108);
  eq(ppu.w, 0);
});

test('$2007 address increment 1 and 32', () => {
  const { ppu } = boot();
  ppu.cpuWrite(6, 0x20); ppu.cpuWrite(6, 0x00);
  ppu.cpuWrite(7, 0x11);
  eq(ppu.v & 0x3FFF, 0x2001);
  ppu.cpuWrite(0, 0x04); // inc 32
  ppu.cpuWrite(7, 0x22);
  eq(ppu.v & 0x3FFF, 0x2021);
});

test('$2007 read is buffered; palette reads are immediate', () => {
  const { ppu } = boot();
  ppu.vram[0] = 0xAB; ppu.vram[1] = 0xCD;
  ppu.cpuWrite(6, 0x20); ppu.cpuWrite(6, 0x00);
  eq(ppu.cpuRead(7), 0x00, 'first read returns stale buffer');
  eq(ppu.cpuRead(7), 0xAB);
  eq(ppu.cpuRead(7), 0xCD);
  ppu.palette[0x09] = 0x33;
  ppu.cpuWrite(6, 0x3F); ppu.cpuWrite(6, 0x09);
  eq(ppu.cpuRead(7), 0x33, 'palette immediate');
  eq(ppu.readBuffer, ppu.vram[ppu.ntIndex(0x3F09 & 0x2FFF)], 'buffer filled underneath');
});

test('palette mirroring quirks', () => {
  const { ppu } = boot();
  ppu.cpuWrite(6, 0x3F); ppu.cpuWrite(6, 0x10);
  ppu.cpuWrite(7, 0x2A);
  eq(ppu.palette[0], 0x2A, '$3F10 mirrors $3F00');
  ppu.cpuWrite(6, 0x3F); ppu.cpuWrite(6, 0x14);
  ppu.cpuWrite(7, 0x11);
  eq(ppu.palette[4], 0x11);
});

test('nametable mirroring modes', () => {
  const h = boot('H').ppu;
  eq(h.ntIndex(0x2000), 0); eq(h.ntIndex(0x2400), 0, 'H: 2400 mirrors 2000');
  eq(h.ntIndex(0x2800), 0x400); eq(h.ntIndex(0x2C00), 0x400);
  const v = boot('V').ppu;
  eq(v.ntIndex(0x2000), 0); eq(v.ntIndex(0x2400), 0x400);
  eq(v.ntIndex(0x2800), 0, '2800 mirrors 2000 in V'); eq(v.ntIndex(0x2C00), 0x400);
  const s0 = boot('S0').ppu;
  eq(s0.ntIndex(0x2000), 0); eq(s0.ntIndex(0x2C00), 0);
  const s1 = boot('S1').ppu;
  eq(s1.ntIndex(0x2000), 0x400); eq(s1.ntIndex(0x2C00), 0x400);
});

// ---- frame rendering -------------------------------------------------------
function setupBGScene(ppu, cart) {
  // tile 1: plane0 = 0xFF (color 1 everywhere), plane1 = 0
  for (let i = 0x10; i <= 0x17; i++) cart._chr[i] = 0xFF;
  // nametable all tile 1, attribute 0
  ppu.vram.fill(0x01);
  ppu.vram[0x3C0] = 0; // clear first attribute byte
  for (let i = 0x3C0; i < 0x400; i++) ppu.vram[i] = 0x00;
  ppu.palette[0] = 0x0F; ppu.palette[1] = 0x2A;
  ppu.palette[0x11] = 0x16;
  ppu.cpuWrite(0, 0x00);
  ppu.cpuWrite(1, 0x08); // BG on, no clipping
}

test('full frame: background renders expected color', () => {
  const { cart, ppu } = boot();
  setupBGScene(ppu, cart);
  for (let i = 0; i < 2 * 89342; i++) ppu.tick();
  const px = ppu.framebuffer[120 * SCREEN_W + 100];
  eq(px, NES_PALETTE[0x2A], 'pixel = green from palette[1]');
  eq(ppu.frameCount, 2);
});

test('vblank flag timing: set at 241, cleared at prerender', () => {
  const { ppu } = boot();
  ppu.scanline = 240; ppu.dot = 340;
  ppu.tick(); ppu.tick(); ppu.tick(); // -> 241 dot 1 sets vblank
  ok(ppu.status & 0x80, 'vblank set');
  ppu.scanline = 260; ppu.dot = 340;
  ppu.tick(); ppu.tick(); ppu.tick();
  eq(ppu.status & 0xE0, 0, 'flags cleared on prerender');
});

test('NMI line rises when vblank + enable', () => {
  const { ppu } = boot();
  ppu.cpuWrite(0, 0x80); // NMI enable
  ppu.scanline = 240; ppu.dot = 340;
  ppu.tick(); ppu.tick(); ppu.tick();
  ok(ppu.nmiLine, 'NMI line active during vblank');
  ppu.cpuWrite(0, 0x00);
  eq(ppu.nmiLine, false);
});

test('sprite renders at OAM position with palette from attr', () => {
  const { cart, ppu } = boot();
  ppu.oam[0] = 49; ppu.oam[1] = 1; ppu.oam[2] = 0x00; ppu.oam[3] = 50;
  for (let i = 0x10; i <= 0x17; i++) cart._chr[i] = 0xFF;
  ppu.palette[0] = 0x0F; ppu.palette[0x11] = 0x16;
  ppu.cpuWrite(0, 0x00);
  ppu.cpuWrite(1, 0x10); // sprites only
  for (let i = 0; i < 2 * 89342; i++) ppu.tick();
  eq(ppu.framebuffer[55 * SCREEN_W + 55], NES_PALETTE[0x16], 'sprite pixel');
  eq(ppu.framebuffer[55 * SCREEN_W + 49], NES_PALETTE[0x0F], 'just left of sprite = backdrop');
  eq(ppu.framebuffer[58 * SCREEN_W + 55], NES_PALETTE[0x0F], 'below sprite');
});

test('sprite horizontal + vertical flip', () => {
  const { cart, ppu } = boot();
  // tile 1 plane0: 10000000 -> only leftmost pixel color 1
  for (let i = 0x10; i <= 0x17; i++) cart._chr[i] = 0x80;
  ppu.oam[0] = 49; ppu.oam[1] = 1; ppu.oam[2] = 0x40; ppu.oam[3] = 50; // h-flip
  ppu.palette[0] = 0x0F; ppu.palette[0x11] = 0x16;
  ppu.cpuWrite(1, 0x10);
  for (let i = 0; i < 2 * 89342; i++) ppu.tick();
  eq(ppu.framebuffer[55 * SCREEN_W + 57], NES_PALETTE[0x16], 'flipped pixel lands on right');
  eq(ppu.framebuffer[55 * SCREEN_W + 50], NES_PALETTE[0x0F], 'left side empty');

  const { cart: c2, ppu: p2 } = boot();
  for (let i = 0x10; i <= 0x17; i++) c2._chr[i] = 0x80;
  p2.oam[0] = 49; p2.oam[1] = 1; p2.oam[2] = 0xC0; p2.oam[3] = 50; // h+v flip, 8x16? attr bit20 = 0x80|0x40
  p2.palette[0] = 0x0F; p2.palette[0x11] = 0x16;
  p2.cpuWrite(1, 0x10);
  for (let i = 0; i < 2 * 89342; i++) p2.tick();
  eq(p2.framebuffer[55 * SCREEN_W + 57], NES_PALETTE[0x16], 'v+h flip pixel at row 55 still visible');
});

test('sprite 0 hit flag', () => {
  const { cart, ppu } = boot();
  setupBGScene(ppu, cart);
  ppu.cpuWrite(1, 0x18); // bg + sprites
  ppu.oam[0] = 49; ppu.oam[1] = 1; ppu.oam[2] = 0; ppu.oam[3] = 100;
  for (let i = 0; i < 2 * 89342; i++) ppu.tick();
  ok(ppu.status & 0x40, 'sprite 0 hit detected');
});

test('sprite overflow flag with 9 sprites on a row', () => {
  const { cart, ppu } = boot();
  for (let i = 0; i < 9; i++) {
    ppu.oam[i * 4] = 49; ppu.oam[i * 4 + 1] = 1; ppu.oam[i * 4 + 2] = 0; ppu.oam[i * 4 + 3] = i * 20;
  }
  cart._chr[0x10] = 0xFF;
  ppu.cpuWrite(1, 0x10);
  for (let i = 0; i < 2 * 89342; i++) ppu.tick();
  ok(ppu.status & 0x20, 'overflow set');
});

test('8x16 sprites pick pattern bank from tile bit0', () => {
  const { cart, ppu } = boot();
  ppu.oam[0] = 49; ppu.oam[1] = 0x03; ppu.oam[2] = 0; ppu.oam[3] = 50; // tile 3: bit0=1 → bank 1
  for (let i = 0x1020; i <= 0x1027; i++) cart._chr[i] = 0xFF; // bank1 tile2 upper half ($1020)
  for (let i = 0x1030; i <= 0x1037; i++) cart._chr[i] = 0xFF; // lower half
  ppu.palette[0] = 0x0F; ppu.palette[0x11] = 0x16;
  ppu.cpuWrite(1, 0x10);
  ppu.cpuWrite(0, 0x20); // 8x16 sprites
  for (let i = 0; i < 2 * 89342; i++) ppu.tick();
  eq(ppu.framebuffer[55 * SCREEN_W + 55], NES_PALETTE[0x16]);
  eq(ppu.framebuffer[60 * SCREEN_W + 55], NES_PALETTE[0x16], '16 rows tall (row 60 still sprite)');
});

test('grayscale mask bit', () => {
  const { cart, ppu } = boot();
  setupBGScene(ppu, cart);
  ppu.cpuWrite(1, 0x09); // bg on + grayscale
  for (let i = 0; i < 2 * 89342; i++) ppu.tick();
  const px = ppu.framebuffer[120 * SCREEN_W + 100];
  eq(px, NES_PALETTE[0x2A & 0x30]);
});

test('PPU state roundtrip preserves framebuffer source data', () => {
  const { cart, ppu } = boot();
  setupBGScene(ppu, cart);
  for (let i = 0; i < 2 * 89342; i++) ppu.tick();
  const s = JSON.parse(JSON.stringify(ppu.toState()));
  const ppu2 = new PPU(cart);
  ppu2.fromState(s);
  for (let i = 0; i < 89342; i++) ppu.tick();
  for (let i = 0; i < 89342; i++) ppu2.tick();
  eq([...ppu2.framebuffer.slice(0, 64)], [...ppu.framebuffer.slice(0, 64)]);
});

test('screen dimensions', () => {
  eq(SCREEN_W, 256); eq(SCREEN_H, 240);
  eq(NES_PALETTE.length, 64);
});
