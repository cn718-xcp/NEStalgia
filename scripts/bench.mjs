#!/usr/bin/env node
// Performance benchmark: frames/sec for the integrated console.
// Usage: node scripts/bench.mjs [frames]
import { Console } from '../src/core/console.mjs';
import { makeColorBars, makeSpriteScene } from '../tools/testroms.mjs';
import { buildStarfall } from '../tools/game.mjs';

const FRAMES = Number(process.argv[2] || 600);

function bench(name, rom) {
  // warmup
  const c = new Console(rom);
  for (let i = 0; i < 30; i++) c.runFrame();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < FRAMES; i++) c.runFrame();
  const dt = Number(process.hrtime.bigint() - t0) / 1e9;
  const fps = FRAMES / dt;
  const mhz = (c.cpu.cycles / dt / 1e6).toFixed(1);
  console.log(`${name.padEnd(14)} ${fps.toFixed(1).padStart(8)} fps  (${mhz} MHz 6502-equiv, ${dt.toFixed(2)}s / ${FRAMES} frames)`);
  return fps;
}

console.log(`NEStalgia benchmark — ${FRAMES} frames each, Node ${process.version}\n`);
bench('STARFALL', buildStarfall().rom);
bench('colorbars', makeColorBars().rom);
bench('sprite-scene', makeSpriteScene().rom);
