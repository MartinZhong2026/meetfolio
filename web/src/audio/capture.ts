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

  async start(onFrame: FrameHandler, onEnded: () => void) {
    if (!window.isSecureContext) throw new MicPermissionError('insecure', '麦克风需要在 HTTPS 安全连接下使用');
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') throw new MicPermissionError('unsupported', '当前浏览器不支持麦克风转录，请使用最新版 Chrome、Edge 或 Safari');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicPermissionError('denied', '没有麦克风权限。请点击地址栏的锁形图标，允许使用麦克风后重试');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicPermissionError('no_device', '没有找到可用的麦克风');
      throw new MicPermissionError('busy', '无法打开麦克风，可能被其他程序占用');
    }
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    await this.ctx.audioWorklet.addModule('/pcm-worklet.js');
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-downsampler', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    this.node.port.onmessage = (ev: MessageEvent<{ pcm?: ArrayBuffer; rms: number; flushed?: boolean }>) => {
      if (ev.data.pcm) onFrame(new Int16Array(ev.data.pcm), ev.data.rms);
      if (ev.data.flushed) this.flushed?.();
    };
    const sink = this.ctx.createGain();
    sink.gain.value = 0; // keep the graph running without playing the microphone back
    this.source.connect(this.node).connect(sink).connect(this.ctx.destination);
    for (const t of this.stream.getAudioTracks()) t.addEventListener('ended', () => onEnded());
    this.ctx.addEventListener('statechange', () => {
      if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {});
    });
  }

  async stop() {
    this.source?.disconnect();
    if (this.node && this.ctx?.state === 'running') {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 500);
        this.flushed = () => { clearTimeout(timeout); resolve(); };
        this.node!.port.postMessage({ type: 'flush' });
      });
      this.flushed = null;
    }
    this.node?.port.close();
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.node = null;
    this.source = null;
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
