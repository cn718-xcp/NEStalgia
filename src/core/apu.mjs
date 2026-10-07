// NEStalgia — Ricoh 2A03 APU: two pulse channels (duty, envelope, sweep,
// length), triangle (linear counter), noise (15-bit LFSR), DMC (delta
// modulation with memory fetches), 4/5-step frame sequencer with IRQ, and
// the standard TND mixer. Emits ~48kHz samples via runCycles().
const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
  12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
];
const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const DMC_RATES = [428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54];
const DUTY = [
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [1, 0, 0, 1, 1, 1, 1, 1],
];
const SAMPLE_EVERY = 38; // ~47.1 kHz from 1.789773 MHz

class Pulse {
  constructor(chn) {
    this.chn = chn; // 0 or 1 (sweep negate quirk)
    this.enabled = false;
    this.dutyMode = 0; this.halt = false; this.constantVolume = false; this.volume = 0;
    this.sweepEnable = false; this.sweepPeriod = 0; this.sweepNegate = false; this.sweepShift = 0;
    this.timerPeriod = 0; this.timer = 0;
    this.dutyPos = 0;
    this.lengthCounter = 0;
    this.envDivider = 0; this.envDecay = 0; this.envRestart = false;
    this.sweepDivider = 0; this.sweepReload = false;
  }
  write(r, v) {
    switch (r) {
      case 0:
        this.dutyMode = (v >> 6) & 3; this.halt = !!(v & 0x20);
        this.constantVolume = !!(v & 0x10); this.volume = v & 0x0F;
        break;
      case 1:
        this.sweepEnable = !!(v & 0x80); this.sweepPeriod = ((v >> 4) & 7) + 1;
        this.sweepNegate = !!(v & 0x08); this.sweepShift = v & 7;
        this.sweepReload = true;
        break;
      case 2: this.timerPeriod = (this.timerPeriod & 0x700) | v; break;
      case 3:
        this.timerPeriod = (this.timerPeriod & 0xFF) | ((v & 7) << 8);
        if (this.enabled) this.lengthCounter = LENGTH_TABLE[(v >> 3) & 0x1F];
        this.dutyPos = 0;
        this.envRestart = true;
        break;
    }
  }
  tickTimer() {
    if (!this.enabled || this.lengthCounter === 0) return; // muted: duty phase is irrelevant
    if (--this.timer < 0) {
      this.timer = this.timerPeriod;
      this.dutyPos = (this.dutyPos + 1) & 7;
    }
  }
  sweepTarget() {
    const delta = this.timerPeriod >> this.sweepShift;
    let t = this.timerPeriod + (this.sweepNegate ? -delta : delta);
    if (this.chn === 0 && this.sweepNegate) t--;
    return t;
  }
  tickSweep() {
    if (this.sweepReload) { this.sweepDivider = this.sweepPeriod; this.sweepReload = false; return; }
    if (--this.sweepDivider < 0) {
      this.sweepDivider = this.sweepPeriod;
      if (this.sweepEnable && this.sweepShift && this.timerPeriod >= 8) {
        const t = this.sweepTarget();
        if (t <= 0x7FF) { this.timerPeriod = t; this.timer = t; }
      }
    }
  }
  tickEnvelope() {
    if (this.envRestart) {
      this.envRestart = false; this.envDecay = 15; this.envDivider = this.volume;
    } else if (--this.envDivider < 0) {
      this.envDivider = this.volume;
      if (this.envDecay > 0) this.envDecay--;
      else if (this.halt) this.envDecay = 15;
    }
  }
  tickLength() { if (!this.halt && this.lengthCounter > 0) this.lengthCounter--; }
  get muted() {
    return !this.enabled || this.lengthCounter === 0 || this.timerPeriod < 8 || this.sweepTarget() > 0x7FF;
  }
  output() {
    if (this.muted) return 0;
    const vol = this.constantVolume ? this.volume : this.envDecay;
    return DUTY[this.dutyMode][this.dutyPos] * vol;
  }
  toState() { return { ...this }; }
  fromState(s) { Object.assign(this, s); }
}

class Triangle {
  constructor() {
    this.enabled = false;
    this.control = false; this.linearReload = 0; this.linearCounter = 0;
    this.timerPeriod = 0; this.timer = 0;
    this.seqPos = 0;
    this.lengthCounter = 0;
  }
  write(r, v) {
    switch (r) {
      case 0: this.control = !!(v & 0x80); this.linearReload = v & 0x7F; break;
      case 2: this.timerPeriod = (this.timerPeriod & 0x700) | v; break;
      case 3:
        this.timerPeriod = (this.timerPeriod & 0xFF) | ((v & 7) << 8);
        if (this.enabled) this.lengthCounter = LENGTH_TABLE[(v >> 3) & 0x1F];
        this.linearCounter = this.linearReload;
        break;
    }
  }
  tickTimer() {
    if (this.lengthCounter === 0 || this.linearCounter === 0) return; // muted
    if (--this.timer < 0) {
      this.timer = this.timerPeriod;
      if (this.timerPeriod > 1) {
        this.seqPos = (this.seqPos + 1) & 31;
      }
    }
  }
  tickQuarter() {
    if (this.linearCounter > 0) this.linearCounter--;
    if (this.control) this.linearCounter = this.linearReload;
  }
  tickLength() { if (!this.control && this.lengthCounter > 0) this.lengthCounter--; }
  output() {
    if (!this.enabled || this.lengthCounter === 0 || this.linearCounter === 0) return 0;
    const s = this.seqPos;
    return s < 16 ? 15 - s : s - 16;
  }
  toState() { return { ...this }; }
  fromState(s) { Object.assign(this, s); }
}

class Noise {
  constructor() {
    this.enabled = false;
    this.halt = false; this.constantVolume = false; this.volume = 0;
    this.mode = false; this.periodIdx = 4;
    this.timer = NOISE_PERIODS[4];
    this.shift = 1;
    this.lengthCounter = 0;
    this.envDivider = 0; this.envDecay = 0; this.envRestart = false;
  }
  write(r, v) {
    switch (r) {
      case 0:
        this.halt = !!(v & 0x20); this.constantVolume = !!(v & 0x10); this.volume = v & 0x0F;
        break;
      case 2:
        this.mode = !!(v & 0x80); this.periodIdx = v & 0x0F;
        break;
      case 3:
        if (this.enabled) this.lengthCounter = LENGTH_TABLE[(v >> 3) & 0x1F];
        this.envRestart = true;
        break;
    }
  }
  tickTimer() {
    if (!this.enabled || this.lengthCounter === 0) return; // muted: LFSR phase is irrelevant
    if (--this.timer < 0) {
      this.timer = NOISE_PERIODS[this.periodIdx];
      const fb = (this.shift & 1) ^ ((this.shift >> (this.mode ? 6 : 1)) & 1);
      this.shift = ((fb << 14) | (this.shift >> 1)) & 0x7FFF;
    }
  }
  tickEnvelope() {
    if (this.envRestart) {
      this.envRestart = false; this.envDecay = 15; this.envDivider = this.volume;
    } else if (--this.envDivider < 0) {
      this.envDivider = this.volume;
      if (this.envDecay > 0) this.envDecay--;
      else if (this.halt) this.envDecay = 15;
    }
  }
  tickLength() { if (!this.halt && this.lengthCounter > 0) this.lengthCounter--; }
  output() {
    if (!this.enabled || this.lengthCounter === 0 || (this.shift & 1)) return 0;
    const vol = this.constantVolume ? this.volume : this.envDecay;
    return vol;
  }
  toState() { return { ...this }; }
  fromState(s) { Object.assign(this, s); }
}

class DMC {
  constructor() {
    this.enabled = false;
    this.irqEnable = false; this.loop = false; this.rateIdx = 0;
    this.directLoad = 0;
    this.addrReg = 0; this.lengthReg = 0;
    this.addr = 0; this.bytesLeft = 0;
    this.shift = 0; this.bitsLeft = 0; this.silence = true;
    this.timer = DMC_RATES[0];
    this.delta = 0;
    this.irq = false;
    this.readFn = null;
    this.playing = false;
  }
  write(r, v) {
    switch (r) {
      case 0:
        this.irqEnable = !!(v & 0x80); this.loop = !!(v & 0x40); this.rateIdx = v & 0x0F;
        if (!this.irqEnable) this.irq = false;
        break;
      case 1: this.directLoad = v & 0x7F; this.delta = this.directLoad; break;
      case 2: this.addrReg = 0x8000 | (v << 6); break;
      case 3: this.lengthReg = (v << 4) + 1; break;
    }
  }
  restart(readFn) {
    this.addr = this.addrReg;
    this.bytesLeft = this.lengthReg;
    this.readFn = readFn;
    if (this.bytesLeft > 0) {
      this.shift = readFn ? readFn(this.addr) : 0; // fetch first sample byte
      this.addr = (this.addr === 0xFFFF) ? 0x8000 : (this.addr + 1);
      this.bytesLeft--;
      this.bitsLeft = 8;
      this.silence = false;
    } else {
      this.silence = true;
    }
  }
  tickTimer(readFn) {
    if (this.silence && this.bytesLeft === 0 && !this.enabled) return; // fully idle
    if (--this.timer < 0) {
      this.timer = DMC_RATES[this.rateIdx];
      if (!this.silence) {
        const bit = this.shift & 1;
        this.shift >>= 1;
        this.bitsLeft--;
        if (!bit && this.delta < 126) this.delta += 2;
        else if (bit && this.delta > 1) this.delta -= 2;
        if (this.bitsLeft === 0) {
          this.bitsLeft = 8;
          if (this.bytesLeft > 0) {
            this.shift = readFn ? readFn(this.addr) : 0;
            this.addr = (this.addr === 0xFFFF) ? 0x8000 : (this.addr + 1);
            this.bytesLeft--;
          } else {
            this.silence = true;
            if (this.loop) this.restart(readFn);
            else if (this.irqEnable) this.irq = true;
          }
        }
      }
    }
  }
  output() { return this.delta; }
  toState() { const { readFn, ...rest } = this; return { ...rest }; }
  fromState(s) { Object.assign(this, s); this.readFn = null; }
}

export class APU {
  constructor() {
    this.pulse1 = new Pulse(0);
    this.pulse2 = new Pulse(1);
    this.triangle = new Triangle();
    this.noise = new Noise();
    this.dmc = new DMC();
    this.frameMode = 0;       // 0 = 4-step, 1 = 5-step
    this.irqInhibit = false;
    this.frameIrq = false;
    this.frameCycles = 0;
    this.sampleAccum = 0;
    this.sampleBuf = new Float32Array(8192);
    this.sampleHead = 0; this.sampleTail = 0;
    this.reset();
  }

  reset() {
    this.frameCycles = 0;
    this.frameIrq = false;
    this.irqInhibit = false;
  }

  get irqLine() { return this.frameIrq || this.dmc.irq; }

  cpuRead(addr) {
    if (addr === 0x4015) {
      const v =
        ((this.pulse1.lengthCounter > 0 ? 1 : 0)) |
        ((this.pulse2.lengthCounter > 0 ? 1 : 0) << 1) |
        ((this.triangle.lengthCounter > 0 ? 1 : 0) << 2) |
        ((this.noise.lengthCounter > 0 ? 1 : 0) << 3) |
        ((this.dmc.bytesLeft > 0 ? 1 : 0) << 4) |
        ((this.frameIrq ? 1 : 0) << 6) |
        ((this.dmc.irq ? 1 : 0) << 7);
      this.frameIrq = false;
      return v;
    }
    return 0;
  }

  cpuWrite(addr, v) {
    const a = addr & 0x1F;
    if (a <= 0x03) this.pulse1.write(a, v);
    else if (a <= 0x07) this.pulse2.write(a - 4, v);
    else if (a <= 0x0B) this.triangle.write(a - 8, v);
    else if (a <= 0x0F) this.noise.write(a - 0x0C, v);
    else if (a <= 0x13) this.dmc.write(a - 0x10, v);
    else if (a === 0x15) {
      this.pulse1.enabled = !!(v & 1); if (!(v & 1)) this.pulse1.lengthCounter = 0;
      this.pulse2.enabled = !!(v & 2); if (!(v & 2)) this.pulse2.lengthCounter = 0;
      this.triangle.enabled = !!(v & 4); if (!(v & 4)) this.triangle.lengthCounter = 0;
      this.noise.enabled = !!(v & 8); if (!(v & 8)) this.noise.lengthCounter = 0;
      this.dmc.enabled = !!(v & 16); if (!(v & 16)) this.dmc.bytesLeft = 0;
      if (this.dmc.enabled && this.dmc.bytesLeft === 0) this.dmc.restart((a2) => this.busRead(a2));
      this.dmc.irq = false;
    } else if (a === 0x17) {
      this.frameMode = (v >> 7) & 1;
      this.irqInhibit = !!(v & 0x40);
      if (this.irqInhibit) this.frameIrq = false;
      this.frameCycles = 0;
      if (this.frameMode === 1) { this.quarterTick(); this.halfTick(); }
    }
  }

  busRead(addr) { return this.busReader ? this.busReader(addr) : 0; }

  quarterTick() {
    this.pulse1.tickEnvelope(); this.pulse2.tickEnvelope();
    this.noise.tickEnvelope(); this.triangle.tickQuarter();
  }
  halfTick() {
    this.pulse1.tickLength(); this.pulse2.tickLength();
    this.noise.tickLength(); this.triangle.tickLength();
    this.pulse1.tickSweep(); this.pulse2.tickSweep();
  }

  runCycles(n, console_) {
    if (console_) this.busReader = (a) => console_.cpuRead(a);
    const p1 = this.pulse1, p2 = this.pulse2, tri = this.triangle, noi = this.noise, dmc = this.dmc;
    const dmcRead = (a) => this.busRead(a);
    for (let i = 0; i < n; i++) {
      if (p1.enabled && p1.lengthCounter !== 0) p1.tickTimer();
      if (p2.enabled && p2.lengthCounter !== 0) p2.tickTimer();
      if (tri.lengthCounter !== 0 && tri.linearCounter !== 0) tri.tickTimer();
      if (noi.enabled && noi.lengthCounter !== 0) noi.tickTimer();
      if (!(dmc.silence && dmc.bytesLeft === 0 && !dmc.enabled)) dmc.tickTimer(dmcRead);
      this.frameCycles++;
      if (this.frameMode === 0) {
        if (this.frameCycles === 14914 || this.frameCycles === 29828 || this.frameCycles === 44744) this.quarterTick();
        if (this.frameCycles === 29828) this.halfTick();
        if (this.frameCycles >= 59658) {
          this.halfTick();
          if (!this.irqInhibit) this.frameIrq = true;
          this.frameCycles = 0;
        }
      } else {
        if (this.frameCycles === 14914 || this.frameCycles === 29828 || this.frameCycles === 44744 || this.frameCycles === 52198) this.quarterTick();
        if (this.frameCycles === 29828 || this.frameCycles === 52198) this.halfTick();
        if (this.frameCycles >= 74566) this.frameCycles = 0;
      }
      if (++this.sampleAccum >= SAMPLE_EVERY) {
        this.sampleAccum = 0;
        this.pushSample(this.mix());
      }
    }
  }

  mix() {
    // NESdev non-inverting mixer, normalized so silence = 0
    const p1 = this.pulse1.output() / 15, p2 = this.pulse2.output() / 15;
    const tri = this.triangle.output() / 15, noi = this.noise.output() / 15;
    const dmc = this.dmc.output() / 128;
    const pulseOut = 95.88 / (100 + 100 * (p1 + p2));
    const tnd = 163.67 * tri + 122.41 * noi + 142.04 * dmc;
    const tndOut = 159.79 / (100 + tnd);
    // Subtract silence baselines and normalize
    const pulse_silence = 0.9588;  // 95.88/100
    const pulse_max = 0.3196;      // 95.88/300 (when p1+p2=2)
    const pulse_norm = (pulseOut - pulse_silence) / (pulse_max - pulse_silence);
    const tnd_silence = 1.5979;    // 159.79/100
    const tnd_max = 0.3026;        // 159.79/528.12 (when tri+noi+dmc=max)
    const tnd_norm = (tndOut - tnd_silence) / (tnd_max - tnd_silence);
    // Both norms in [-1, 0]. Scale to fit in [-1, 1].
    return (pulse_norm * 1.7 + tnd_norm * 1.3) * 0.33;
  }

  pushSample(s) {
    this.sampleBuf[this.sampleTail] = s;
    this.sampleTail = (this.sampleTail + 1) % this.sampleBuf.length;
    if (this.sampleTail === this.sampleHead) this.sampleHead = (this.sampleHead + 1) % this.sampleBuf.length; // drop oldest
  }

  drainSamples(out) {
    let n = 0;
    while (this.sampleHead !== this.sampleTail && n < out.length) {
      out[n++] = this.sampleBuf[this.sampleHead];
      this.sampleHead = (this.sampleHead + 1) % this.sampleBuf.length;
    }
    return n;
  }

  toState() {
    return {
      pulse1: this.pulse1.toState(), pulse2: this.pulse2.toState(),
      triangle: this.triangle.toState(), noise: this.noise.toState(), dmc: this.dmc.toState(),
      frameMode: this.frameMode, irqInhibit: this.irqInhibit, frameIrq: this.frameIrq,
      frameCycles: this.frameCycles, sampleAccum: this.sampleAccum,
      sampleHead: this.sampleHead, sampleTail: this.sampleTail,
      sampleBuf: Array.from(this.sampleBuf),
    };
  }
  fromState(s) {
    this.pulse1.fromState(s.pulse1); this.pulse2.fromState(s.pulse2);
    this.triangle.fromState(s.triangle); this.noise.fromState(s.noise); this.dmc.fromState(s.dmc);
    this.frameMode = s.frameMode; this.irqInhibit = s.irqInhibit; this.frameIrq = s.frameIrq;
    this.frameCycles = s.frameCycles; this.sampleAccum = s.sampleAccum;
    this.sampleHead = s.sampleHead; this.sampleTail = s.sampleTail;
    this.sampleBuf.set(s.sampleBuf);
  }
}
