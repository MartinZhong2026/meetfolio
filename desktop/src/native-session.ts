import { randomUUID } from 'node:crypto';
import type { AsrProvider, AsrConnection, AsrResult, AsrError } from '../../server/src/asr/types.js';

export interface LocalResult {
  id: string; seq: number; originalText: string; editedText: null; speakerLabel: null;
  startMs: number; endMs: number; isImportant: false; source: 'local'; updatedAt: string;
}
interface Frame { start: number; pcm: Buffer }
interface Callbacks {
  final(result: LocalResult): void;
  partial(result: { key: string; text: string; startMs: number }): void;
  interrupted(reason: string): void;
  recovering(): void;
}
/** A bounded, in-memory replay buffer; only confirmed finals enter the notebook. No cloud fallback. */
export class NativeSession {
  readonly id = randomUUID();
  private connection: AsrConnection | null = null;
  private frames: Frame[] = [];
  private received = 0;
  private confirmed = 0;
  private generation = 0;
  private retries = 0;
  private closed = false;
  private stopping = false;
  private recovery: Promise<void> | null = null;
  private finishing: Promise<void> | null = null;
  private startup = new AbortController();
  constructor(private provider: AsrProvider, private callbacks: Callbacks) {}
  async start(): Promise<void> { await this.open(); }
  private async open(): Promise<void> {
    const generation = ++this.generation;
    const base = this.confirmed;
    const connection = await this.provider.connect({ sampleRate: 16000, languageHints: ['zh', 'en'], terms: [] }, {
      onResult: result => { if (!this.closed && generation === this.generation) this.result(result, base, generation); },
      onClosed: info => {
        if (generation !== this.generation || this.closed) return;
        this.connection = null;
        if (!info.clean && !this.recovery) void this.reconnect(info.error);
      },
    }, this.startup.signal);
    if (this.closed) { connection.close(); return; }
    this.connection = connection;
    // Decode the unconfirmed suffix at its original relative timestamp after native failure.
    for (const frame of this.frames) {
      if (this.closed || !this.connection) break;
      const skip = Math.max(0, base - frame.start);
      if (skip < frame.pcm.length / 2) connection.sendAudio(frame.pcm.subarray(skip * 2));
    }
    if (!this.closed && this.connection !== connection) throw new Error('Replay connection failed');
  }
  private result(result: AsrResult, base: number, generation: number): void {
    const start = Math.max(base, base + Math.round(result.startMs * 16));
    if (result.kind === 'interim') {
      this.callbacks.partial({ key: `${generation}_${result.key}`, text: result.text, startMs: start / 16 });
      return;
    }
    const end = Math.min(this.received, base + Math.round((result.endMs ?? 0) * 16));
    if (end < this.confirmed || end < start) return;
    // Empty endpoint finals still acknowledge silence and bound the replay buffer.
    this.confirmed = Math.max(this.confirmed, end);
    this.frames = this.frames.filter(frame => frame.start + frame.pcm.length / 2 > this.confirmed);
    const first = this.frames[0];
    if (first && first.start < this.confirmed) {
      first.pcm = Buffer.from(first.pcm.subarray((this.confirmed - first.start) * 2));
      first.start = this.confirmed;
    }
    this.callbacks.partial({ key: `${generation}_${result.key}`, text: '', startMs: start / 16 });
    if (result.text.trim()) this.callbacks.final({
      id: `native_${generation}_${result.key}`, seq: 0, originalText: result.text, editedText: null,
      speakerLabel: null, startMs: start / 16, endMs: end / 16,
      isImportant: false, source: 'local', updatedAt: new Date().toISOString(),
    });
  }
  send(pcm: Uint8Array): void {
    if (this.closed || this.stopping) return;
    const frame = Buffer.from(pcm);
    if (!frame.length || frame.length % 2 || frame.length > 32000) { this.interrupt('无效音频帧，转录已停止。'); return; }
    this.frames.push({ start: this.received, pcm: frame });
    this.received += frame.length / 2;
    if (this.received - this.confirmed > 16000 * 60) {
      this.interrupt('未确认的音频已超过一分钟。已停止麦克风；请核对末尾内容后继续。'); return;
    }
    try { this.connection?.sendAudio(frame); }
    catch (error) { void this.reconnect(error as AsrError); }
  }
  private reconnect(error?: AsrError): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.recovery) return this.recovery;
    this.connection = null;
    if (error?.kind === 'fatal' || ++this.retries > 3) {
      this.interrupt('本地引擎无法恢复。已保存文字保留；未确认的音频可能缺失，请核对后继续。');
      return Promise.resolve();
    }
    this.callbacks.recovering();
    this.recovery = this.open().catch(() => {
      this.interrupt('本地引擎重新加载失败。已保存文字保留，请检查模型后继续。');
    }).finally(() => { this.recovery = null; });
    return this.recovery;
  }
  private interrupt(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.startup.abort();
    this.connection?.close(); this.connection = null; this.frames = [];
    this.callbacks.interrupted(reason);
  }
  stop(): Promise<void> {
    if (this.finishing) return this.finishing;
    this.stopping = true;
    this.finishing = (async () => {
      await this.recovery;
      if (this.closed) throw new Error('本地转录已中断，请核对末尾内容');
      let connection = this.connection;
      let ok = connection ? await connection.finish(15000) : false;
      if (!ok && !this.closed) {
        await this.reconnect(); await this.recovery;
        connection = this.connection;
        ok = connection ? await connection.finish(15000) : false;
      }
      this.closed = true; this.frames = []; this.startup.abort();
      this.connection?.close(); this.connection = null;
      if (!ok) throw new Error('末尾音频未确认完成，请核对转录并补记缺失内容');
    })();
    return this.finishing;
  }
  abort(reason: string): void { this.interrupt(reason); }
}
