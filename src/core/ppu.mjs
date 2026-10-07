// NEStalgia — Ricoh 2C02 PPU, written from scratch.
// Dot-level timing (341 dots x 262 scanlines), loopy v/t/x/w scrolling,
// background fetch pipeline with shift registers, sprite evaluation with the
// 8-sprite-per-line limit, sprite 0 hit, palette mirroring quirks, and
// horizontal/vertical/single-screen mirroring modes.

export const SCREEN_W = 256;
export const SCREEN_H = 240;

// NTSC palette generated from hue/level geometry (deterministic, no tables).
function generatePalette() {
  const pal = new Uint32Array(64);
  const rows = [
    { base: 0.22, amp: 0.14 },
    { base: 0.42, amp: 0.22 },
    { base: 0.58, amp: 0.30 },
    { base: 0.78, amp: 0.22 },
  ];
  for (let i = 0; i < 64; i++) {
    const row = (i >> 4) & 3;
    const hue = i & 0x0F;
    const { base, amp } = rows[row];
    let r, g, b;
    if (hue === 0) { r = g = b = base + amp * 0.0; r = g = b = base; }
    else if (hue === 13 || hue === 14) { r = g = b = base * 0.6; }
    else if (hue === 15) { r = g = b = 0; }
    else {
      // hue 1..12 → 240° + 30°/step so that $01=blue $0A=green $06=red-ish
      const deg = 240 + ((hue - 1) % 12) * 30;
      const a = (deg * Math.PI) / 180;
      r = base + amp * Math.sin(a + 2.0944);      // +120°
      g = base + amp * Math.sin(a - 2.0944);      // -120°
      b = base + amp * Math.sin(a);
      r = Math.max(0, Math.min(1, r));
      g = Math.max(0, Math.min(1, g));
      b = Math.max(0, Math.min(1, b));
    }
    const R = Math.round(Math.pow(r, 0.9) * 255);
    const G = Math.round(Math.pow(g, 0.9) * 255);
    const B = Math.round(Math.pow(b, 0.9) * 255);
    pal[i] = 0xFF000000 | (B << 16) | (G << 8) | R; // little-endian ABGR
  }
  return pal;
}
export const NES_PALETTE = generatePalette();

// Emphasis-bit variants of the palette ($2001 bits 5-7 boost B/G/R and dim
// the rest, like a real TV). Built lazily; index 0 is the plain palette.
const EMPHASIS_TABLES = [NES_PALETTE];
function emphasisTable(bits) {
  if (!EMPHASIS_TABLES[bits]) {
    const t = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
      const c = NES_PALETTE[i];
      let r = (c & 0xFF) / 255, g = ((c >> 8) & 0xFF) / 255, b = ((c >> 16) & 0xFF) / 255;
      r = (bits & 1) ? Math.min(1, r * 1.1 + 0.03) : r * 0.75;
      g = (bits & 2) ? Math.min(1, g * 1.1 + 0.03) : g * 0.75;
      b = (bits & 4) ? Math.min(1, b * 1.1 + 0.03) : b * 0.75;
      const R = Math.round(r * 255), G = Math.round(g * 255), B = Math.round(b * 255);
      t[i] = 0xFF000000 | (B << 16) | (G << 8) | R;
    }
    EMPHASIS_TABLES[bits] = t;
  }
  return EMPHASIS_TABLES[bits];
}

export class PPU {
  constructor(cart) {
    this.cart = cart;
    this.reset();
  }

  reset() {
    this.vram = new Uint8Array(2048);
    this.palette = new Uint8Array(32);
    this.oam = new Uint8Array(256);
    this.framebuffer = new Uint32Array(SCREEN_W * SCREEN_H);
    this.control = 0; this.mask = 0; this.status = 0;
    this.oamAddr = 0;
    this.v = 0; this.t = 0; this.fineX = 0; this.w = 0;
    this.readBuffer = 0;
    this.scanline = 261; this.dot = 0; this.oddFrame = false;
    this.frameCount = 0;
    this.nmiOccurred = false; this.nmiOutputPrev = false;
    // background pipeline
    this.ntByte = 0; this.atByte = 0; this.bgLo = 0; this.bgHi = 0;
    this.shLoPat = 0; this.shHiPat = 0; this.shLoAttr = 0; this.shHiAttr = 0;
    // sprites for the current line
    this.sprCount = 0;
    this.sprX = new Uint8Array(8);
    this.sprPatLo = new Uint8Array(8);
    this.sprPatHi = new Uint8Array(8);
    this.sprAttr = new Uint8Array(8);
    this.sprIs0 = new Uint8Array(8);
    this.sprNextFill = 0;
    this.sprNextCount = 0;
    this.sprNextX = new Uint8Array(8);
    this.sprNextPatLo = new Uint8Array(8);
    this.sprNextPatHi = new Uint8Array(8);
    this.sprNextAttr = new Uint8Array(8);
    this.sprNextIs0 = new Uint8Array(8);
  }

  // ---- mirroring ------------------------------------------------------------
  get mirroring() {
    if (!this.cart.hardwired) return this.cart.mirroring;
    return this.cart.mirroring;
  }
  ntIndex(addr) {
    const a = addr & 0x0FFF;
    switch (this.mirroring) {
      case 'H': return ((a >> 11) & 1) * 0x400 + (a & 0x3FF);
      case 'V': return ((a >> 10) & 1) * 0x400 + (a & 0x3FF);
      case 'S0': return (a & 0x3FF);
      case 'S1': return 0x400 + (a & 0x3FF);
      case '4': return (a & 0x7FF);
      default: return a & 0x3FF;
    }
  }
  vramRead(addr) { return this.vram[this.ntIndex(addr)]; }
  vramWrite(addr, v) { this.vram[this.ntIndex(addr)] = v; }

  // ---- CPU register access ($2000-$2007) -------------------------------------
  cpuRead(reg) {
    reg &= 7;
    switch (reg) {
      case 2: {
        const v = (this.status & 0xE0) | (this.readBuffer & 0x1F);
        this.status &= ~0x80; // clear vblank
        this.w = 0;
        return v;
      }
      case 4: return this.oam[this.oamAddr];
      case 7: {
        let v;
        const a = this.v & 0x3FFF;
        if (a >= 0x3F00) {
          v = this.paletteRead(a & 0x1F);
          this.readBuffer = this.vramRead(a);
        } else {
          v = this.readBuffer;
          this.readBuffer = a < 0x2000 ? this.cart.ppuRead(a) : this.vramRead(a);
        }
        this.v = (this.v + this.addrInc()) & 0x7FFF;
        return v;
      }
      default: return 0;
    }
  }

  cpuWrite(reg, v) {
    reg &= 7;
    switch (reg) {
      case 0: {
        this.control = v;
        this.t = (this.t & ~0x0C00) | ((v & 0x03) << 10);
        break;
      }
      case 1: this.mask = v; break;
      case 3: this.oamAddr = v; break;
      case 4: this.oam[this.oamAddr] = v; this.oamAddr = (this.oamAddr + 1) & 0xFF; break;
      case 5: {
        if (!this.w) {
          this.t = (this.t & ~0x001F) | (v >> 3);
          this.fineX = v & 0x07;
          this.w = 1;
        } else {
          this.t = (this.t & ~0x73E0) | ((v & 0x07) << 12) | ((v & 0xF8) << 2);
          this.w = 0;
        }
        break;
      }
      case 6: {
        if (!this.w) {
          this.t = (this.t & 0x00FF) | ((v & 0x3F) << 8);
          this.w = 1;
        } else {
          this.t = (this.t & 0xFF00) | v;
          this.v = this.t;
          this.w = 0;
        }
        break;
      }
      case 7: {
        const a = this.v & 0x3FFF;
        if (a >= 0x3F00) this.paletteWrite(a & 0x1F, v);
        else if (a < 0x2000) this.cart.ppuWrite(a, v);
        else this.vramWrite(a, v);
        this.v = (this.v + this.addrInc()) & 0x7FFF;
        break;
      }
    }
  }

  addrInc() { return (this.control & 0x04) ? 32 : 1; }
  get nmiEnable() { return !!(this.control & 0x80); }
  get nmiLine() { return this.nmiEnable && !!(this.status & 0x80); }

  paletteRead(i) {
    if ((i & 0x13) === 0x10) i &= ~0x10; // $3F10/$3F14/... mirror $3F00/...
    return this.palette[i];
  }
  paletteWrite(i, v) {
    if ((i & 0x13) === 0x10) i &= ~0x10;
    this.palette[i] = v & 0x3F;
  }

  // ---- scroll increment helpers (loopy) --------------------------------------
  incX() {
    if ((this.v & 0x001F) === 31) { this.v &= ~0x001F; this.v ^= 0x0400; }
    else this.v++;
  }
  incY() {
    if ((this.v & 0x7000) !== 0x7000) this.v += 0x1000;
    else {
      this.v &= ~0x7000;
      let y = (this.v & 0x03E0) >> 5;
      if (y === 29) { y = 0; this.v ^= 0x0800; }
      else if (y === 31) y = 0;
      else y++;
      this.v = (this.v & ~0x03E0) | (y << 5);
    }
  }

  // ---- main tick ---------------------------------------------------------------
  tick() {
    const line = this.scanline, dot = this.dot;
    const mask = this.mask;
    const renderingEnabled = (mask & 0x18) !== 0;
    const visible = line < 240;
    const prerender = line === 261;
    const fetchLine = visible || prerender;

    if (line === 241 && dot === 1) {
      this.status |= 0x80;
      this.frameCount++;
    }
    if (prerender && dot === 1) {
      this.status &= ~0xE0; // clear vblank + sprite0 + overflow
    }

    if (fetchLine && renderingEnabled) {
      if ((dot >= 2 && dot <= 257) || (dot >= 321 && dot <= 337)) {
        this.shLoPat <<= 1; this.shHiPat <<= 1;
        this.shLoAttr <<= 1; this.shHiAttr <<= 1;
        const ph = (dot - 1) & 7;
        if (ph === 0) {
          this.loadShifters();
          this.ntByte = this.vramRead(0x2000 | (this.v & 0x0FFF));
        }
        else if (ph === 2) {
          const v = this.v;
          const a = 0x23C0 | (v & 0x0C00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07);
          this.atByte = (this.vramRead(a) >> (((v >> 4) & 4) | (v & 2))) & 3;
        }
        else if (ph === 4) {
          this.bgLo = this.cart.ppuRead(((this.control & 0x10) << 8) + this.ntByte * 16 + ((this.v >> 12) & 7));
        }
        else if (ph === 6) {
          this.bgHi = this.cart.ppuRead(((this.control & 0x10) << 8) + this.ntByte * 16 + 8 + ((this.v >> 12) & 7));
        }
        else if (ph === 7) this.incX();
      }
      if (dot === 256) this.incY();
      if (dot === 257) {
        this.loadShifters();
        this.v = (this.v & ~0x041F) | (this.t & 0x041F);
      }
      if (prerender && dot >= 280 && dot <= 304) {
        this.v = (this.v & ~0x7BE0) | (this.t & 0x7BE0);
      }
    }

    // sprite evaluation for next line (visible + prerender lines)
    if ((visible || prerender) && dot === 257) {
      this.evaluateSprites((line + 1) % 262);
    }
    // MMC3-style scanline IRQ hook (approximate PPU A12 rising edge)
    if (fetchLine && renderingEnabled && dot === 260 && this.onA12) {
      this.onA12();
    }

    // pixel output
    if (visible && dot >= 1 && dot <= 256) {
      this.renderPixel(line, dot - 1);
    }

    // odd-frame cycle skip
    if (prerender && dot === 339 && this.oddFrame && renderingEnabled) {
      this.dot = 0; this.scanline = 0; this.beginLine();
      this.oddFrame = !this.oddFrame;
      return;
    }

    this.dot++;
    if (this.dot > 340) {
      this.dot = 0;
      this.scanline++;
      if (this.scanline > 261) {
        this.scanline = 0;
        this.oddFrame = !this.oddFrame;
      }
      this.beginLine();
    }
  }

  beginLine() {
    // prepare sprite latches at start of visible line (fetched on prev line)
    if (this.scanline < 240) {
      this.sprCount = this.sprNextCount; this.sprNextCount = 0;
      this.sprX.set(this.sprNextX);
      this.sprPatLo.set(this.sprNextPatLo);
      this.sprPatHi.set(this.sprNextPatHi);
      this.sprAttr.set(this.sprNextAttr);
      this.sprIs0.set(this.sprNextIs0);
    }
  }

  loadShifters() {
    this.shLoPat = (this.shLoPat & 0xFF00) | this.bgLo;
    this.shHiPat = (this.shHiPat & 0xFF00) | this.bgHi;
    const a0 = (this.atByte & 1) ? 0xFF : 0x00;
    const a1 = (this.atByte & 2) ? 0xFF : 0x00;
    this.shLoAttr = (this.shLoAttr & 0xFF00) | a0;
    this.shHiAttr = (this.shHiAttr & 0xFF00) | a1;
  }

  evaluateSprites(line) {
    this.sprNextCount = 0;
    const h = (this.control & 0x20) ? 16 : 8;
    let overflow = false;
    for (let i = 0; i < 64; i++) {
      const y = this.oam[i * 4];
      const row = line - y - 1;
      const inRange = row >= 0 && row < h;
      if (inRange && this.sprNextCount < 8) {
        const tile = this.oam[i * 4 + 1];
        const attr = this.oam[i * 4 + 2];
        const x = this.oam[i * 4 + 3];
        let addrLo;
        if (h === 8) {
          const row2 = (attr & 0x80) ? 7 - row : row; // vertical flip
          addrLo = ((this.control & 0x08) ? 0x1000 : 0) + tile * 16 + row2;
        } else {
          let effRow = row;
          if (attr & 0x80) effRow = 15 - row; // vertical flip reverses the 16 rows
          const bank = (tile & 1) * 0x1000;
          const tileIdx = (tile & 0xFE) + (effRow >= 8 ? 1 : 0);
          addrLo = bank + tileIdx * 16 + (effRow & 7);
        }
        let lo = this.cart.ppuRead(addrLo);
        let hi = this.cart.ppuRead(addrLo + 8);
        if (attr & 0x40) { // horizontal flip
          lo = flipByte(lo); hi = flipByte(hi);
        }
        const n = this.sprNextCount;
        this.sprNextX[n] = x;
        this.sprNextPatLo[n] = lo;
        this.sprNextPatHi[n] = hi;
        this.sprNextAttr[n] = attr;
        this.sprNextIs0[n] = i === 0 ? 1 : 0;
        this.sprNextCount++;
      } else if (inRange && this.sprNextCount >= 8) {
        overflow = true;
        if (this.mask & 0x18) this.status |= 0x20;
        break;
      }
    }
  }

  renderPixel(line, x) {
    const mask = this.mask;
    const bgOn = (mask & 0x08) !== 0;
    const sprOn = (mask & 0x10) !== 0;
    let bgPix = 0, bgPal = 0;
    if (bgOn && (x >= 8 || (mask & 0x02) !== 0)) {
      const bit = 15 - this.fineX;
      const p0 = (this.shLoPat >> bit) & 1;
      const p1 = (this.shHiPat >> bit) & 1;
      bgPix = (p1 << 1) | p0;
      if (bgPix) {
        const a0 = (this.shLoAttr >> bit) & 1;
        const a1 = (this.shHiAttr >> bit) & 1;
        bgPal = ((a1 << 1) | a0) << 2;
      }
    }

    let sprPix = 0, sprPal = 0, sprPriority = 0, spr0 = false;
    if (sprOn && this.sprCount !== 0 && (x >= 8 || (mask & 0x04) !== 0)) {
      const sprX = this.sprX, sprPatLo = this.sprPatLo, sprPatHi = this.sprPatHi, sprAttr = this.sprAttr, sprIs0 = this.sprIs0;
      for (let i = 0; i < this.sprCount; i++) { // lower OAM index wins
        const dx = x - sprX[i];
        if (dx < 0 || dx > 7) continue;
        const p0 = (sprPatLo[i] >> (7 - dx)) & 1;
        const p1 = (sprPatHi[i] >> (7 - dx)) & 1;
        const pix = (p1 << 1) | p0;
        if (!pix) continue;
        sprPix = pix;
        sprPal = (sprAttr[i] & 3) << 2;
        sprPriority = sprAttr[i] & 0x20;
        spr0 = sprIs0[i] !== 0;
        break;
      }
    }

    // sprite 0 hit
    if (spr0 && sprPix && bgPix && x < 255 && bgOn && sprOn && (x >= 8 || ((mask & 0x06) === 0x06))) {
      this.status |= 0x40;
    }

    let c;
    if (sprPix && (!bgPix || !sprPriority)) {
      let i = 0x10 + sprPal + sprPix;
      if ((i & 0x13) === 0x10) i &= ~0x10; // sprite $1x mirrors backdrop at x0/x4/x8/xc
      c = this.palette[i];
    } else if (bgPix) {
      c = this.palette[bgPal + bgPix];
    } else {
      c = this.palette[0]; // universal backdrop
    }
    if (mask & 0x01) c &= 0x30; // grayscale
    const em = mask & 0xE0;
    this.framebuffer[line * SCREEN_W + x] = em
      ? emphasisTable(em >> 5)[c]
      : NES_PALETTE[c];
  }

  // OAM DMA: 256 bytes copied by the CPU stall (console drives this)
  oamDMA(page, readFn) {
    const base = page << 8;
    for (let i = 0; i < 256; i++) {
      this.oam[(this.oamAddr + i) & 0xFF] = readFn(base + i);
    }
  }

  toState() {
    return {
      vram: b64(this.vram), palette: b64(this.palette), oam: b64(this.oam),
      control: this.control, mask: this.mask, status: this.status, oamAddr: this.oamAddr,
      v: this.v, t: this.t, fineX: this.fineX, w: this.w, readBuffer: this.readBuffer,
      scanline: this.scanline, dot: this.dot, oddFrame: this.oddFrame, frameCount: this.frameCount,
    };
  }
  fromState(s) {
    this.vram.set(unb64(s.vram));
    this.palette.set(unb64(s.palette));
    this.oam.set(unb64(s.oam));
    this.control = s.control; this.mask = s.mask; this.status = s.status; this.oamAddr = s.oamAddr;
    this.v = s.v; this.t = s.t; this.fineX = s.fineX; this.w = s.w; this.readBuffer = s.readBuffer;
    this.scanline = s.scanline; this.dot = s.dot; this.oddFrame = s.oddFrame; this.frameCount = s.frameCount;
  }
}

function flipByte(b) {
  b = ((b & 0xF0) >> 4) | ((b & 0x0F) << 4);
  b = ((b & 0xCC) >> 2) | ((b & 0x33) << 2);
  b = ((b & 0xAA) >> 1) | ((b & 0x55) << 1);
  return b;
}

import { b64, unb64 } from './cart.mjs';
