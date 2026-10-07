// Emulation player: rAF-paced frame loop (60.0988 Hz NTSC), input handling,
// save states, rewind ring, screenshots.
import { Console } from '/core/console.mjs';
import { SCREEN_W, SCREEN_H } from '/core/ppu.mjs';

export const FRAME_MS = 1000 / 60.0988;

// console-side controller byte: bit0=A bit1=B bit2=Select bit3=Start
// bit4=Up bit5=Down bit6=Left bit7=Right
export const BTN = { A: 1, B: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };

const KEYMAP = {
  KeyX: BTN.A, KeyJ: BTN.A,
  KeyZ: BTN.B, KeyK: BTN.B,
  ShiftLeft: BTN.SELECT, ShiftRight: BTN.SELECT,
  Enter: BTN.START,
  ArrowUp: BTN.UP, ArrowDown: BTN.DOWN, ArrowLeft: BTN.LEFT, ArrowRight: BTN.RIGHT,
};

export class Player {
  constructor(canvas, audio) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.image = this.ctx2d.createImageData(SCREEN_W, SCREEN_H);
    // fill alpha once; core writes ABGR little-endian directly
    const d = this.image.data;
    for (let i = 3; i < d.length; i += 4) d[i] = 0xFF;
    this.pxView = new Uint32Array(d.buffer); // cached view — render() runs 60x/s
    this.audio = audio;
    this.console = null;
    this.running = false;
    this.raf = 0;
    this.acc = 0;
    this.last = 0;
    this.turbo = false;
    this.onFrame = null;
    this.keys = 0;      // combined keyboard|gamepad bits, fed to the console
    this.kbKeys = 0;    // keyboard-only bits
    this.padBits = 0;   // gamepad-only bits (recomputed every frame)
    this.rewindRing = [];
    this.rewindTimer = 0;
    this.frameCount = 0;
    this.fps = 0;
    this._fpsFrames = 0;
    this._fpsT = 0;
    this.onSaveSRAM = null;
    this.onBatteryFlush = null;
    window.addEventListener('keydown', (e) => {
      if (this.handleSpecial(e)) return;
      const b = KEYMAP[e.code];
      if (b !== undefined) { this.kbKeys |= b; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      if (this.handleSpecial(e)) return;
      const b = KEYMAP[e.code];
      if (b !== undefined) { this.kbKeys &= ~b; e.preventDefault(); }
    });
    // hidden tabs freeze rAF; pause so audio doesn't underrun forever
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.running) this.pause();
    });
  }

  handleSpecial(e) {
    if (e.code === 'Backspace' && this.console) {
      // hold to rewind
      if (e.type === 'keydown' && !e.repeat) this.startRewind();
      if (e.type === 'keyup') this.stopRewind();
      e.preventDefault();
      return true;
    }
    return false;
  }

  loadRom(bytes, { sram = null, onSaveSRAM = null } = {}) {
    this.pause();
    this.console = new Console(bytes, {
      onSave: (data) => { if (this.onBatteryFlush) this.onBatteryFlush(data); },
    });
    if (sram && this.console.cart.battery) this.console.cart.loadSave(sram);
    this.onSaveSRAM = onSaveSRAM;
    this.rewindRing = [];
    this.frameCount = 0;
    this.render();
  }

  play() {
    if (!this.console || this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame((t) => this.tick(t));
    this.audio.resume();
    this.onPauseUi?.(true);
  }

  pause() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.audio.suspend();
    this.onPauseUi?.(false);
  }

  reset() {
    if (this.console) { this.console.reset(); this.render(); }
  }

  tick(t) {
    if (!this.running) return;
    this.raf = requestAnimationFrame((tt) => this.tick(tt));
    const dt = Math.min(t - this.last, 100);
    this.last = t;
    this.acc += dt;
    let frames = 0;
    const target = this.turbo ? 4 : 1;
    while (this.acc >= FRAME_MS && frames < target) {
      this.stepFrame();
      this.acc -= FRAME_MS;
      frames++;
    }
    if (frames === 0 && !this.turbo) return; // render at most 60fps
    this.render();
    this.pushAudio();
    this._fpsFrames += frames;
    if (t - this._fpsT > 500) {
      this.fps = Math.round(this._fpsFrames * 1000 / (t - this._fpsT));
      this._fpsFrames = 0;
      this._fpsT = t;
    }
  }

  stepFrame() {
    if (!this.console) return;
    this.pollGamepad();
    this.console.controllers[0] = this.keys;
    this.console.runFrame();
    this.frameCount++;
    if (this.rewinding) {
      // consume the ring while held
      const prev = this.rewindRing.pop();
      if (prev) this.console.fromState(prev);
    } else if (++this.rewindTimer >= 10) {
      this.rewindTimer = 0;
      this.rewindRing.push(this.console.toState());
      if (this.rewindRing.length > 180) this.rewindRing.shift();
    }
    if (this.onFrame) this.onFrame(this.console);
  }

  startRewind() { this.rewinding = true; }
  stopRewind() { this.rewinding = false; }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.padBits = 0; // recompute from scratch: a disconnected pad must release its bits
    for (const pad of pads) {
      if (!pad) continue;
      const b = pad.buttons;
      const map = (i) => (b[i] && (b[i].pressed || b[i].value > 0.5)) ? 1 : 0;
      let v = 0;
      v |= map(0) ? BTN.A : 0;      // B button (physical) -> A
      v |= map(1) ? BTN.A : 0;
      v |= map(2) ? BTN.B : 0;
      v |= map(3) ? BTN.B : 0;
      v |= map(8) ? BTN.SELECT : 0;
      v |= map(9) ? BTN.START : 0;
      v |= map(12) ? BTN.UP : 0;
      v |= map(13) ? BTN.DOWN : 0;
      v |= map(14) ? BTN.LEFT : 0;
      v |= map(15) ? BTN.RIGHT : 0;
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      if (ax < -0.4) v |= BTN.LEFT;
      if (ax > 0.4) v |= BTN.RIGHT;
      if (ay < -0.4) v |= BTN.UP;
      if (ay > 0.4) v |= BTN.DOWN;
      this.padBits |= v;
    }
    // recompute the combined mask so gamepad release actually clears bits
    this.keys = this.kbKeys | this.padBits;
  }

  pushAudio() {
    if (!this.console || this.turbo || this.rewinding) return;
    const buf = new Float32Array(1024);
    let n;
    while ((n = this.console.apu.drainSamples(buf)) > 0) {
      this.audio.push(buf.slice(0, n));
      if (n < buf.length) break;
    }
  }

  render() {
    if (!this.console) return;
    const fb = this.console.ppu.framebuffer;
    this.pxView.set(fb);
    this.ctx2d.putImageData(this.image, 0, 0);
  }

  saveState() {
    if (!this.console) return null;
    return this.console.toState();
  }
  loadState(s) {
    if (!this.console || !s) return;
    this.console.fromState(s);
    this.render();
  }

  screenshot() {
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
  }

  // ---- WebM recording (video + audio) ----------------------------------------
  isRecording() { return !!this.recorder && this.recorder.state === 'recording'; }

  startRecording() {
    if (this.isRecording()) return;
    const vstream = this.canvas.captureStream(60);
    const tracks = [...vstream.getVideoTracks()];
    if (this.audio.ctx && this.audio.gain) {
      if (!this.audio.recDest) {
        this.audio.recDest = this.audio.ctx.createMediaStreamDestination();
        this.audio.gain.connect(this.audio.recDest);
      }
      tracks.push(...this.audio.recDest.stream.getAudioTracks());
    }
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';
    this.recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    this.recChunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.recChunks.push(e.data); };
    this.recorder.start(1000);
  }

  stopRecording() {
    if (!this.isRecording()) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        const blob = new Blob(this.recChunks, { type: 'video/webm' });
        this.recorder = null;
        this.recChunks = [];
        resolve(blob);
      };
      this.recorder.stop();
    });
  }
}
