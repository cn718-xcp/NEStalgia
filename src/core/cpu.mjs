// NEStalgia — MOS 6502 (2A03) CPU core, written from scratch.
// Full official instruction set + the stable illegal opcodes, page-cross
// cycle penalties, the JMP ($)xxFF page-wrap bug, NMI/IRQ injection and
// (optionally) BCD arithmetic so the core can pass the Klaus Dormann
// functional test on a flat 64K bus. The NES has BCD disabled; the console
// constructs the CPU with bcd=false.

export class CPU {
  constructor(bus, { bcd = false } = {}) {
    this.bus = bus;
    this.bcd = bcd;
    this.A = 0; this.X = 0; this.Y = 0;
    this.S = 0xFD;
    this.P = 0x24; // I set, bit5 set
    this.PC = 0;
    this.cycles = 0;
    this.nmiPending = false;
    this.irqLine = false;
    this.jammed = false;
  }

  reset() {
    this.S = (this.S - 3) & 0xFF;
    this.P |= 0x04; // I
    this.PC = this.read16(0xFFFC);
    this.cycles += 8;
    this.jammed = false;
  }

  read(a) { return this.bus.cpuRead(a & 0xFFFF) & 0xFF; }
  write(a, v) { this.bus.cpuWrite(a & 0xFFFF, v & 0xFF); }
  read16(a) { return this.read(a) | (this.read(a + 1) << 8); }

  // -- flags ----------------------------------------------------------------
  get C() { return this.P & 0x01; }
  get Z() { return this.P & 0x02; }
  get I() { return this.P & 0x04; }
  get D() { return this.P & 0x08; }
  get V() { return this.P & 0x40; }
  get N() { return this.P & 0x80; }
  setC(v) { v ? this.P |= 0x01 : this.P &= ~0x01; }
  setZ(v) { v ? this.P |= 0x02 : this.P &= ~0x02; }
  setI(v) { v ? this.P |= 0x04 : this.P &= ~0x04; }
  setD(v) { v ? this.P |= 0x08 : this.P &= ~0x08; }
  setV(v) { v ? this.P |= 0x40 : this.P &= ~0x40; }
  setN(v) { v ? this.P |= 0x80 : this.P &= ~0x80; }
  setZN(v) { v === 0 ? this.P |= 0x02 : this.P &= ~0x02; v & 0x80 ? this.P |= 0x80 : this.P &= ~0x80; }

  push(v) { this.write(0x100 + this.S, v); this.S = (this.S - 1) & 0xFF; }
  pop() { this.S = (this.S + 1) & 0xFF; return this.read(0x100 + this.S); }
  push16(v) { this.push((v >> 8) & 0xFF); this.push(v & 0xFF); }
  pop16() { const lo = this.pop(); return lo | (this.pop() << 8); }

  // -- addressing ------------------------------------------------------------
  // Each returns the effective address; sets this._cross if a page boundary
  // was crossed (adds +1 cycle for read instructions).
  _imm()   { return this.PC++; }
  _zp()    { return this.read(this.PC++); }
  _zpx()   { return (this.read(this.PC++) + this.X) & 0xFF; }
  _zpy()   { return (this.read(this.PC++) + this.Y) & 0xFF; }
  _abs()   { const a = this.read16(this.PC); this.PC += 2; return a; }
  _absx(rd) { const b = this.read16(this.PC); this.PC += 2; const a = (b + this.X) & 0xFFFF; this._cross = ((b & 0xFF00) !== (a & 0xFF00)); return a; }
  _absy(rd) { const b = this.read16(this.PC); this.PC += 2; const a = (b + this.Y) & 0xFFFF; this._cross = ((b & 0xFF00) !== (a & 0xFF00)); return a; }
  _ind()   { const b = this.read16(this.PC); this.PC += 2; // 6502 page-wrap bug
             const lo = this.read(b); const hi = this.read((b & 0xFF00) | ((b + 1) & 0xFF)); return lo | (hi << 8); }
  _izx()   { const z = (this.read(this.PC++) + this.X) & 0xFF;
             return this.read(z) | (this.read((z + 1) & 0xFF) << 8); }
  _izy(rd) { const z = this.read(this.PC++);
             const b = this.read(z) | (this.read((z + 1) & 0xFF) << 8);
             const a = (b + this.Y) & 0xFFFF; this._cross = ((b & 0xFF00) !== (a & 0xFF00)); return a; }

  // -- operations ------------------------------------------------------------
  _adc(m) {
    if (this.D && this.bcd) {
      const c = this.C ? 1 : 0;
      let lo = (this.A & 0x0F) + (m & 0x0F) + c;
      if (lo > 9) lo += 6;
      let hi = (this.A >> 4) + (m >> 4) + (lo > 0x0F ? 1 : 0);
      const bin = this.A + m + c;
      this.setZ((bin & 0xFF) === 0);
      this.setN((hi & 0x08) !== 0);
      this.setV((~(this.A ^ m) & (this.A ^ ((hi << 4) & 0xFF)) & 0x80) !== 0);
      if (hi > 9) hi += 6;
      this.setC(hi > 0x0F);
      this.A = ((hi << 4) | (lo & 0x0F)) & 0xFF;
      return;
    }
    const c = this.C ? 1 : 0;
    const r = this.A + m + c;
    this.setC(r > 0xFF);
    this.setV((~(this.A ^ m) & (this.A ^ r) & 0x80) !== 0);
    this.A = r & 0xFF;
    this.setZN(this.A);
  }

  _sbc(m) {
    if (this.D && this.bcd) {
      const c = this.C ? 0 : 1;
      let lo = (this.A & 0x0F) - (m & 0x0F) - c;
      let hi = (this.A >> 4) - (m >> 4);
      if (lo < 0) { lo -= 6; hi--; }
      if (hi < 0) hi -= 6;
      const bin = this.A - m - c;
      this.setC(bin >= 0);
      this.setV(((this.A ^ m) & (this.A ^ bin) & 0x80) !== 0);
      this.A = ((hi << 4) | (lo & 0x0F)) & 0xFF;
      this.setZN(this.A);
      return;
    }
    const r = this.A - m - (this.C ? 0 : 1);
    this.setC(r >= 0);
    this.setV(((this.A ^ m) & (this.A ^ r) & 0x80) !== 0);
    this.A = r & 0xFF;
    this.setZN(this.A);
  }

  _cmp(r, m) { const d = (r - m) & 0x1FF; this.setC(r >= m); this.setZN(d & 0xFF); }

  _asl(v) { this.setC((v & 0x80) !== 0); v = (v << 1) & 0xFF; this.setZN(v); return v; }
  _lsr(v) { this.setC((v & 0x01) !== 0); v = v >> 1; this.setZN(v); return v; }
  _rol(v) { const c = this.C ? 1 : 0; this.setC((v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.setZN(v); return v; }
  _ror(v) { const c = this.C ? 0x80 : 0; this.setC((v & 0x01) !== 0); v = (v >> 1) | c; this.setZN(v); return v; }

  _branch(cond) {
    const off = this.read(this.PC++);
    if (cond) {
      this.cycles++; // taken
      const rel = off < 0x80 ? off : off - 0x100;
      const t = (this.PC + rel) & 0xFFFF;
      if ((t & 0xFF00) !== (this.PC & 0xFF00)) this.cycles++;
      this.PC = t;
    }
  }

  _rmw(addr, fn) { const v = this.read(addr); this.write(addr, v); const r = fn(v); this.write(addr, r); return r; }

  interrupt(vector, isBrk) {
    this.push16(this.PC);
    this.push((this.P & ~0x10) | 0x20 | (isBrk ? 0x10 : 0));
    this.setI(true);
    this.PC = this.read16(vector);
    this.cycles += 7;
  }

  // Execute one instruction; returns cycles consumed.
  step() {
    const c0 = this.cycles;
    this._cross = false;
    if (this.jammed) { this.cycles += 2; return 2; }
    if (this.nmiPending) { this.nmiPending = false; this.interrupt(0xFFFA, false); return 7; }
    if (this.irqLine && !this.I) { this.interrupt(0xFFFE, false); return 7; }

    const start = this.PC;
    const op = this.read(this.PC++);
    const info = TABLE[op];
    if (!info) { this.jammed = true; this.cycles += 2; return 2; }
    const [name, mode, base, alwaysCross] = info;

    switch (mode) {
      case 'imp': case 'acc': break;
      case 'imm': this._ea = this._imm(); break;
      case 'zp':  this._ea = this._zp(); break;
      case 'zpx': this._ea = this._zpx(); break;
      case 'zpy': this._ea = this._zpy(); break;
      case 'abs': this._ea = this._abs(); break;
      case 'absx': this._ea = this._absx(); break;
      case 'absy': this._ea = this._absy(); break;
      case 'ind': this._ea = this._ind(); break;
      case 'izx': this._ea = this._izx(); break;
      case 'izy': this._ea = this._izy(); break;
      case 'rel': this._ea = 0; break;
    }
    this.cycles += base;

    switch (name) {
      case 'ORA': this.A |= this.read(this._ea); this.setZN(this.A); break;
      case 'AND': this.A &= this.read(this._ea); this.setZN(this.A); break;
      case 'EOR': this.A ^= this.read(this._ea); this.setZN(this.A); break;
      case 'ADC': this._adc(this.read(this._ea)); break;
      case 'SBC': this._sbc(this.read(this._ea)); break;
      case 'CMP': this._cmp(this.A, this.read(this._ea)); break;
      case 'CPX': this._cmp(this.X, this.read(this._ea)); break;
      case 'CPY': this._cmp(this.Y, this.read(this._ea)); break;
      case 'LDA': this.A = this.read(this._ea); this.setZN(this.A); break;
      case 'LDX': this.X = this.read(this._ea); this.setZN(this.X); break;
      case 'LDY': this.Y = this.read(this._ea); this.setZN(this.Y); break;
      case 'LAX': this.A = this.X = this.read(this._ea); this.setZN(this.A); break;
      case 'STA': this.write(this._ea, this.A); break;
      case 'STX': this.write(this._ea, this.X); break;
      case 'STY': this.write(this._ea, this.Y); break;
      case 'SAX': this.write(this._ea, this.A & this.X); break;
      case 'INC': this.setZN(this._rmw(this._ea, v => (v + 1) & 0xFF)); break;
      case 'DEC': this.setZN(this._rmw(this._ea, v => (v - 1) & 0xFF)); break;
      case 'DCP': { const v = (this.read(this._ea) - 1) & 0xFF; this.write(this._ea, v); this._cmp(this.A, v); break; }
      case 'ISB': { const v = (this.read(this._ea) + 1) & 0xFF; this.write(this._ea, v); this._sbc(v); break; }
      case 'SLO': { const v = this._asl(this.read(this._ea)); this.write(this._ea, v); this.A |= v; this.setZN(this.A); break; }
      case 'RLA': { const v = this._rol(this.read(this._ea)); this.write(this._ea, v); this.A &= v; this.setZN(this.A); break; }
      case 'SRE': { const v = this._lsr(this.read(this._ea)); this.write(this._ea, v); this.A ^= v; this.setZN(this.A); break; }
      case 'RRA': { const v = this._ror(this.read(this._ea)); this.write(this._ea, v); this._adc(v); break; }
      case 'ASL': {
        if (mode === 'acc') this.A = this._asl(this.A);
        else this._rmw(this._ea, v => this._asl(v));
        break;
      }
      case 'LSR': {
        if (mode === 'acc') this.A = this._lsr(this.A);
        else this._rmw(this._ea, v => this._lsr(v));
        break;
      }
      case 'ROL': {
        if (mode === 'acc') this.A = this._rol(this.A);
        else this._rmw(this._ea, v => this._rol(v));
        break;
      }
      case 'ROR': {
        if (mode === 'acc') this.A = this._ror(this.A);
        else this._rmw(this._ea, v => this._ror(v));
        break;
      }
      case 'BIT': { const v = this.read(this._ea); this.setZ((this.A & v) === 0); this.setN(v & 0x80); this.setV(v & 0x40); break; }
      case 'JMP': this.PC = this._ea; break;
      case 'JSR': { this.push16(this.PC - 1); this.PC = this._ea; break; }
      case 'RTS': this.PC = (this.pop16() + 1) & 0xFFFF; break;
      case 'RTI': { this.P = (this.pop() | 0x20) & ~0x10; this.PC = this.pop16(); break; }
      case 'BRK': this.PC = (this.PC + 1) & 0xFFFF; this.interrupt(0xFFFE, true); break;
      case 'PHA': this.push(this.A); break;
      case 'PLA': this.A = this.pop(); this.setZN(this.A); break;
      case 'PHP': this.push(this.P | 0x10 | 0x20); break;
      case 'PLP': this.P = (this.pop() | 0x20) & ~0x10; break;
      case 'BPL': this._branch(!(this.P & 0x80)); break;
      case 'BMI': this._branch(!!(this.P & 0x80)); break;
      case 'BVC': this._branch(!(this.P & 0x40)); break;
      case 'BVS': this._branch(!!(this.P & 0x40)); break;
      case 'BCC': this._branch(!(this.P & 0x01)); break;
      case 'BCS': this._branch(!!(this.P & 0x01)); break;
      case 'BNE': this._branch(!(this.P & 0x02)); break;
      case 'BEQ': this._branch(!!(this.P & 0x02)); break;
      case 'CLC': this.setC(false); break;
      case 'SEC': this.setC(true); break;
      case 'CLI': this.setI(false); break;
      case 'SEI': this.setI(true); break;
      case 'CLD': this.setD(false); break;
      case 'SED': this.setD(true); break;
      case 'CLV': this.setV(false); break;
      case 'TAX': this.X = this.A; this.setZN(this.X); break;
      case 'TAY': this.Y = this.A; this.setZN(this.Y); break;
      case 'TXA': this.A = this.X; this.setZN(this.A); break;
      case 'TYA': this.A = this.Y; this.setZN(this.A); break;
      case 'TSX': this.X = this.S; this.setZN(this.X); break;
      case 'TXS': this.S = this.X; break;
      case 'INX': this.X = (this.X + 1) & 0xFF; this.setZN(this.X); break;
      case 'INY': this.Y = (this.Y + 1) & 0xFF; this.setZN(this.Y); break;
      case 'DEX': this.X = (this.X - 1) & 0xFF; this.setZN(this.X); break;
      case 'DEY': this.Y = (this.Y - 1) & 0xFF; this.setZN(this.Y); break;
      case 'ANC': this.A &= this.read(this._ea); this.setZN(this.A); this.setC(this.A & 0x80); break;
      case 'ALR': this.A &= this.read(this._ea); this.A = this._lsr(this.A); break;
      case 'ARR': {
        this.A &= this.read(this._ea);
        this.A = ((this.A >> 1) | (this.C ? 0x80 : 0)) & 0xFF;
        this.setZN(this.A);
        this.setC((this.A & 0x40) !== 0);
        this.setV(((this.A >> 6) ^ (this.A >> 5)) & 0x01);
        break;
      }
      case 'SBX': { const r = (this.A & this.X) - this.read(this._ea); this.setC(r >= 0); this.X = r & 0xFF; this.setZN(this.X); break; }
      case 'XAA': this.A = this.X & this.read(this._ea); this.setZN(this.A); break;
      case 'TAS': { this.S = this.A & this.X; const v = this.S & (((this._ea & 0xFF00) >> 8) + 1) & 0xFF; this.write(this._ea, v); break; }
      case 'SHA': { const v = (this.A & this.X) & (((this._ea & 0xFF00) >> 8) + 1) & 0xFF; this.write(this._ea, v); break; }
      case 'SHX': { const v = this.X & (((this._ea & 0xFF00) >> 8) + 1) & 0xFF; this.write(this._ea, v); break; }
      case 'SHY': { const v = this.Y & (((this._ea & 0xFF00) >> 8) + 1) & 0xFF; this.write(this._ea, v); break; }
      case 'LAS': { const v = this.read(this._ea) & this.S; this.A = this.X = this.S = v; this.setZN(v); break; }
      case 'JAM': this.jammed = true; this.PC = (this.PC - 1) & 0xFFFF; break;
      case 'NOP': break;
      default: this.jammed = true;
    }

    // page-cross penalty for read instructions (precomputed per opcode)
    if (this._cross && info[4]) this.cycles++;
    this.lastPC = start;
    return this.cycles - c0;
  }

  toState() {
    return {
      A: this.A, X: this.X, Y: this.Y, S: this.S, P: this.P, PC: this.PC,
      cycles: this.cycles, nmiPending: this.nmiPending, irqLine: this.irqLine,
      jammed: this.jammed,
    };
  }
  fromState(s) {
    this.A = s.A; this.X = s.X; this.Y = s.Y; this.S = s.S; this.P = s.P; this.PC = s.PC;
    this.cycles = s.cycles; this.nmiPending = s.nmiPending; this.irqLine = s.irqLine;
    this.jammed = s.jammed;
  }
}

const READ_MODES = new Set(['absx', 'absy', 'izy']);

// opcode -> [mnemonic, mode, baseCycles, alwaysPenalty]
export const TABLE = new Array(256).fill(null);
function def(op, name, mode, base, always = false) { TABLE[op] = [name, mode, base, always]; }

// Official opcodes
def(0x00, 'BRK', 'imp', 0); // interrupt() adds the 7 cycles
def(0x01, 'ORA', 'izx', 6);
def(0x05, 'ORA', 'zp', 3);
def(0x06, 'ASL', 'zp', 5);
def(0x08, 'PHP', 'imp', 3);
def(0x09, 'ORA', 'imm', 2);
def(0x0A, 'ASL', 'acc', 2);
def(0x0D, 'ORA', 'abs', 4);
def(0x0E, 'ASL', 'abs', 6);
def(0x10, 'BPL', 'rel', 2);
def(0x11, 'ORA', 'izy', 5);
def(0x15, 'ORA', 'zpx', 4);
def(0x16, 'ASL', 'zpx', 6);
def(0x18, 'CLC', 'imp', 2);
def(0x19, 'ORA', 'absy', 4);
def(0x1D, 'ORA', 'absx', 4);
def(0x1E, 'ASL', 'absx', 7, true);
def(0x20, 'JSR', 'abs', 6);
def(0x21, 'AND', 'izx', 6);
def(0x24, 'BIT', 'zp', 3);
def(0x25, 'AND', 'zp', 3);
def(0x26, 'ROL', 'zp', 5);
def(0x28, 'PLP', 'imp', 4);
def(0x29, 'AND', 'imm', 2);
def(0x2A, 'ROL', 'acc', 2);
def(0x2C, 'BIT', 'abs', 4);
def(0x2D, 'AND', 'abs', 4);
def(0x2E, 'ROL', 'abs', 6);
def(0x30, 'BMI', 'rel', 2);
def(0x31, 'AND', 'izy', 5);
def(0x35, 'AND', 'zpx', 4);
def(0x36, 'ROL', 'zpx', 6);
def(0x38, 'SEC', 'imp', 2);
def(0x39, 'AND', 'absy', 4);
def(0x3D, 'AND', 'absx', 4);
def(0x3E, 'ROL', 'absx', 7, true);
def(0x40, 'RTI', 'imp', 6);
def(0x41, 'EOR', 'izx', 6);
def(0x45, 'EOR', 'zp', 3);
def(0x46, 'LSR', 'zp', 5);
def(0x48, 'PHA', 'imp', 3);
def(0x49, 'EOR', 'imm', 2);
def(0x4A, 'LSR', 'acc', 2);
def(0x4C, 'JMP', 'abs', 3);
def(0x4D, 'EOR', 'abs', 4);
def(0x4E, 'LSR', 'abs', 6);
def(0x50, 'BVC', 'rel', 2);
def(0x51, 'EOR', 'izy', 5);
def(0x55, 'EOR', 'zpx', 4);
def(0x56, 'LSR', 'zpx', 6);
def(0x58, 'CLI', 'imp', 2);
def(0x59, 'EOR', 'absy', 4);
def(0x5D, 'EOR', 'absx', 4);
def(0x5E, 'LSR', 'absx', 7, true);
def(0x60, 'RTS', 'imp', 6);
def(0x61, 'ADC', 'izx', 6);
def(0x65, 'ADC', 'zp', 3);
def(0x66, 'ROR', 'zp', 5);
def(0x68, 'PLA', 'imp', 4);
def(0x69, 'ADC', 'imm', 2);
def(0x6A, 'ROR', 'acc', 2);
def(0x6C, 'JMP', 'ind', 5);
def(0x6D, 'ADC', 'abs', 4);
def(0x6E, 'ROR', 'abs', 6);
def(0x70, 'BVS', 'rel', 2);
def(0x71, 'ADC', 'izy', 5);
def(0x75, 'ADC', 'zpx', 4);
def(0x76, 'ROR', 'zpx', 6);
def(0x78, 'SEI', 'imp', 2);
def(0x79, 'ADC', 'absy', 4);
def(0x7D, 'ADC', 'absx', 4);
def(0x7E, 'ROR', 'absx', 7, true);
def(0x81, 'STA', 'izx', 6);
def(0x84, 'STY', 'zp', 3);
def(0x85, 'STA', 'zp', 3);
def(0x86, 'STX', 'zp', 3);
def(0x88, 'DEY', 'imp', 2);
def(0x8A, 'TXA', 'imp', 2);
def(0x8C, 'STY', 'abs', 4);
def(0x8D, 'STA', 'abs', 4);
def(0x8E, 'STX', 'abs', 4);
def(0x90, 'BCC', 'rel', 2);
def(0x91, 'STA', 'izy', 6, true);
def(0x94, 'STY', 'zpx', 4);
def(0x95, 'STA', 'zpx', 4);
def(0x96, 'STX', 'zpy', 4);
def(0x98, 'TYA', 'imp', 2);
def(0x99, 'STA', 'absy', 5, true);
def(0x9A, 'TXS', 'imp', 2);
def(0x9D, 'STA', 'absx', 5, true);
def(0xA0, 'LDY', 'imm', 2);
def(0xA1, 'LDA', 'izx', 6);
def(0xA2, 'LDX', 'imm', 2);
def(0xA4, 'LDY', 'zp', 3);
def(0xA5, 'LDA', 'zp', 3);
def(0xA6, 'LDX', 'zp', 3);
def(0xA8, 'TAY', 'imp', 2);
def(0xA9, 'LDA', 'imm', 2);
def(0xAA, 'TAX', 'imp', 2);
def(0xAC, 'LDY', 'abs', 4);
def(0xAD, 'LDA', 'abs', 4);
def(0xAE, 'LDX', 'abs', 4);
def(0xB0, 'BCS', 'rel', 2);
def(0xB1, 'LDA', 'izy', 5);
def(0xB4, 'LDY', 'zpx', 4);
def(0xB5, 'LDA', 'zpx', 4);
def(0xB6, 'LDX', 'zpy', 4);
def(0xB8, 'CLV', 'imp', 2);
def(0xB9, 'LDA', 'absy', 4);
def(0xBA, 'TSX', 'imp', 2);
def(0xBC, 'LDY', 'absx', 4);
def(0xBD, 'LDA', 'absx', 4);
def(0xBE, 'LDX', 'absy', 4);
def(0xC0, 'CPY', 'imm', 2);
def(0xC1, 'CMP', 'izx', 6);
def(0xC4, 'CPY', 'zp', 3);
def(0xC5, 'CMP', 'zp', 3);
def(0xC6, 'DEC', 'zp', 5);
def(0xC8, 'INY', 'imp', 2);
def(0xC9, 'CMP', 'imm', 2);
def(0xCA, 'DEX', 'imp', 2);
def(0xCC, 'CPY', 'abs', 4);
def(0xCD, 'CMP', 'abs', 4);
def(0xCE, 'DEC', 'abs', 6);
def(0xD0, 'BNE', 'rel', 2);
def(0xD1, 'CMP', 'izy', 5);
def(0xD5, 'CMP', 'zpx', 4);
def(0xD6, 'DEC', 'zpx', 6);
def(0xD8, 'CLD', 'imp', 2);
def(0xD9, 'CMP', 'absy', 4);
def(0xDD, 'CMP', 'absx', 4);
def(0xDE, 'DEC', 'absx', 7, true);
def(0xE0, 'CPX', 'imm', 2);
def(0xE1, 'SBC', 'izx', 6);
def(0xE4, 'CPX', 'zp', 3);
def(0xE5, 'SBC', 'zp', 3);
def(0xE6, 'INC', 'zp', 5);
def(0xE8, 'INX', 'imp', 2);
def(0xE9, 'SBC', 'imm', 2);
def(0xEA, 'NOP', 'imp', 2);
def(0xEC, 'CPX', 'abs', 4);
def(0xED, 'SBC', 'abs', 4);
def(0xEE, 'INC', 'abs', 6);
def(0xF0, 'BEQ', 'rel', 2);
def(0xF1, 'SBC', 'izy', 5);
def(0xF5, 'SBC', 'zpx', 4);
def(0xF6, 'INC', 'zpx', 6);
def(0xF8, 'SED', 'imp', 2);
def(0xF9, 'SBC', 'absy', 4);
def(0xFD, 'SBC', 'absx', 4);
def(0xFE, 'INC', 'absx', 7, true);

// Stable illegal opcodes
const RMW_ILLEGAL = [
  ['SLO', 0x03, 'izx', 8], ['SLO', 0x07, 'zp', 5], ['SLO', 0x0F, 'abs', 6], ['SLO', 0x13, 'izy', 8],
  ['SLO', 0x17, 'zpx', 6], ['SLO', 0x1B, 'absy', 7, true], ['SLO', 0x1F, 'absx', 7, true],
  ['RLA', 0x23, 'izx', 8], ['RLA', 0x27, 'zp', 5], ['RLA', 0x2F, 'abs', 6], ['RLA', 0x33, 'izy', 8],
  ['RLA', 0x37, 'zpx', 6], ['RLA', 0x3B, 'absy', 7, true], ['RLA', 0x3F, 'absx', 7, true],
  ['SRE', 0x43, 'izx', 8], ['SRE', 0x47, 'zp', 5], ['SRE', 0x4F, 'abs', 6], ['SRE', 0x53, 'izy', 8],
  ['SRE', 0x57, 'zpx', 6], ['SRE', 0x5B, 'absy', 7, true], ['SRE', 0x5F, 'absx', 7, true],
  ['RRA', 0x63, 'izx', 8], ['RRA', 0x67, 'zp', 5], ['RRA', 0x6F, 'abs', 6], ['RRA', 0x73, 'izy', 8],
  ['RRA', 0x77, 'zpx', 6], ['RRA', 0x7B, 'absy', 7, true], ['RRA', 0x7F, 'absx', 7, true],
  ['DCP', 0xC3, 'izx', 8], ['DCP', 0xC7, 'zp', 5], ['DCP', 0xCF, 'abs', 6], ['DCP', 0xD3, 'izy', 8],
  ['DCP', 0xD7, 'zpx', 6], ['DCP', 0xDB, 'absy', 7, true], ['DCP', 0xDF, 'absx', 7, true],
  ['ISB', 0xE3, 'izx', 8], ['ISB', 0xE7, 'zp', 5], ['ISB', 0xEF, 'abs', 6], ['ISB', 0xF3, 'izy', 8],
  ['ISB', 0xF7, 'zpx', 6], ['ISB', 0xFB, 'absy', 7, true], ['ISB', 0xFF, 'absx', 7, true],
];
for (const [n, op, m, c, a] of RMW_ILLEGAL) def(op, n, m, c, !!a);
def(0x83, 'SAX', 'izx', 6); def(0x87, 'SAX', 'zp', 3); def(0x8F, 'SAX', 'abs', 4); def(0x97, 'SAX', 'zpy', 4);
def(0xA3, 'LAX', 'izx', 6); def(0xA7, 'LAX', 'zp', 3); def(0xAB, 'LAX', 'imm', 2);
def(0xAF, 'LAX', 'abs', 4); def(0xB3, 'LAX', 'izy', 5); def(0xB7, 'LAX', 'zpy', 4); def(0xBF, 'LAX', 'absy', 4);
def(0xEB, 'SBC', 'imm', 2);
def(0x0B, 'ANC', 'imm', 2); def(0x2B, 'ANC', 'imm', 2);
def(0x4B, 'ALR', 'imm', 2); def(0x6B, 'ARR', 'imm', 2); def(0xCB, 'SBX', 'imm', 2);
for (const op of [0x1A, 0x3A, 0x5A, 0x7A, 0xDA, 0xFA]) def(op, 'NOP', 'imp', 2);
for (const op of [0x80, 0x82, 0x89, 0xC2, 0xE2]) def(op, 'NOP', 'imm', 2);
for (const op of [0x04, 0x44, 0x64]) def(op, 'NOP', 'zp', 3);
def(0x0C, 'NOP', 'abs', 4);
for (const op of [0x14, 0x34, 0x54, 0x74, 0xD4, 0xF4]) def(op, 'NOP', 'zpx', 4);
for (const op of [0x1C, 0x3C, 0x5C, 0x7C, 0xDC, 0xFC]) def(op, 'NOP', 'absx', 4);
// Unstable/opaque opcodes: harmless approximations so no opcode jams silently
for (const op of [0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xB2, 0xD2, 0xF2]) def(op, 'JAM', 'imp', 2);
def(0x8B, 'XAA', 'imm', 2);
def(0x93, 'SHA', 'izy', 6, true);
def(0x9B, 'TAS', 'absy', 5, true);
def(0x9C, 'SHY', 'absx', 5, true);
def(0x9E, 'SHX', 'absy', 5, true);
def(0x9F, 'SHA', 'absy', 5, true);
def(0xBB, 'LAS', 'absy', 4);

// precompute page-cross penalty eligibility (index 4) for the dispatch loop
for (let i = 0; i < 256; i++) {
  const e = TABLE[i];
  if (e) e[4] = e[3] || READ_MODES.has(e[1]);
}
// RMW (d),y illegals run a fixed 8 cycles on real hardware — the izy mode
// would otherwise pick up a spurious +1 read penalty on a page cross
for (const op of [0x13, 0x33, 0x53, 0x73, 0xD3, 0xF3]) TABLE[op][4] = false;
