// AudioWorklet: converts the mixed capture graph to 16 kHz mono PCM16 in 100 ms frames.
// Runs on the audio thread and only posts transferable ArrayBuffers to the main thread.
//
// The preferred graph runs the AudioContext at 16 kHz, so Chromium's own resampler feeds this
// node and the ratio is exactly 1 (a plain float -> int16 conversion). When a device forces a
// different context rate, every output sample is taken from a windowed-sinc low-pass (cutoff
// 7.2 kHz) before decimation. Plain linear interpolation would fold 8-24 kHz noise (fans, hiss,
// keyboards) into the speech band and measurably hurt recognition.
const OUT_RATE = 16000;
const FRAME = 1600; // 100 ms at 16 kHz
const TAPS = 63;

function lowpass(inRate) {
  const cutoff = 7200 / inRate; // normalised to the input rate
  const h = new Float32Array(TAPS);
  const mid = (TAPS - 1) / 2;
  let sum = 0;
  for (let n = 0; n < TAPS; n++) {
    const x = n - mid;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const blackman = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (TAPS - 1));
    h[n] = sinc * blackman;
    sum += h[n];
  }
  for (let n = 0; n < TAPS; n++) h[n] /= sum; // unity gain at DC
  return h;
}

class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / OUT_RATE; // input samples per output sample
    this.passthrough = Math.abs(this.ratio - 1) < 1e-9;
    this.h = this.passthrough ? null : lowpass(sampleRate);
    // Ring of recent input samples, large enough for the filter plus one render quantum of lookahead.
    this.hist = new Float32Array(8192);
    this.histMask = this.hist.length - 1;
    this.written = 0; // total input samples written to the ring
    this.pos = TAPS; // next output position, in absolute input-sample index space
    this.out = new Int16Array(FRAME);
    this.outLen = 0;
    this.energy = 0;
    this.peak = 0;
    this.clipped = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'flush') return;
      this.stopped = true;
      if (this.outLen) this.emit(this.out.slice(0, this.outLen));
      this.port.postMessage({ flushed: true });
    };
  }
  filtered(index) {
    // Causal FIR evaluated at one absolute input index.
    const h = this.h;
    const hist = this.hist;
    const mask = this.histMask;
    let acc = 0;
    for (let k = 0; k < TAPS; k++) acc += h[k] * hist[(index - k) & mask];
    return acc;
  }
  push(value) {
    const c = value > 1 ? 1 : value < -1 ? -1 : value;
    if (c === 1 || c === -1) this.clipped++;
    const a = c < 0 ? -c : c;
    if (a > this.peak) this.peak = a;
    this.energy += c * c;
    this.out[this.outLen++] = c < 0 ? c * 0x8000 : c * 0x7fff;
    if (this.outLen === FRAME) {
      this.emit(this.out);
      this.out = new Int16Array(FRAME);
      this.outLen = 0;
    }
  }
  emit(frame) {
    const rms = Math.sqrt(this.energy / Math.max(1, frame.length));
    const buffer = frame.buffer.byteLength === frame.length * 2 ? frame.buffer : frame.slice().buffer;
    this.port.postMessage({ pcm: buffer, rms, peak: this.peak, clipped: this.clipped }, [buffer]);
    this.energy = 0;
    this.peak = 0;
    this.clipped = 0;
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return true;
    // Down-mix every connected channel; the graph is normally mono already.
    const channels = input.length;
    if (this.passthrough) {
      for (let i = 0; i < ch.length; i++) {
        let v = ch[i];
        for (let c = 1; c < channels; c++) v += input[c][i];
        this.push(channels > 1 ? v / channels : v);
      }
      return true;
    }
    for (let i = 0; i < ch.length; i++) {
      let v = ch[i];
      for (let c = 1; c < channels; c++) v += input[c][i];
      this.hist[this.written & this.histMask] = channels > 1 ? v / channels : v;
      this.written++;
    }
    // Emit every output sample whose two neighbouring input indices are already filtered-ready.
    while (this.pos + 1 < this.written) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = this.filtered(i);
      const b = this.filtered(i + 1);
      this.push(a + (b - a) * frac);
      this.pos += this.ratio;
    }
    return true;
  }
}
registerProcessor('pcm-downsampler', PcmDownsampler);
