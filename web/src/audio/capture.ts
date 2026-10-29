/** Microphone capture that yields 16 kHz mono PCM16 frames of 100 ms, independent of the device sample rate. */

export type FrameHandler = (pcm: Int16Array, rms: number) => void;

export interface Capture {
  start(onFrame: FrameHandler, onEnded: () => void): Promise<void>;
  stop(): Promise<void>;
}

export class MicPermissionError extends Error {
  constructor(
    public kind: 'denied' | 'no_device' | 'insecure' | 'unsupported' | 'busy',
    message: string,
  ) {
    super(message);
  }
}

export class MicCapture implements Capture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private flushed: (() => void) | null = null;
  private starting = false;
  private stopping: Promise<void> | null = null;
  private generation = 0;
  private ended: (() => void) | null = null;

  async start(onFrame: FrameHandler, onEnded: () => void) {
    if (this.starting || this.stream || this.stopping) throw new Error('Audio capture is already starting or active');
    if (!window.isSecureContext) throw new MicPermissionError('insecure', '麦克风需要在 HTTPS 安全连接下使用');
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') throw new MicPermissionError('unsupported', '当前浏览器不支持麦克风转录，请使用最新版 Chrome、Edge 或 Safari');
    this.starting = true;
    const generation = ++this.generation;
    const current = () => { if (generation !== this.generation) throw new Error('Audio capture cancelled'); };
    try {
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      }); } catch (e) {
        const name = (e as DOMException).name;
        if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicPermissionError('denied', '没有麦克风权限。请点击地址栏的锁形图标，允许使用麦克风后重试');
        if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicPermissionError('no_device', '没有找到可用的麦克风');
        throw new MicPermissionError('busy', '无法打开麦克风，可能被其他程序占用');
      }
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); current(); }
      this.stream = stream;
      // Let Chromium perform the anti-aliased device-rate conversion whenever supported.
      try { this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 16000 }); }
      catch { this.ctx = new AudioContext({ latencyHint: 'interactive' }); }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      current();
      await this.ctx.audioWorklet.addModule('/pcm-worklet.js');
      current();
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, 'pcm-downsampler', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      this.node.port.onmessage = (ev: MessageEvent<{ pcm?: ArrayBuffer; rms: number; flushed?: boolean }>) => {
        if (ev.data.pcm) {
          if (ev.data.pcm.byteLength > 0 && ev.data.pcm.byteLength <= 3200 && ev.data.pcm.byteLength % 2 === 0 && Number.isFinite(ev.data.rms)) onFrame(new Int16Array(ev.data.pcm), ev.data.rms);
          else this.ended?.();
        }
        if (ev.data.flushed) this.flushed?.();
      };
      const sink = this.ctx.createGain();
      sink.gain.value = 0; // keep the graph running without playing the microphone back
      this.source.connect(this.node).connect(sink).connect(this.ctx.destination);
      let notified = false;
      this.ended = () => { if (!notified && generation === this.generation) { notified = true; onEnded(); } };
      for (const t of this.stream.getAudioTracks()) t.addEventListener('ended', this.ended);
      this.node.onprocessorerror = this.ended;
      this.ctx.addEventListener('statechange', () => {
        if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => this.ended?.());
        if (this.ctx?.state === 'closed') this.ended?.();
      });
    } catch (error) { await this.stop().catch(() => {}); throw error; }
    finally { this.starting = false; }
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.generation++;
    this.stopping = this.release().finally(() => { this.stopping = null; });
    return this.stopping;
  }
  private async release() {
    let failure: unknown;
    try {
      this.source?.disconnect();
      if (this.node && this.ctx?.state === 'running') await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Audio capture flush timed out')), 500);
        this.flushed = () => { clearTimeout(timeout); resolve(); };
        try { this.node!.port.postMessage({ type: 'flush' }); }
        catch (error) { clearTimeout(timeout); reject(error); }
      });
    } catch (error) { failure = error; }
    finally {
      this.flushed = null;
      for (const release of [() => this.node?.port.close(), () => this.source?.disconnect(), () => this.node?.disconnect(),
        () => this.stream?.getTracks().forEach(t => { if (this.ended) t.removeEventListener('ended', this.ended); t.stop(); })]) {
        try { release(); } catch (error) { failure ??= error; }
      }
      try { await this.ctx?.close(); } catch (error) { failure ??= error; }
      this.stream = null;
      this.ctx = null;
      this.node = null;
      this.source = null;
      this.ended = null;
    }
    if (failure) throw failure;
  }
}

/**
 * Demo capture: emits silent frames at real-time pace. Demo mode never touches the microphone and never
 * produces real audio, so it cannot be mistaken for (or billed as) genuine transcription.
 */
export class SyntheticCapture implements Capture {
  private timer: ReturnType<typeof setInterval> | null = null;
  async start(onFrame: FrameHandler) {
    let next = performance.now();
    this.timer = setInterval(() => {
      // Catch up if the tab was throttled, so audio time keeps matching wall-clock time.
      let n = 0;
      while (performance.now() >= next && n++ < 50) {
        onFrame(new Int16Array(1600), 0);
        next += 100;
      }
    }, 50);
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
