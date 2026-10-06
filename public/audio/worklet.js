// NEStalgia audio worklet: consumes a ring buffer of Float32 samples written
// by the main thread. Underruns produce silence rather than crackle.
class NESOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(16384);
    this.read = 0;
    this.write = 0;
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
      if (this.read === this.write) { underrun = true; out[i] = 0; continue; }
      out[i] = this.buf[this.read];
      this.read = (this.read + 1) % this.buf.length;
    }
    if (underrun) this.port.postMessage('underrun');
    return true;
  }
}
registerProcessor('nes-output', NESOutput);
