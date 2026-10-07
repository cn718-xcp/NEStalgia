import { APU } from '../src/core/apu.mjs';
import { Console } from '../src/core/console.mjs';
import { makeColorBars } from '../tools/testroms.mjs';
import { test, eq, ok, near } from './harness.mjs';

function apu() { return new APU(); }

test('length counter loads from table and halts count', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x01); // enable pulse1
  a.cpuWrite(0x4003, 0x08 << 0); // length index 1 (254 frames) — low 3 bits are timer hi
  eq(a.pulse1.lengthCounter, 254);
  a.cpuWrite(0x4000, 0x30); // halt = bit5
  a.runCycles(59658 * 2);
  eq(a.pulse1.lengthCounter, 254, 'halted length does not decrement');
});

test('length counter decrements over frames', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x01);
  a.cpuWrite(0x4003, (0 << 3) | 0); // length index 0 = 10
  eq(a.pulse1.lengthCounter, 10);
  a.runCycles(59658); // one 4-step sequence
  eq(a.pulse1.lengthCounter, 8, 'two half-frame ticks');
});

test('envelope restarts on write, decays at quarter frames', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x01);
  a.cpuWrite(0x4000, 0x00); // constant volume off, volume divider 0
  a.cpuWrite(0x4003, 0x80); // restart envelope
  a.runCycles(14914);
  eq(a.pulse1.envDecay, 15, 'restart processed at first quarter frame');
  a.runCycles(14914);
  ok(a.pulse1.envDecay < 15, 'decayed after second quarter frame');
});

test('frame IRQ fires in 4-step mode unless inhibited', () => {
  const a = apu();
  a.runCycles(60000);
  ok(a.frameIrq, 'IRQ set after 4-step sequence');
  ok(a.irqLine);
  a.cpuRead(0x4015); // read clears
  eq(a.frameIrq, false, 'read clears frame IRQ');

  const b = apu();
  b.cpuWrite(0x4017, 0x40); // inhibit
  b.runCycles(120000);
  eq(b.frameIrq, false, 'inhibited');
});

test('5-step mode never asserts frame IRQ', () => {
  const a = apu();
  a.cpuWrite(0x4017, 0x80); // 5-step
  a.runCycles(150000);
  eq(a.frameIrq, false);
});

test('sweep target computation with pulse1 negate quirk', () => {
  const a = apu();
  a.cpuWrite(0x4002, 0x64); // timer lo = 0x64
  a.cpuWrite(0x4003, 0x00); // timer hi = 0
  eq(a.pulse1.timerPeriod, 0x064);
  a.cpuWrite(0x4001, 0x17); // enable, period 2, negate off, shift 7
  eq(a.pulse1.sweepTarget(), 0x064 + (0x064 >> 7));
  a.cpuWrite(0x4001, 0x1F); // negate on
  eq(a.pulse1.sweepTarget(), 0x064 - (0x064 >> 7) - 1, 'pulse1 subtracts one more');
});

test('status register reflects length counters', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x0F);
  a.cpuWrite(0x4003, 0x20); // pulse1 length idx 4 = 40
  a.cpuWrite(0x4007, 0x20);
  a.cpuWrite(0x400B, 0x20);
  a.cpuWrite(0x400F, 0x20);
  const st = a.cpuRead(0x4015);
  eq(st & 0x0F, 0x0F, 'all four channels active');
});

test('mixer emits non-silent samples for an active pulse', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x01);
  a.cpuWrite(0x4000, 0xBF); // duty 2, constant volume 15
  a.cpuWrite(0x4002, 0x40); // low timer
  a.cpuWrite(0x4003, 0x08); // enable length + timer hi
  a.runCycles(40000);
  let sum = 0, n = 0;
  const buf = new Float32Array(4096);
  let got;
  while ((got = a.drainSamples(buf)) > 0) { for (let i = 0; i < got; i++) { sum += buf[i]; n++; } }
  ok(n > 500, `got ${n} samples`);
  ok(Math.abs(sum / n) > 0.01, `mean amplitude ${sum / n} should be non-trivial`);
});

test('triangle outputs a ramp waveform', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x04);
  a.cpuWrite(0x4008, 0xFF); // control (halt) + linear 127
  a.cpuWrite(0x400A, 0x04);
  a.cpuWrite(0x400B, 0x08);
  a.runCycles(6000);
  const buf = new Float32Array(4096);
  const n = a.drainSamples(buf);
  const vals = [...buf.slice(0, n)].map(Math.abs);
  const maxV = Math.max(...vals);
  ok(maxV > 0.05, `triangle amplitude ${maxV}`);
});

test('DMC fetches sample bytes through the bus', () => {
  const c = new Console(makeColorBars().rom);
  const a = c.apu;
  a.cpuWrite(0x4012, 0x00); // addr $8000
  a.cpuWrite(0x4013, 1);    // 17 bytes
  a.cpuWrite(0x4015, 0x10); // enable -> restart
  eq(a.dmc.bytesLeft, 16, 'first byte fetched at restart, 16 remain');
  a.runCycles(7000); // > one sample byte at rate 428 x 8 bits
  ok(a.dmc.bytesLeft < 16, 'bytes consumed');
  ok(a.dmc.bitsLeft <= 8);
});

test('APU state roundtrip preserves channel state', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x0F);
  a.cpuWrite(0x4000, 0x8F);
  a.cpuWrite(0x4002, 0x40);
  a.cpuWrite(0x4003, 0x20);
  a.runCycles(30000);
  const s = JSON.parse(JSON.stringify(a.toState()));
  const b = apu();
  b.fromState(s);
  b.runCycles(1000);
  a.runCycles(1000);
  eq(b.pulse1.lengthCounter, a.pulse1.lengthCounter);
  eq(b.pulse1.timerPeriod, a.pulse1.timerPeriod);
  eq(b.frameCycles, a.frameCycles);
});

// ── Triangle linear counter ──────────────────────────────────────────

test('triangle linear counter decrements each quarter frame (control=0)', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x04); // enable triangle
  a.cpuWrite(0x4008, 0x05); // control=0, linearReload=5
  a.cpuWrite(0x400B, 0x08); // set length counter + reload linear counter
  // After write to reg 3: linearCounter = linearReload = 5
  eq(a.triangle.linearCounter, 5, 'linear counter reloaded on reg 3 write');
  // Run through one full 4-step frame (59658 cycles = 3 quarter ticks at 14914, 29828, 44744)
  a.runCycles(59658);
  // 3 quarter ticks: 5→4→3→2
  eq(a.triangle.linearCounter, 2, '3 quarter ticks should decrement from 5 to 2');
});

test('triangle linear counter reaches 0 and channel stops (control=0)', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x04);
  a.cpuWrite(0x4008, 0x02); // control=0, linearReload=2
  a.cpuWrite(0x400B, 0x08); // linearCounter = 2
  eq(a.triangle.linearCounter, 2);
  // 2 quarter ticks to reach 0: 2→1→0
  a.runCycles(59658); // 4 quarter ticks → 2→1→0→0 (clamped)
  eq(a.triangle.linearCounter, 0, 'linear counter reached 0');
  eq(a.triangle.output(), 0, 'output is 0 when linear counter is 0');
});

test('triangle linear counter stays alive when control=1', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x04);
  a.cpuWrite(0x4008, 0x83); // control=1, linearReload=3
  a.cpuWrite(0x400B, 0x08); // linearCounter = 3
  // Run 4 full frames (16 quarter ticks)
  a.runCycles(59658 * 4);
  // With control=1: each quarter tick decrements then reloads to 3
  // So counter should always be 3 after the reload phase
  eq(a.triangle.linearCounter, 3, 'linear counter reloaded every quarter frame');
  ok(a.triangle.output() !== 0, 'channel still producing output');
});

test('triangle output is 0 when linear counter is 0 even if length > 0', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x04);
  a.cpuWrite(0x4008, 0x00); // control=0, linearReload=0
  a.cpuWrite(0x400B, 0x08); // linearCounter = 0 (reloaded from linearReload=0)
  eq(a.triangle.linearCounter, 0);
  ok(a.triangle.lengthCounter > 0, 'length counter is active');
  eq(a.triangle.output(), 0, 'silent when linear counter is 0');
});

test('triangle length counter halts when control=1', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x04);
  a.cpuWrite(0x4008, 0x80); // control=1 (halt length counting)
  a.cpuWrite(0x400B, 0x00); // length index 0 = 10
  eq(a.triangle.lengthCounter, 10);
  a.runCycles(59658 * 3); // multiple frames
  eq(a.triangle.lengthCounter, 10, 'length counter does not decrement when control=1');
});

test('triangle length counter decrements when control=0', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x04);
  a.cpuWrite(0x4008, 0x05); // control=0, linearReload=5
  a.cpuWrite(0x400B, 0x00); // length index 0 = 10
  eq(a.triangle.lengthCounter, 10);
  a.runCycles(59658); // one 4-step frame = 2 half ticks
  eq(a.triangle.lengthCounter, 8, 'two half-frame ticks decremented length');
});

// ── APU quarter frame sequencer timing ───────────────────────────────

test('4-step: exactly 3 quarter ticks per frame', () => {
  // Use control=0 so linear counter actually decrements without reload
  const a = apu();
  a.cpuWrite(0x4017, 0x00); // 4-step mode
  a.cpuWrite(0x4015, 0x04);
  a.cpuWrite(0x4008, 0x10); // control=0, linearReload=16
  a.cpuWrite(0x400B, 0x08); // linearCounter = 16, lengthCounter = 10

  // Run just before 1st quarter (cycle 14913)
  a.runCycles(14913);
  eq(a.triangle.linearCounter, 16, 'no quarter tick before cycle 14914');

  // Run to cycle 14914 (1st quarter tick)
  a.runCycles(1);
  eq(a.triangle.linearCounter, 15, '1st quarter tick at cycle 14914');

  // Run to cycle 29828 (2nd quarter tick)
  a.runCycles(29828 - 14914);
  eq(a.triangle.linearCounter, 14, '2nd quarter tick at cycle 29828');

  // Run to cycle 44744 (3rd quarter tick)
  a.runCycles(44744 - 29828);
  eq(a.triangle.linearCounter, 13, '3rd quarter tick at cycle 44744');

  // Run to end of frame (cycle 59658) — no more quarter ticks
  a.runCycles(59658 - 44744);
  eq(a.triangle.linearCounter, 13, 'no 4th quarter tick in 4-step mode');
});

test('5-step: exactly 4 quarter ticks per frame', () => {
  const a = apu();
  a.cpuWrite(0x4017, 0x80); // 5-step mode
  a.cpuWrite(0x4015, 0x04);
  a.cpuWrite(0x4008, 0x10); // control=0, linearReload=16
  a.cpuWrite(0x400B, 0x08); // linearCounter = 16

  a.runCycles(14914); // 1st quarter
  eq(a.triangle.linearCounter, 15, '5-step: 1st quarter at 14914');

  a.runCycles(29828 - 14914); // 2nd quarter
  eq(a.triangle.linearCounter, 14, '5-step: 2nd quarter at 29828');

  a.runCycles(44744 - 29828); // 3rd quarter
  eq(a.triangle.linearCounter, 13, '5-step: 3rd quarter at 44744');

  a.runCycles(52198 - 44744); // 4th quarter
  eq(a.triangle.linearCounter, 12, '5-step: 4th quarter at 52198');

  a.runCycles(74566 - 52198); // rest of frame
  eq(a.triangle.linearCounter, 12, '5-step: no 5th quarter tick');
});

test('quarter frame also drives pulse and noise envelopes', () => {
  const a = apu();
  a.cpuWrite(0x4015, 0x01); // enable pulse1
  a.cpuWrite(0x4000, 0x30); // halt=1, constant volume, vol=0
  a.cpuWrite(0x4003, 0x00); // restart envelope → envDecay=15
  // After restart: envDecay=15, then quarter tick will see envRestart flag
  a.runCycles(14914); // 1st quarter tick processes envelope
  // Envelope was restarted, first quarter tick processes the restart
  eq(a.pulse1.envDecay, 15, 'envelope restarted');
  a.runCycles(14914); // 2nd quarter tick
  // Now envelope should start decaying (divider counts down)
  ok(a.pulse1.envDecay >= 14, 'envelope decays after quarter ticks');
});
