// AudioWorklet plumbing: ring buffer on the audio thread, fed by the main
// thread after each emulated frame. Autoplay-safe: start() must be called
// from a user gesture.
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.gain = null;
    this.enabled = true;
    this.underruns = 0;
  }

  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule('/audio/worklet.js');
    this.node = new AudioWorkletNode(this.ctx, 'nes-output', { outputChannelCount: [1] });
    this.node.port.onmessage = (e) => { if (e.data === 'underrun') this.underruns++; };
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.5;
    this.node.connect(this.gain);
    this.gain.connect(this.ctx.destination);
  }

  push(samples) {
    if (this.node && this.enabled && this.ctx && this.ctx.state === 'running') {
      this.node.port.postMessage(samples);
    }
  }

  setVolume(v) { if (this.gain) this.gain.gain.value = v; }
  setEnabled(on) { this.enabled = on; }
  async suspend() { if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend(); }
  async resume() { if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume(); }
}
