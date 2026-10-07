// NEStalgia audio worklet: consumes a ring buffer of Float32 samples written
// by the main thread. Underruns hold the last sample (no hard-zero clicks).
// A one-pole low-pass tames the harsh square-wave harmonics.
class NESOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(16384);
    this.read = 0;
    this.write = 0;
    this.lastSample = 0;
    this.filtered = 0;
    this.port.onmessage = (e) => {
      const chunk = e.data;
      for (let i = 0; i < chunk.length; i++) {
        this.buf[this.write] = chunk[i];
        this.write = (this.write + 1) % this.buf.length;
        if (this.write === this.read) this.read = (this.read + 1) % this.buf.length; // drop oldest
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    let underrun = false;
    for (let i = 0; i < out.length; i++) {
      let s;
      if (this.read === this.write) {
        if (!underrun) this.port.postMessage('underrun'); // once per starved stretch
        underrun = true;
        s = this.lastSample; // hold last sample instead of hard zero
      } else {
        s = this.buf[this.read];
        this.lastSample = s;
        this.read = (this.read + 1) % this.buf.length;
      }
      // One-pole low-pass: y[n] = y[n-1] + alpha * (x[n] - y[n-1])
      // alpha=0.85 gives ~6.5 kHz cutoff at 48 kHz, tames harsh harmonics
      this.filtered += 0.85 * (s - this.filtered);
      out[i] = this.filtered;
    }
    return true;
  }
}
registerProcessor('nes-output', NESOutput);
