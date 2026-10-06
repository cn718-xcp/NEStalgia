#!/usr/bin/env node
// Builds the shipped .nes ROMs and captures real-emulator screenshots
// for the documentation.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Console } from '../src/core/console.mjs';
import { encodePNG } from '../scripts/png.mjs';
import { makeColorBars, makeSpriteScene } from './testroms.mjs';
import { buildStarfall } from './game.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const romsDir = join(root, 'roms');
const shotsDir = join(root, 'docs', 'screenshots');
mkdirSync(romsDir, { recursive: true });
mkdirSync(shotsDir, { recursive: true });

function shot(console_, name) {
  const png = encodePNG(256, 240, console_.ppu.framebuffer);
  writeFileSync(join(shotsDir, name), png);
  console.log('wrote docs/screenshots/' + name);
}

// STARFALL
const game = buildStarfall();
writeFileSync(join(romsDir, 'starfall.nes'), game.rom);
console.log('wrote roms/starfall.nes (' + game.rom.length + ' bytes)');

const g = new Console(game.rom);
g.runFrames(35);
shot(g, 'starfall-title.png');
g.controllers[0] = 0x08; // Start
g.runFrames(2);
g.controllers[0] = 0;
g.runFrames(30);
shot(g, 'starfall-play.png');
// damage run to game over
g.ram[0x03] = 20;
g.ram[0x02] = 1;
g.ram[0x25] = 1; g.ram[0x11] = 40; g.ram[0x16] = 20; g.ram[0x1B] = 4; g.ram[0x20] = 1;
for (let f = 0; f < 60 && g.ram[0x00] !== 2; f++) g.runFrame();
g.runFrames(5);
shot(g, 'starfall-gameover.png');

// test scenes
const bars = new Console(makeColorBars().rom);
bars.runFrames(8);
shot(bars, 'test-colorbars.png');

const sprites = new Console(makeSpriteScene().rom);
sprites.runFrames(8);
shot(sprites, 'test-sprites.png');

console.log('done.');
