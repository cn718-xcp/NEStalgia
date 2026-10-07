import { CPU, TABLE } from '../src/core/cpu.mjs';
import { test, eq, ok } from './harness.mjs';

class FlatBus {
  constructor() { this.ram = new Uint8Array(0x10000); }
  cpuRead(a) { return this.ram[a]; }
  cpuWrite(a, v) { this.ram[a] = v; }
}

function make(code, start = 0x0200, { bcd = false } = {}) {
  const bus = new FlatBus();
  const cpu = new CPU(bus, { bcd });
  cpu.PC = start;
  for (let i = 0; i < code.length; i++) bus.ram[start + i] = code[i];
  return { bus, cpu };
}

function runSteps(cpu, n) { for (let i = 0; i < n; i++) cpu.step(); }

// --- loads / stores -------------------------------------------------------
test('LDA immediate sets A and flags', () => {
  const { cpu } = make([0xA9, 0x80]);
  cpu.step();
  eq(cpu.A, 0x80); ok(cpu.N); ok(!cpu.Z);
});

test('LDA zero sets Z', () => {
  const { cpu } = make([0xA9, 0x00]);
  cpu.step();
  ok(cpu.Z); eq(cpu.N, 0);
});

test('STA indexed modes incl zero-page wrap', () => {
  const { bus, cpu } = make([
    0xA2, 0x30,          // LDX #$30
    0xA9, 0x42,          // LDA #$42
    0x85, 0xF0,          // STA $F0
    0x95, 0xD0,          // STA $D0,X -> wraps to $0000
    0x9D, 0x00, 0x03,    // STA $0300,X -> $0330
    0x99, 0x00, 0x04,    // STA $0400,Y
  ]);
  cpu.Y = 0x07;
  runSteps(cpu, 6);
  eq(bus.ram[0xF0], 0x42);
  eq(bus.ram[0x0000], 0x42, 'zp,X wrap');
  eq(bus.ram[0x0330], 0x42);
  eq(bus.ram[0x0407], 0x42, 'abs,Y');
});

test('(zp,X) and (zp),Y pointers wrap inside zero page', () => {
  const { bus, cpu } = make([
    0xA9, 0x77,          // LDA #$77
    0xA2, 0xFE,          // LDX #$FE
    0x81, 0xFF,          // STA ($FF,X) -> ptr at $FD
    0xA0, 0x02,          // LDY #$02
    0xB1, 0xFE,          // LDA ($FE),Y -> ptr $0300 + 2
  ]);
  bus.ram[0xFD] = 0x00; bus.ram[0xFE] = 0x03; bus.ram[0xFF] = 0x00;
  runSteps(cpu, 5);
  eq(bus.ram[0x0300], 0x77, 'stored via (zp,X)');
  eq(cpu.A, bus.ram[0x0302], 'read back via (zp),Y');
});

// --- arithmetic -----------------------------------------------------------
test('ADC carry and overflow', () => {
  const { cpu } = make([0xA9, 0x7F, 0x69, 0x01]);
  runSteps(cpu, 2);
  eq(cpu.A, 0x80); ok(cpu.V); ok(cpu.N); ok(!cpu.C);
  const { cpu: c2 } = make([0x18, 0xA9, 0xFF, 0x69, 0x01]);
  runSteps(c2, 3);
  eq(c2.A, 0x00); ok(c2.C); ok(c2.Z);
});

test('ADC carry propagation across additions', () => {
  const { cpu } = make([0x18, 0xA9, 0xFE, 0x69, 0x01, 0x69, 0x01]);
  runSteps(cpu, 4); // CLC LDA ADC ADC
  eq(cpu.A, 0x00); ok(cpu.C); ok(cpu.Z, 'FE+1+1 = 0x00 with carry out');
});

test('SBC borrow semantics', () => {
  const { cpu } = make([0x38, 0xA9, 0x05, 0xE9, 0x03]);
  runSteps(cpu, 3);
  eq(cpu.A, 0x02); ok(cpu.C, 'no borrow -> C=1');
  const { cpu: c2 } = make([0x18, 0xA9, 0x05, 0xE9, 0x03]);
  runSteps(c2, 3);
  eq(c2.A, 0x01, 'borrow taken'); ok(c2.C, '1 >= 0 still sets carry');
});

test('CMP/CPX/CPY flags', () => {
  const { cpu } = make([0xA9, 0x10, 0xC9, 0x10, 0xE0, 0x0F, 0xC0, 0x20]);
  runSteps(cpu, 2);
  eq(cpu.A, 0x10); ok(cpu.Z); ok(cpu.C, 'equal -> carry set');
  cpu.step(); // CPX #$0F, X=0
  ok(!cpu.C, 'X < operand'); ok(cpu.N);
  cpu.step(); // CPY #$20, Y=0
  ok(!cpu.C);
});

test('BIT sets V/N from operand', () => {
  const { bus, cpu } = make([0x24, 0x40]);
  bus.ram[0x40] = 0xC0;
  cpu.A = 0x00;
  cpu.step();
  ok(cpu.V); ok(cpu.N); ok(cpu.Z, 'A & 0xC0 == 0');
});

// --- shifts / rotates -------------------------------------------------------
test('ASL/LSR/ROL/ROR accumulator', () => {
  const { cpu } = make([0x38, 0xA9, 0x01, 0x2A]); // SEC LDA #1 ROL
  runSteps(cpu, 3);
  eq(cpu.A, 0x03); ok(!cpu.C, 'old bit7 of 0x01 was 0');
  const { cpu: c2 } = make([0xA9, 0x81, 0x4A]); // LDA LSR
  runSteps(c2, 2);
  eq(c2.A, 0x40); ok(c2.C);
});

test('ASL memory via RMW', () => {
  const { bus, cpu } = make([0x06, 0x40]);
  bus.ram[0x40] = 0x40;
  cpu.step();
  eq(bus.ram[0x40], 0x80); ok(cpu.N);
});

// --- branches & jumps ------------------------------------------------------
test('branch taken without page cross costs 1 extra cycle', () => {
  const { cpu } = make([0xA9, 0x01, 0xD0, 0x7E]); // LDA #1; BNE +126
  const c0 = cpu.cycles;
  cpu.step(); cpu.step();
  eq(cpu.cycles - c0, 5, 'LDA=2 + BNE taken=3');
  eq(cpu.PC, 0x0204 + 0x7E, 'target from next-instruction address');
});

test('JMP indirect page-wrap bug', () => {
  const { bus, cpu } = make([0x6C, 0xFF, 0x02], 0x0300); // code at $0300 so wrap target $0200 is free
  bus.ram[0x02FF] = 0x34; bus.ram[0x0200] = 0x12;
  cpu.step();
  eq(cpu.PC, 0x1234, 'hi byte read from $0200, not $0300');
});

// --- stack / subroutines ---------------------------------------------------
test('JSR/RTS roundtrip', () => {
  const { bus, cpu } = make([
    0x20, 0x10, 0x03,   // JSR $0310
    0x4C, 0x00, 0x00,
  ], 0x0200);
  bus.ram[0x0310] = 0x60; // RTS
  cpu.step();
  eq(cpu.PC, 0x0310);
  cpu.step();
  eq(cpu.PC, 0x0203, 'returns to instruction after operand');
  eq(cpu.S, 0xFD, 'stack balanced');
});

test('PHA/PLA/PHP/PLP', () => {
  const { cpu } = make([0x38, 0x08, 0xB8, 0x28]); // SEC PHP CLV PLP
  runSteps(cpu, 4);
  ok(cpu.C, 'PLP restored C=1');
  eq(cpu.V, 0, 'P was pushed with V=0');
});

test('BRK pushes B and jumps to IRQ vector; RTI returns', () => {
  const { bus, cpu } = make([0x00, 0xEA, 0x4C, 0x00, 0x00], 0x0200);
  bus.ram[0xFFFE] = 0x40; bus.ram[0xFFFF] = 0x03;
  bus.ram[0x0340] = 0x40; // RTI
  cpu.step();
  eq(cpu.PC, 0x0340);
  const pushedP = bus.ram[0x100 + ((cpu.S + 1) & 0xFF)];
  ok(pushedP & 0x10, 'B flag pushed for BRK');
  cpu.step(); // RTI
  eq(cpu.PC, 0x0202, 'BRK pushed PC+1');
  ok(cpu.I);
});

// --- interrupts ------------------------------------------------------------
test('NMI injection before next instruction', () => {
  const { bus, cpu } = make([0xE8, 0xE8, 0xE8]); // INX x3
  bus.ram[0xFFFA] = 0x00; bus.ram[0xFFFB] = 0x04;
  bus.ram[0x0400] = 0xE8; // INX
  bus.ram[0x0401] = 0x40; // RTI
  cpu.step(); eq(cpu.X, 1); eq(cpu.PC, 0x0201);
  cpu.nmiPending = true;
  cpu.step(); // the NMI sequence itself
  eq(cpu.PC, 0x0400, 'jumped to NMI vector');
  eq(cpu.X, 1, 'handler not yet executed');
  cpu.step(); // INX in handler
  eq(cpu.X, 2);
  cpu.step(); // RTI
  eq(cpu.PC, 0x0201, 'returned to interrupted instruction');
  cpu.step();
  eq(cpu.X, 3);
});

test('IRQ honored only when I clear', () => {
  const { bus, cpu } = make([0x78, 0x58, 0xE8]); // SEI CLI INX
  bus.ram[0xFFFE] = 0x00; bus.ram[0xFFFF] = 0x04;
  bus.ram[0x0400] = 0xE8; bus.ram[0x0401] = 0x40;
  cpu.irqLine = true;
  cpu.step(); // SEI — no IRQ while I set
  eq(cpu.PC, 0x0201);
  cpu.step(); // CLI — I clears, IRQ taken before NEXT instruction
  eq(cpu.PC, 0x0202);
  cpu.step(); // IRQ sequence -> at handler
  eq(cpu.PC, 0x0400); eq(cpu.X, 0, 'handler not yet executed');
  cpu.step(); // INX in handler
  eq(cpu.X, 1); eq(cpu.PC, 0x0401);
  cpu.step(); // RTI
  eq(cpu.PC, 0x0202);
});

// --- illegal opcodes ---------------------------------------------------------
test('LAX loads A and X', () => {
  const { bus, cpu } = make([0xA7, 0x50]);
  bus.ram[0x50] = 0x99;
  cpu.step();
  eq(cpu.A, 0x99); eq(cpu.X, 0x99);
});
test('SAX stores A & X', () => {
  const { bus, cpu } = make([0x87, 0x50]);
  cpu.A = 0xF0; cpu.X = 0x3C;
  cpu.step();
  eq(bus.ram[0x50], 0x30);
});
test('DCP decrements and compares', () => {
  const { bus, cpu } = make([0xC7, 0x50]);
  bus.ram[0x50] = 0x05; cpu.A = 0x04;
  cpu.step();
  eq(bus.ram[0x50], 0x04); ok(cpu.Z); ok(cpu.C);
});
test('ISB increments then SBC', () => {
  const { bus, cpu } = make([0xE7, 0x50]);
  bus.ram[0x50] = 0x04; cpu.A = 0x0A; cpu.P |= 0x01;
  cpu.step();
  eq(bus.ram[0x50], 0x05); eq(cpu.A, 0x05);
});
test('SLO shifts then ORAs', () => {
  const { bus, cpu } = make([0x07, 0x50]);
  bus.ram[0x50] = 0x21; cpu.A = 0x40; cpu.P &= ~0x01;
  cpu.step();
  eq(bus.ram[0x50], 0x42); eq(cpu.A, 0x42);
});
test('RLA rotates then ANDs', () => {
  const { bus, cpu } = make([0x27, 0x50]);
  bus.ram[0x50] = 0x81; cpu.A = 0xFF; cpu.P &= ~0x01;
  cpu.step();
  eq(bus.ram[0x50], 0x02); eq(cpu.A, 0x02);
});
test('SRE lsr then xors', () => {
  const { bus, cpu } = make([0x47, 0x50]);
  bus.ram[0x50] = 0x03; cpu.A = 0x0E; cpu.P &= ~0x01;
  cpu.step();
  eq(bus.ram[0x50], 0x01); eq(cpu.A, 0x0E ^ 0x01);
});
test('RRA rotates then ADCs', () => {
  const { bus, cpu } = make([0x67, 0x50]);
  bus.ram[0x50] = 0x02; cpu.A = 0x00; cpu.P &= ~0x01;
  cpu.step();
  eq(bus.ram[0x50], 0x01); eq(cpu.A, 0x01);
});
test('SBX / ALR / ANC', () => {
  const { cpu } = make([0xCB, 0x05]);
  cpu.A = 0x0F; cpu.X = 0x0A;
  cpu.step();
  eq(cpu.X, 0x05); ok(cpu.C);
  const { cpu: c2 } = make([0x4B, 0x07]);
  c2.A = 0x0F;
  c2.step();
  eq(c2.A, 0x03); ok(c2.C, 'bit0 of 0x07 shifted out');
  const { cpu: c3 } = make([0x0B, 0x80]);
  c3.A = 0xF0;
  c3.step();
  eq(c3.A, 0x80); ok(c3.C);
});

// --- cycle counts -----------------------------------------------------------
test('exact cycle counts incl page-cross penalty', () => {
  const { cpu } = make([0xBD, 0xFF, 0x02, 0xBD, 0xFF, 0x02]); // LDA $02FF,X twice
  cpu.X = 1;
  const c0 = cpu.cycles;
  cpu.step();
  eq(cpu.cycles - c0, 5, 'LDA abs,X crossed page');
  cpu.X = 0;
  const c1 = cpu.cycles;
  cpu.step();
  eq(cpu.cycles - c1, 4, 'no cross');
  const { cpu: c2 } = make([0x9D, 0x00, 0x02]); // STA $0200,X
  c2.X = 0;
  const s0 = c2.cycles;
  c2.step();
  eq(c2.cycles - s0, 5, 'STA abs,X always 5');
});

// --- BCD (for functional test only; NES has it disabled) --------------------
test('BCD ADC/SBC with bcd=true', () => {
  const { cpu } = make([0xF8, 0xA9, 0x58, 0x69, 0x46], 0x0200, { bcd: true });
  runSteps(cpu, 3);
  eq(cpu.A, 0x04, '58 + 46 = 104'); ok(cpu.C);
  const { cpu: c2 } = make([0x38, 0xF8, 0xA9, 0x50, 0xE9, 0x25], 0x0200, { bcd: true });
  runSteps(c2, 4);
  eq(c2.A, 0x25, '50 - 25 = 25');
});

// --- state serialization ------------------------------------------------------
test('toState/fromState roundtrip', () => {
  const { bus, cpu } = make([0xA9, 0x42, 0xE8, 0xEA]); // LDA INX NOP
  runSteps(cpu, 2);
  const s = JSON.parse(JSON.stringify(cpu.toState()));
  const cpu2 = new CPU(bus); // same bus so code is present
  cpu2.fromState(s);
  eq(cpu2.A, 0x42); eq(cpu2.X, 0x01);
  cpu2.step();
  eq(cpu2.PC, 0x0204, 'executed the resumed NOP');
});

test('opcode table fully populated (256 entries)', () => {
  let missing = 0;
  for (let i = 0; i < 256; i++) if (!TABLE[i]) missing++;
  eq(missing, 0);
});

test('illegal RMW (d),y opcodes take fixed 8 cycles even across a page', () => {
  // regression: izy-mode RMW illegals picked up a spurious +1 read penalty
  for (const [op, name] of [[0x13, 'SLO'], [0x33, 'RLA'], [0x53, 'SRE'], [0x73, 'RRA'], [0xD3, 'DCP'], [0xF3, 'ISB']]) {
    const { bus, cpu } = make([op, 0x40]); // OP ($40),Y
    bus.ram[0x40] = 0xFF; bus.ram[0x41] = 0x10; // pointer $10FF
    cpu.Y = 0x01; // ($10FF)+1 = $1100 → page crossed
    const c0 = cpu.cycles;
    cpu.step();
    eq(cpu.cycles - c0, 8, `${name} (d),y crossing = 8`);
  }
});

test('true read illegals via (d),y keep the page-cross penalty', () => {
  // control group: LAX (d),y is a read — 5 base + 1 penalty
  const { bus, cpu } = make([0xB3, 0x40]);
  bus.ram[0x40] = 0xFF; bus.ram[0x41] = 0x10;
  cpu.Y = 0x01;
  const c0 = cpu.cycles;
  cpu.step();
  eq(cpu.cycles - c0, 6, 'LAX (d),y crossing = 6');
});
