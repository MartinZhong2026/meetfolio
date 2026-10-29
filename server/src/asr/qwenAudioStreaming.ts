import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { keepAlive } from './keepalive.js';
import { AsrError, type AsrConnectOptions, type AsrConnection, type AsrHandlers, type AsrProvider } from './types.js';

/**
 * DashScope "inference" WebSocket protocol used by qwen-audio-*-asr-flash-streaming and Fun-ASR.
 *
 *   client → {header:{action:'run-task',task_id,streaming:'duplex'},payload:{task_group:'audio',task:'asr',
 *             function:'recognition',model,parameters:{format,sample_rate,...},input:{}}}
 *   server → {header:{event:'task-started'}}
 *   client → binary PCM frames
 *   server → {header:{event:'result-generated'},payload:{output:{sentence:{begin_time,end_time,text,...}}}}
 *            (end_time is null/absent for partial results and set when the sentence is final)
 *   client → {header:{action:'finish-task',task_id,streaming:'duplex'},payload:{input:{}}}
 *   server → {header:{event:'task-finished'}}
 *
 * Source: Alibaba's DashScope SDK (dashscope/api_entities/websocket_request.py, audio/asr/recognition.py)
 * and the official alibabacloud-bailian-speech-demo samples for qwen-audio-3.0-asr-flash-streaming.
 * This adapter has NOT been exercised against the live service from this repository's CI; see docs/asr-integration.md.
 */
/**
 * Optional request parameters each streaming model is known to accept. Only parameters with documentary evidence are
 * sent, so an unverified model never fails a session because of a parameter it does not understand.
 *
 * - qwen-audio-3.0-asr-flash-streaming: instant `vocabulary` and prompt `context` are shown in Alibaba's official samples
 *   (alibabacloud-bailian-speech-demo: …-streaming-with-vocabulary / …-streaming-with-context).
 * - qwen-audio-3.1-asr-flash-streaming: Alibaba's client-events reference shows the same run-task protocol
 *   (task_group audio / task asr / function recognition, binary PCM). Instant vocabulary is reported to carry over
 *   from 3.0; prompt `context` is not confirmed, so it is withheld until verified live (docs/asr-integration.md).
 *   3.1-only options (e.g. dialect retention) are left at their defaults: dialect speech → standard Mandarin text.
 * - Any other id: core parameters only (format, sample_rate, language_hints).
 */
export interface StreamingModelProfile {
  vocabulary: boolean;
  context: boolean;
}
const PROFILES: Record<string, StreamingModelProfile> = {
  'qwen-audio-3.0-asr-flash-streaming': { vocabulary: true, context: true },
  'qwen-audio-3.1-asr-flash-streaming': { vocabulary: true, context: false },
};
export const KNOWN_STREAMING_MODELS = Object.keys(PROFILES);
export function streamingModelProfile(model: string): StreamingModelProfile {
  return PROFILES[model] ?? { vocabulary: false, context: false };
}

/**
 * Instant (per-request) hot-word list. Alibaba's samples pass it as an object `{ "词": weight }`
 * (weight 1–5, 4 recommended; 50 = "super hotword"). The `[{text, weight}]` list form is only for *creating* a
 * precompiled vocabulary. Hot-words must be real words: ≤ 15 characters when non-ASCII, ≤ 7 space-separated parts otherwise.
 */
export function instantVocabulary(terms: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of terms) {
    const t = raw.trim();
    if (!t) continue;
    const ascii = /^[\x00-\x7F]*$/.test(t);
    if (ascii ? t.split(/\s+/).length > 7 : [...t].length > 15) continue;
    out[t] = 4;
  }
  return out;
}

export class QwenAudioStreamingProvider implements AsrProvider {
  readonly name = 'qwen-audio-streaming';
  readonly isDemo = false;
  constructor(
    private opts: { url: string; apiKey: string; model: string; connectTimeoutMs: number; keepAliveMs?: number; wsFactory?: (url: string, headers: Record<string, string>) => WebSocket },
  ) {}
  get model() {
    return this.opts.model;
  }

  connect(c: AsrConnectOptions, handlers: AsrHandlers, signal?: AbortSignal): Promise<AsrConnection> {
    return new Promise((resolve, reject) => {
      const taskId = randomUUID().replace(/-/g, '');
      const headers = { Authorization: `Bearer ${this.opts.apiKey}` };
      const ws = this.opts.wsFactory ? this.opts.wsFactory(this.opts.url, headers) : new WebSocket(this.opts.url, { headers, handshakeTimeout: this.opts.connectTimeoutMs });

      let started = false;
      let finishing = false;
      let closedNotified = false;
      let finishWaiters: Array<(ok: boolean) => void> = [];

      const notifyClosed = (clean: boolean, error?: AsrError) => {
        if (closedNotified) return;
        closedNotified = true;
        for (const w of finishWaiters) w(clean);
        finishWaiters = [];
        if (!started) reject(error ?? new AsrError('transient', 'closed_before_start', '连接在启动前关闭'));
        else handlers.onClosed({ clean, error });
      };

      const startTimer = setTimeout(() => {
        if (!started) {
          ws.terminate();
          notifyClosed(false, new AsrError('transient', 'connect_timeout', '连接语音服务超时'));
        }
      }, this.opts.connectTimeoutMs);

      signal?.addEventListener('abort', () => {
        ws.terminate();
        notifyClosed(false, new AsrError('transient', 'aborted', '已取消'));
      });

      const conn: AsrConnection = {
        sendAudio(pcm) {
          if (ws.readyState === WebSocket.OPEN && started && !finishing) ws.send(pcm, { binary: true });
        },
        finish(timeoutMs = 8000) {
          if (closedNotified) return Promise.resolve(false);
          return new Promise<boolean>((res) => {
            const t = setTimeout(() => {
              ws.terminate();
              notifyClosed(false, new AsrError('transient', 'finish_timeout', '等待语音服务收尾超时'));
              res(false);
            }, timeoutMs);
            finishWaiters.push((ok) => {
              clearTimeout(t);
              res(ok);
            });
            if (!finishing && ws.readyState === WebSocket.OPEN) {
              finishing = true;
              ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' }, payload: { input: {} } }));
            } else if (ws.readyState !== WebSocket.OPEN) {
              clearTimeout(t);
              notifyClosed(false);
              res(false);
            }
          });
        },
        close() {
          finishing = true;
          ws.terminate();
          notifyClosed(true);
        },
      };

      ws.on('open', () => {
        keepAlive(ws, this.opts.keepAliveMs ?? 20_000);
        const parameters: Record<string, unknown> = {
          format: 'pcm',
          sample_rate: c.sampleRate,
        };
        const profile = streamingModelProfile(this.opts.model);
        if (c.languageHints.length) parameters.language_hints = c.languageHints;
        const vocabulary = instantVocabulary(c.terms);
        if (profile.vocabulary && Object.keys(vocabulary).length) parameters.vocabulary = vocabulary;
        const input: Record<string, unknown> = {};
        if (profile.context && c.context) input.context = [{ role: 'user', content: [{ type: 'input_text', text: c.context.slice(0, 400) }] }];
        ws.send(
          JSON.stringify({
            header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
            payload: { task_group: 'audio', task: 'asr', function: 'recognition', model: this.opts.model, parameters, input },
          }),
        );
      });

      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        let msg: any;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        const event: string | undefined = msg?.header?.event;
        if (event === 'task-started') {
          started = true;
          clearTimeout(startTimer);
          resolve(conn);
        } else if (event === 'result-generated') {
          const s = msg?.payload?.output?.sentence;
          if (!s || s.heartbeat === true || typeof s.text !== 'string') return;
          const isFinal = s.end_time !== null && s.end_time !== undefined;
          const begin = Number(s.begin_time ?? 0);
          handlers.onResult({
            kind: isFinal ? 'final' : 'interim',
            key: String(begin),
            text: s.text,
            startMs: begin,
            endMs: isFinal ? Number(s.end_time) : null,
          });
        } else if (event === 'task-finished') {
          finishing = true;
          ws.close(1000);
        } else if (event === 'task-failed') {
          const code = String(msg?.header?.error_code ?? 'task_failed');
          const message = String(msg?.header?.error_message ?? '语音识别任务失败');
          const fatal = /InvalidApiKey|Unauthorized|AccessDenied|ModelNotFound|InvalidParameter|Arrearage|AllocationQuota/i.test(code);
          const err = new AsrError(fatal ? 'fatal' : 'transient', code, message);
          clearTimeout(startTimer);
          ws.terminate();
          notifyClosed(false, err);
        }
      });

      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(startTimer);
        const fatal = res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 404;
        notifyClosed(false, new AsrError(fatal ? 'fatal' : 'transient', `http_${res.statusCode}`, `语音服务握手失败 (${res.statusCode})`));
      });
      ws.on('error', (e) => {
        clearTimeout(startTimer);
        notifyClosed(false, new AsrError('transient', 'ws_error', (e as Error).message));
      });
      ws.on('close', (code) => {
        clearTimeout(startTimer);
        notifyClosed(finishing && (code === 1000 || code === 1005), finishing && code === 1000 ? undefined : new AsrError('transient', `ws_close_${code}`, '语音服务连接已断开'));
      });
    });
  }
}
