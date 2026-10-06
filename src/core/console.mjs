// NEStalgia — console integration: bus arbitration, 3:1 PPU:CPU dot timing,
// OAM DMA stalls, controller shift registers, NMI/IRQ edge delivery, and
// whole-machine save states.
import { CPU } from './cpu.mjs';
import { PPU, SCREEN_W, SCREEN_H } from './ppu.mjs';
import { Cartridge } from './cart.mjs';

export class Console {
  constructor(rom, { onSave = null } = {}) {
    this.cart = new Cartridge(rom, { onSave });
    this.ppu = new PPU(this.cart);
    this.cpu = new CPU(this, { bcd: false });
    this.ram = new Uint8Array(2048);
    this.apu = null; // attached in M6; bus writes are tolerated without it
    this.controllers = [0, 0];
    this.strobe = 0;
    this.shiftIdx = [0, 0];
    this.prevNmi = false;
    this.prevIrq = false;
    this.dmaPending = -1;
    this.reset();
  }

  reset() {
    this.ram.fill(0);
    this.ppu.reset();
    this.cpu = new CPU(this, { bcd: false });
    this.controllers = [0, 0];
    this.strobe = 0;
    this.shiftIdx = [0, 0];
    this.cpu.reset();
  }

  // ---- CPU bus ---------------------------------------------------------------
  cpuRead(addr) {
    addr &= 0xFFFF;
    if (addr < 0x2000) return this.ram[addr & 0x7FF];
    if (addr < 0x4000) return this.ppu.cpuRead(addr & 7);
    if (addr === 0x4016) return this.readController(0);
    if (addr === 0x4017) return this.readController(1);
    if (addr < 0x4020) return this.apu ? this.apu.cpuRead(addr) : 0;
    if (addr < 0x8000) return this.cart.cpuRead(addr);
    return this.cart.cpuRead(addr);
  }

  cpuWrite(addr, v) {
    addr &= 0xFFFF;
    v &= 0xFF;
    if (addr < 0x2000) { this.ram[addr & 0x7FF] = v; return; }
    if (addr < 0x4000) { this.ppu.cpuWrite(addr & 7, v); return; }
    if (addr === 0x4014) { this.dmaPending = v; return; }
    if (addr === 0x4016) {
      if (v & 0x01) { this.strobe = 1; this.shiftIdx = [0, 0]; }
      else if (this.strobe) { this.strobe = 0; }
      return;
    }
    if (addr < 0x4020) { if (this.apu) this.apu.cpuWrite(addr, v); return; }
    this.cart.cpuWrite(addr, v);
  }

  readController(i) {
    if (this.strobe) this.shiftIdx[i] = 0;
    const buttons = this.controllers[i];
    const idx = this.shiftIdx[i]++;
    if (idx >= 8) return 0x41; // signature after 8 reads
    const bit = (buttons >> idx) & 1;
    return 0x40 | bit;
  }

  // ---- main loop ---------------------------------------------------------------
  // Runs PPU ticks in groups of 3 per CPU cycle; returns cycles consumed.
  stepCycles() {
    const cycles = this.cpu.step();
    let total = cycles;
    if (this.dmaPending >= 0) {
      const page = this.dmaPending;
      this.dmaPending = -1;
      this.ppu.oamDMA(page, (a) => this.cpuRead(a));
      total += 513;
    }
    for (let i = 0; i < total * 3; i++) this.ppu.tick();
    if (this.apu) this.apu.runCycles(total, this);
    // interrupt edges
    const nmi = this.ppu.nmiLine;
    if (nmi && !this.prevNmi) this.cpu.nmiPending = true;
    this.prevNmi = nmi;
    const irq = this.apu ? this.apu.irqLine : false;
    if (irq && !this.prevIrq) { /* level-triggered; cpu samples each step */ }
    this.prevIrq = irq;
    this.cpu.irqLine = irq;
    return total;
  }

  runFrame() {
    const startFrame = this.ppu.frameCount;
    let guard = 0;
    while (this.ppu.frameCount === startFrame) {
      this.stepCycles();
      if (++guard > 40000) throw new Error('frame did not complete (jammed CPU?)');
    }
  }

  runFrames(n) {
    for (let i = 0; i < n; i++) this.runFrame();
  }

  // ---- save states ------------------------------------------------------------
  toState() {
    return {
      ram: b64(this.ram),
      cpu: this.cpu.toState(),
      ppu: this.ppu.toState(),
      cart: this.cart.toState(),
      apu: this.apu ? this.apu.toState() : null,
      strobe: this.strobe,
      shiftIdx: [...this.shiftIdx],
      prevNmi: this.prevNmi,
    };
  }

  fromState(s) {
    this.ram.set(unb64(s.ram));
    this.cpu.fromState(s.cpu);
    this.ppu.fromState(s.ppu);
    this.cart.fromState(s.cart);
    if (this.apu && s.apu) this.apu.fromState(s.apu);
    this.strobe = s.strobe;
    this.shiftIdx = [...s.shiftIdx];
    this.prevNmi = s.prevNmi;
  }
}

import { b64, unb64 } from './cart.mjs';
export { SCREEN_W, SCREEN_H };
