// NEStalgia — cartridge: iNES header parsing + mappers 0 (NROM), 1 (MMC1),
// 2 (UxROM), 3 (CNROM), 7 (AxROM). Battery-backed PRG RAM persists through
// save/load callbacks provided by the host.

export class Cartridge {
  constructor(rom, { onSave = null } = {}) {
    this.rom = rom;
    this.onSave = onSave;
    if (rom.length < 16 || rom[0] !== 0x4E || rom[1] !== 0x45 || rom[2] !== 0x53 || rom[3] !== 0x1A) {
      throw new Error('Not an iNES file (missing "NES\\x1a" magic)');
    }
    const f6 = rom[6], f7 = rom[7];
    const mapper = (f7 & 0xF0) | (f6 >> 4);
    const isNES20 = (f7 & 0x0C) === 0x08;
    const prgBlocks = rom[4];
    const chrBlocks = rom[5];
    let off = 16;
    if (f6 & 0x04) off += 512; // trainer
    const prgSize = prgBlocks * 16384;
    const chrSize = chrBlocks * 8192;
    this.prg = rom.slice(off, off + prgSize);
    this.chr = chrBlocks ? rom.slice(off + prgSize, off + prgSize + chrSize) : null;
    this.chrRam = !this.chr;
    if (this.chrRam) this.chr = new Uint8Array(8192);
    this.mapperId = isNES20 ? mapper | ((f7 & 0x0C) ? ((rom[8] & 0x0F) << 8) : 0) : mapper;
    this.battery = !!(f6 & 0x02);
    this.prgRam = new Uint8Array(8192);
    this.mirroring = (f6 & 0x01) ? 'V' : 'H';
    if (f6 & 0x08) this.mirroring = '4'; // four-screen (rare; treat as single1 fallback)
    this.hardwired = true; // mirroring fixed by header until a mapper overrides
    this.prgBankCount = Math.max(1, prgBlocks); // in 16KB units
    this.chrBankCount = Math.max(1, chrBlocks);
    this.prgBankL = 0;   // UxROM switchable bank (byte offset)
    this.prgBank32 = 0;  // AxROM/GNROM/BNROM switchable bank (byte offset)
    this.chrBank6 = 0;   // CNROM/GNROM CHR bank
    this.chrBank11 = 0;  // Color Dreams CHR bank

    switch (this.mapperId) {
      case 0: case 1: case 2: case 3: case 4: case 7: case 11: case 34: case 66: break;
      default: throw new Error(`Unsupported mapper ${this.mapperId} (supported: 0, 1, 2, 3, 4, 7, 11, 34, 66)`);
    }
    if (this.mapperId === 1) this._mmc1Reset();
    if (this.mapperId === 4) this._mmc3Reset();
  }

  // ---- CPU space -----------------------------------------------------------
  cpuRead(addr) {
    if (addr < 0x2000) return this.prgRam[addr & 0x1FFF];
    if (addr < 0x8000) return this.prgRam[addr & 0x1FFF]; // $6000-$7FFF PRG RAM window
    return this._cpuBankRead(addr);
  }
  cpuWrite(addr, v) {
    if (addr < 0x8000) { this.prgRam[addr & 0x1FFF] = v; if (this.battery && this.onSave) this.onSave(this.prgRam); return; }
    this._cpuBankWrite(addr, v);
  }

  _cpuBankRead(addr) {
    switch (this.mapperId) {
      case 0: { // NROM: 16K mirrored or 32K fixed
        return this.prg[(addr - 0x8000) % this.prg.length];
      }
      case 2: { // UxROM: $8000 switchable, $C000 fixed to last bank
        if (addr < 0xC000) return this.prg[(this.prgBankL + (addr - 0x8000)) % this.prg.length];
        return this.prg[this.prg.length - 16384 + (addr - 0xC000)];
      }
      case 3: return this.prg[(addr - 0x8000) % this.prg.length];
      case 7: return this.prg[(this.prgBank32 + (addr - 0x8000)) % this.prg.length];
      case 11: return this.prg[(this.prgBank32 + (addr - 0x8000)) % this.prg.length];
      case 34: return this.prg[(this.prgBank32 + (addr - 0x8000)) % this.prg.length];
      case 66: return this.prg[(this.prgBank32 + (addr - 0x8000)) % this.prg.length];
      case 4: return this._mmc3CpuRead(addr);
      case 1: return this._mmc1CpuRead(addr);
      default: return 0;
    }
  }

  _cpuBankWrite(addr, v) {
    switch (this.mapperId) {
      case 2: if (addr >= 0x8000) this.prgBankL = ((v & 0x0F) * 16384) % this.prg.length; break;
      case 3: this.chrBank6 = v & 0x03; break; // CNROM: 2 bits typical
      case 7: this.prgBank32 = ((v & 0x03) * 32768) % this.prg.length; this.mirroring = (v & 0x10) ? 'S1' : 'S0'; this.hardwired = false; break;
      case 1: this._mmc1Write(addr, v); break;
      case 4: this._mmc3Write(addr, v); break;
      case 11: this.chrBank11 = v & 0x0F; this.prgBank32 = ((v >> 4) & 0x03) * 32768; break;
      case 34: this.prgBank32 = (v & 0x03) * 32768; break; // BNROM (CHR RAM fixed)
      case 66: this.chrBank6 = v & 0x03; this.prgBank32 = ((v >> 4) & 0x03) * 32768; break;
      default: break;
    }
  }

  // ---- PPU space -----------------------------------------------------------
  ppuRead(addr) {
    addr &= 0x1FFF;
    if (addr < 0x2000) return this._chrRead(addr);
    return 0;
  }
  ppuWrite(addr, v) {
    addr &= 0x1FFF;
    if (addr < 0x2000 && this.chrRam) this.chr[addr] = v;
  }
  _chrRead(addr) {
    switch (this.mapperId) {
      case 3: {
        const bank = this.chrBank6 ?? 0;
        return this.chr[((bank * 8192) + addr) % this.chr.length];
      }
      case 11: return this.chr[((this.chrBank11 * 8192) + addr) % this.chr.length];
      case 66: return this.chr[((this.chrBank6 * 8192) + addr) % this.chr.length];
      case 4: return this._mmc3ChrRead(addr);
      case 1: return this._mmc1ChrRead(addr);
      default: return this.chr[addr % this.chr.length];
    }
  }

  // ---- MMC3 (mapper 4) --------------------------------------------------------
  _mmc3Reset() {
    this.mmc3Cmd = 0; this.mmc3Banks = new Uint8Array(8);
    this.irqLatch = 0; this.irqCounter = 0; this.irqReload = false;
    this.irqEnable = false; this.irqAsserted = false;
    this.prgBankL = 0;
  }
  _mmc3Write(addr, v) {
    if (addr <= 0x9FFF) {
      if ((addr & 1) === 0) {
        this.mmc3Cmd = v & 0x07;
        this.mmc3ChrMode = (v & 0x80) !== 0;
        this.mmc3PrgMode = (v & 0x40) !== 0;
      } else {
        this.mmc3Banks[this.mmc3Cmd] = v;
      }
    } else if (addr <= 0xBFFF) {
      this.mirroring = (v & 1) ? 'V' : 'H'; // bit 0: vertical / horizontal
      this.hardwired = false;
    } else if (addr <= 0xDFFF) {
      if ((addr & 1) === 0) { this.irqLatch = v; } else { this.irqReload = true; }
    } else {
      if ((addr & 1) === 0) { this.irqEnable = false; this.irqAsserted = false; } // $E000 ack
      else { this.irqEnable = true; }                                            // $E001 enable
    }
  }
  // PPU A12 rising edge, approximated as once per rendered scanline.
  clockIrq() {
    let c = this.irqCounter;
    if (c === 0 || this.irqReload) { c = this.irqLatch; this.irqReload = false; }
    c = (c - 1) & 0xFF;
    this.irqCounter = c;
    if (c === 0 && this.irqEnable) this.irqAsserted = true;
  }
  get irqLine() { return !!this.irqAsserted; }
  _mmc3CpuRead(addr) {
    const r6 = this.mmc3Banks[6] & 0x3F, r7 = this.mmc3Banks[7] & 0x3F;
    const n8 = this.prg.length >> 13; // 8KB banks
    let bank;
    if (addr < 0xA000) bank = this.mmc3PrgMode ? (n8 - 2) : r6;
    else if (addr < 0xC000) bank = r7;
    else if (addr < 0xE000) bank = this.mmc3PrgMode ? r6 : (n8 - 2);
    else bank = n8 - 1;
    return this.prg[(((bank * 8192) + (addr & 0x1FFF)) % this.prg.length)];
  }
  _mmc3ChrRead(addr) {
    let bank, window;
    if (this.mmc3ChrMode) { // 1KB at $0000, 2KB at $1000
      if (addr < 0x1000) { bank = this.mmc3Banks[2 + ((addr >> 10) & 3)]; return this.chr[((bank * 1024) + (addr & 0x3FF)) % this.chr.length]; }
      window = (addr >> 11) & 1; bank = this.mmc3Banks[window];
      return this.chr[((bank * 2048) + (addr & 0x7FF)) % this.chr.length];
    }
    if (addr < 0x1000) { window = (addr >> 11) & 1; bank = this.mmc3Banks[window]; return this.chr[((bank * 2048) + (addr & 0x7FF)) % this.chr.length]; }
    bank = this.mmc3Banks[2 + ((addr >> 10) & 3)];
    return this.chr[((bank * 1024) + (addr & 0x3FF)) % this.chr.length];
  }

  // ---- MMC1 ------------------------------------------------------------------
  _mmc1Reset() {
    this.mmc1Shift = 0;
    this.mmc1Count = 0;
    this.mmc1Ctrl = 0x0C;  // PRG mode 3, last bank fixed at $C000
    this.mmc1Chr0 = 0; this.mmc1Chr1 = 1; this.mmc1Prg = 0;
    this.prgBankL = 0;
    this._applyPrg();
    this._applyChr();
    this._applyMirror();
  }
  _mmc1Write(addr, v) {
    if (v & 0x80) { // bit7 write resets the shift register and PRG mode
      this.mmc1Shift = 0; this.mmc1Count = 0;
      this.mmc1Ctrl = (this.mmc1Ctrl & ~0x0C) | 0x0C;
      this._applyPrg(); return;
    }
    this.mmc1Shift = (this.mmc1Shift >> 1) | ((v & 1) << 4);
    if (++this.mmc1Count < 5) return;
    this.mmc1Count = 0;
    const value = this.mmc1Shift & 0x1F;
    this.mmc1Shift = 0;
    if (addr <= 0x9FFF) { this.mmc1Ctrl = value; this._applyPrg(); this._applyChr(); this._applyMirror(); }
    else if (addr <= 0xBFFF) { this.mmc1Chr0 = value; this._applyChr(); }
    else if (addr <= 0xDFFF) { this.mmc1Chr1 = value; this._applyChr(); }
    else { this.mmc1Prg = value; this._applyPrg(); }
  }
  _applyPrg() {
    const mode = (this.mmc1Ctrl >> 2) & 0x03;
    const bank = this.mmc1Prg & 0x0F;
    this._mmc1PrgMode = mode; this._mmc1PrgBank = bank;
  }
  _applyChr() {
    const mode = this.mmc1Ctrl & 0x03;
    this._mmc1ChrMode = mode;
  }
  _applyMirror() {
    const m = this.mmc1Ctrl & 0x03;
    this.mirroring = m === 0 ? 'S0' : m === 1 ? 'S1' : m === 2 ? 'V' : 'H';
    this.hardwired = false;
  }
  _mmc1CpuRead(addr) {
    const mode = this._mmc1PrgMode;
    const bank = this._mmc1PrgBank;
    const n = this.prgBankCount;
    if (mode === 3) { // $8000 switchable, $C000 fixed last
      if (addr < 0xC000) return this.prg[((bank % (n - 1)) * 16384) + (addr - 0x8000)];
      return this.prg[((n - 1) * 16384) + (addr - 0xC000)];
    }
    if (mode === 2) { // $8000 fixed first, $C000 switchable
      if (addr < 0xC000) return this.prg[addr - 0x8000];
      return this.prg[((bank % (n - 1)) * 16384) + (addr - 0xC000)];
    }
    // 32K switchable (mode 0/1)
    const b32 = (((bank >> 1) % Math.max(1, n >> 1)) * 32768);
    return this.prg[(b32 + (addr - 0x8000)) % this.prg.length];
  }
  _mmc1ChrRead(addr) {
    const mode = this._mmc1ChrMode;
    if (mode >= 2) { // 8K mode (bank0 select)
      const bank = (this.mmc1Chr0 & 0x1E) >> 1;
      return this.chr[((bank * 8192) + addr) % this.chr.length];
    }
    const b0 = (this.mmc1Chr0 & 0x1F) * 4096;
    const b1 = (this.mmc1Chr1 & 0x1F) * 4096;
    if (addr < 0x1000) return this.chr[(b0 + addr) % this.chr.length];
    return this.chr[(b1 + (addr - 0x1000)) % this.chr.length];
  }

  // ---- persistence -----------------------------------------------------------
  loadSave(data) { if (data) this.prgRam.set(data instanceof Uint8Array ? data : new Uint8Array(data)); }
  dumpSave() { return this.prgRam.slice(); }

  toState() {
    const s = {
      mirroring: this.mirroring, hardwired: this.hardwired,
      prgBankL: this.prgBankL, prgBank32: this.prgBank32, chrBank6: this.chrBank6 ?? 0,
      chrBank11: this.chrBank11 ?? 0,
      mmc1Shift: this.mmc1Shift, mmc1Ctrl: this.mmc1Ctrl,
      mmc1Chr0: this.mmc1Chr0, mmc1Chr1: this.mmc1Chr1, mmc1Prg: this.mmc1Prg,
      mmc3Cmd: this.mmc3Cmd, mmc3Banks: this.mmc3Banks ? [...this.mmc3Banks] : [0,0,0,0,0,0,0,0],
      mmc3ChrMode: !!this.mmc3ChrMode, mmc3PrgMode: !!this.mmc3PrgMode,
      irqLatch: this.irqLatch, irqCounter: this.irqCounter,
      irqReload: !!this.irqReload, irqEnable: !!this.irqEnable, irqAsserted: !!this.irqAsserted,
    };
    if (this.chrRam) s.chr = b64(this.chr);
    return s;
  }
  fromState(s) {
    this.mirroring = s.mirroring; this.hardwired = s.hardwired;
    this.prgBankL = s.prgBankL; this.prgBank32 = s.prgBank32; this.chrBank6 = s.chrBank6;
    this.chrBank11 = s.chrBank11;
    this._mmc1Reset();
    this.mmc1Ctrl = s.mmc1Ctrl; this.mmc1Chr0 = s.mmc1Chr0; this.mmc1Chr1 = s.mmc1Chr1; this.mmc1Prg = s.mmc1Prg;
    this.mmc1Shift = s.mmc1Shift;
    this._applyPrg(); this._applyChr(); this._applyMirror();
    if (this.mapperId === 4) {
      this.mmc3Cmd = s.mmc3Cmd;
      this.mmc3Banks = new Uint8Array(s.mmc3Banks);
      this.mmc3ChrMode = s.mmc3ChrMode; this.mmc3PrgMode = s.mmc3PrgMode;
      this.irqLatch = s.irqLatch; this.irqCounter = s.irqCounter;
      this.irqReload = s.irqReload; this.irqEnable = s.irqEnable; this.irqAsserted = s.irqAsserted;
    }
    if (this.chrRam && s.chr) this.chr.set(unb64(s.chr));
  }
}

// base64 helpers (kept local to avoid shared-state imports in the core)
export function b64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(u8).toString('base64');
}
export function unb64(str) {
  if (typeof atob === 'function') {
    const s = atob(str);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }
  return new Uint8Array(Buffer.from(str, 'base64'));
}
