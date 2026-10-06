import { Console } from '../src/core/console.mjs';
import { buildStarfall } from '../tools/game.mjs';
import { test, eq, ok } from './harness.mjs';

const START = 0x08; // console bit3 -> game Start
const RIGHT = 0x80; // console bit7 -> game Right

const { rom } = buildStarfall();

function boot() {
  const c = new Console(rom);
  c.runFrames(30); // title screen up
  return c;
}

function startPlay(c) {
  c.controllers[0] = START;
  c.runFrames(2);
  c.controllers[0] = 0;
  c.runFrames(3);
  eq(c.ram[0x00], 1, 'state = play');
}

test('ROM assembles and boots to title state without jamming', () => {
  const c = boot();
  eq(c.ram[0x00], 0, 'state = title');
  ok(c.ppu.frameCount >= 30);
  ok(c.ppu.framebuffer[10 * 256 + 100] !== 0, 'title screen has pixels');
});

test('START transitions title -> play', () => {
  const c = boot();
  startPlay(c);
  eq(c.ram[0x01], 0, 'score');
  eq(c.ram[0x02], 3, 'lives');
  eq(c.ram[0x03], 120, 'playerX centered');
  eq(c.ppu.oam[1], 0xA2, 'player top tile');
});

test('holding RIGHT moves the ship', () => {
  const c = boot();
  startPlay(c);
  c.controllers[0] = RIGHT;
  c.runFrames(20);
  c.controllers[0] = 0;
  c.runFrame(); // OAM DMA copies the shadow page one frame later
  eq(c.ram[0x03], 160, 'playerX += 2/frame');
  eq(c.ppu.oam[3], 160, 'OAM x follows');
});

test('catching a bright star scores', () => {
  const c = boot();
  startPlay(c);
  // park the ship far from any random star traffic
  c.ram[0x03] = 20;
  // inject a deterministic bright star in slot 1
  c.ram[0x25] = 1;    // starsOn[1]
  c.ram[0x11] = 40;   // starsY[1]
  c.ram[0x16] = 20;   // starsX[1]
  c.ram[0x1B] = 4;    // starsSpd[1]
  c.ram[0x20] = 0;    // starsTyp[1] = bright
  let scored = false;
  for (let f = 0; f < 200 && !scored; f++) {
    c.ram[0x02] = 9; // keep lives topped up: random traffic must not end the run
    c.runFrame();
    if (c.ram[0x01] > 0) scored = true;
  }
  eq(scored, true, `score incremented`);
  eq(c.ram[0x25], 0, 'star consumed');
});

test('dark stars cost a life (with invulnerability window)', () => {
  const c = boot();
  startPlay(c);
  c.ram[0x03] = 20;
  c.ram[0x25] = 1;    // starsOn[1]
  c.ram[0x11] = 40;   // starsY[1]
  c.ram[0x16] = 20;   // starsX[1] = ship x
  c.ram[0x1B] = 4;    // fast
  c.ram[0x20] = 1;    // dark
  let damaged = false;
  for (let f = 0; f < 200 && !damaged; f++) {
    c.runFrame();
    if (c.ram[0x02] < 3) damaged = true;
  }
  eq(damaged, true, 'lives dropped');
  ok(c.ram[0x09] > 0 || c.ram[0x02] === 2, 'invulnerability window opened');
});

test('invulnerability blocks immediate re-damage', () => {
  const c = boot();
  startPlay(c);
  c.ram[0x03] = 20;
  const spawnDark = () => {
    c.ram[0x25] = 1; c.ram[0x11] = 40; c.ram[0x16] = 20; c.ram[0x1B] = 4; c.ram[0x20] = 1;
  };
  spawnDark();
  for (let f = 0; f < 60; f++) c.runFrame(); // first hit lands
  eq(c.ram[0x02], 2, 'first hit costs a life');
  spawnDark();
  for (let f = 0; f < 3; f++) c.runFrame(); // second star arrives DURING invulnerability
  eq(c.ram[0x02], 2, 'no damage while invulnerable');
});

test('losing all lives reaches GAME OVER state, START returns to title', () => {
  const c = boot();
  startPlay(c);
  c.ram[0x03] = 20;
  c.ram[0x02] = 1;    // one life left
  c.ram[0x25] = 1; c.ram[0x11] = 40; c.ram[0x16] = 20; c.ram[0x1B] = 4; c.ram[0x20] = 1;
  let over = false;
  for (let f = 0; f < 200 && !over; f++) {
    c.runFrame();
    if (c.ram[0x00] === 2) over = true;
  }
  eq(over, true, 'state = gameover');
  c.runFrames(10);
  eq(c.ram[0x00], 2, 'stays on gameover');
  c.controllers[0] = START;
  c.runFrames(2);
  c.controllers[0] = 0;
  c.runFrames(3);
  eq(c.ram[0x00], 0, 'back to title');
});

test('score digits render into the HUD nametable', () => {
  const c = boot();
  startPlay(c);
  c.ram[0x01] = 37; // score
  c.ram[0x0C] = 1;  // scoreDirty -> NMI rewrites digits
  c.runFrame();
  c.runFrame();
  const nt = c.ppu.vram;
  eq(nt[0x48], 0x33, 'tens digit');
  eq(nt[0x49], 0x37, 'ones digit');
  eq(nt[0x53], 0x33, 'lives digit (3)');
});
