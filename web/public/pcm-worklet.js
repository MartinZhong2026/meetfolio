// AudioWorklet: converts microphone audio of any sample rate to 16 kHz mono PCM16 in 100 ms frames.
// Runs on the audio thread; only posts transferable ArrayBuffers to the main thread.
class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000; // input samples per output sample
    this.pos = 0; // fractional read position within the pending input
    this.pending = [];
    this.pendingLen = 0;
    this.out = new Int16Array(1600); // 100 ms
    this.outLen = 0;
    this.level = 0;
    this.levelCount = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'flush') return;
      this.stopped = true;
      if (this.outLen) {
        const tail = this.out.slice(0, this.outLen);
        this.port.postMessage({ pcm: tail.buffer, rms: Math.sqrt(this.level / Math.max(1, this.levelCount)) }, [tail.buffer]);
        this.outLen = 0;
      }
      this.port.postMessage({ flushed: true });
    };
  }
  process(inputs) {
    if (this.stopped) return false;
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Keep a contiguous float buffer: previous leftover + new block.
    let buf;
    if (this.pendingLen) {
      buf = new Float32Array(this.pendingLen + ch.length);
      let o = 0;
      for (const p of this.pending) { buf.set(p, o); o += p.length; }
      buf.set(ch, o);
    } else {
      buf = ch;
    }
    let pos = this.pos;
    while (pos + 1 < buf.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const s = buf[i] * (1 - frac) + buf[i + 1] * frac; // linear interpolation
      const c = Math.max(-1, Math.min(1, s));
      this.out[this.outLen++] = c < 0 ? c * 0x8000 : c * 0x7fff;
      this.level += s * s;
      this.levelCount++;
      if (this.outLen === this.out.length) {
        const rms = Math.sqrt(this.level / Math.max(1, this.levelCount));
        this.port.postMessage({ pcm: this.out.buffer, rms }, [this.out.buffer]);
        this.out = new Int16Array(1600);
        this.outLen = 0;
        this.level = 0;
        this.levelCount = 0;
      }
      pos += this.ratio;
    }
    const consumed = Math.floor(pos);
    this.pos = pos - consumed;
    const rest = buf.subarray(Math.min(consumed, buf.length));
    this.pending = rest.length ? [new Float32Array(rest)] : [];
    this.pendingLen = rest.length;
    return true;
  }
}
registerProcessor('pcm-downsampler', PcmDownsampler);
