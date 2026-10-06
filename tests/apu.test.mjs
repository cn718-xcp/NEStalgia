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
