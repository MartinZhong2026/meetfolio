import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { keepAlive } from './keepalive.js';
import { AsrError, type AsrConnectOptions, type AsrConnection, type AsrHandlers, type AsrProvider } from './types.js';

/**
 * DashScope Realtime protocol used by qwen3-asr-flash-realtime (OpenAI-realtime-style events).
 *
 *   connect  wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime  (Bearer key)
 *   server → session.created
 *   client → session.update {session:{input_audio_format:'pcm',sample_rate:16000,
 *                            input_audio_transcription:{language,corpus:{text}},turn_detection:{type:'server_vad',...}}}
 *   server → session.updated
 *   client → input_audio_buffer.append {audio: base64 PCM}
 *   server → input_audio_buffer.speech_started / speech_stopped
 *   server → conversation.item.input_audio_transcription.text       {item_id, text, stash}  (partial)
 *   server → conversation.item.input_audio_transcription.completed  {item_id, transcript}   (final)
 *   client → session.finish ; server → session.finished
 *
 * Source: DashScope SDK dashscope/audio/qwen_omni/omni_realtime.py and the official
 * recognize_speech_from_microphone_with_qwen3_asr_flash_realtime sample. Not verified against the live service here.
 * This protocol reports no sentence timestamps, so times are derived from the audio we have sent.
 */
export class QwenRealtimeProvider implements AsrProvider {
  readonly name = 'qwen3-realtime';
  readonly isDemo = false;
  constructor(private opts: { url: string; apiKey: string; model: string; connectTimeoutMs: number; keepAliveMs?: number; wsFactory?: (url: string, headers: Record<string, string>) => WebSocket }) {}
  get model() {
    return this.opts.model;
  }

  connect(c: AsrConnectOptions, handlers: AsrHandlers, signal?: AbortSignal): Promise<AsrConnection> {
    return new Promise((resolve, reject) => {
      const url = `${this.opts.url}${this.opts.url.includes('?') ? '&' : '?'}model=${encodeURIComponent(this.opts.model)}`;
      const headers = { Authorization: `Bearer ${this.opts.apiKey}` };
      const ws = this.opts.wsFactory ? this.opts.wsFactory(url, headers) : new WebSocket(url, { headers, handshakeTimeout: this.opts.connectTimeoutMs });

      let ready = false;
      let finishing = false;
      let closedNotified = false;
      let finishWaiters: Array<(ok: boolean) => void> = [];
      let sentBytes = 0;
      /** audio position (ms) at which the current utterance started, from speech_started. */
      let utteranceStartMs = 0;
      let lastEndMs = 0;
      const eid = () => `evt_${randomUUID()}`;
      const send = (o: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ event_id: eid(), ...o }));

      const notifyClosed = (clean: boolean, error?: AsrError) => {
        if (closedNotified) return;
        closedNotified = true;
        for (const w of finishWaiters) w(clean);
        finishWaiters = [];
        if (!ready) reject(error ?? new AsrError('transient', 'closed_before_start', '连接在启动前关闭'));
        else handlers.onClosed({ clean, error });
      };

      const startTimer = setTimeout(() => {
        if (!ready) {
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
          if (!ready || finishing) return;
          sentBytes += pcm.length;
          send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') });
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
              send({ type: 'session.finish' });
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

      const audioMs = () => sentBytes / 32;

      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        let msg: any;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        switch (msg.type) {
          case 'session.created': {
            const transcription: Record<string, unknown> = {};
            if (c.languageHints[0]) transcription.language = c.languageHints[0];
            const corpus = [c.context, c.terms.length ? `相关术语：${c.terms.join('、')}` : ''].filter(Boolean).join('\n');
            if (corpus) transcription.corpus = { text: corpus.slice(0, 1000) };
            send({
              type: 'session.update',
              session: {
                input_audio_format: 'pcm',
                sample_rate: c.sampleRate,
                input_audio_transcription: transcription,
                turn_detection: { type: 'server_vad', threshold: 0.2, prefix_padding_ms: 300, silence_duration_ms: 800 },
              },
            });
            break;
          }
          case 'session.updated':
            ready = true;
            clearTimeout(startTimer);
            resolve(conn);
            break;
          case 'input_audio_buffer.speech_started':
            utteranceStartMs = typeof msg.audio_start_ms === 'number' ? msg.audio_start_ms : Math.max(lastEndMs, audioMs());
            break;
          case 'input_audio_buffer.speech_stopped':
            lastEndMs = typeof msg.audio_end_ms === 'number' ? msg.audio_end_ms : audioMs();
            break;
          case 'conversation.item.input_audio_transcription.text': {
            const text = `${msg.text ?? ''}${msg.stash ?? ''}`;
            if (text) handlers.onResult({ kind: 'interim', key: String(msg.item_id ?? utteranceStartMs), text, startMs: utteranceStartMs, endMs: null });
            break;
          }
          case 'conversation.item.input_audio_transcription.completed': {
            const text = String(msg.transcript ?? '').trim();
            const end = Math.max(lastEndMs, utteranceStartMs, audioMs());
            if (text) handlers.onResult({ kind: 'final', key: String(msg.item_id ?? `${utteranceStartMs}`), text, startMs: utteranceStartMs, endMs: end });
            lastEndMs = end;
            utteranceStartMs = end;
            break;
          }
          case 'session.finished':
            finishing = true;
            ws.close(1000);
            break;
          case 'error': {
            const code = String(msg.error?.code ?? 'error');
            const message = String(msg.error?.message ?? '语音识别错误');
            const fatal = /invalid_api_key|InvalidApiKey|Unauthorized|AccessDenied|model_not_found|Arrearage/i.test(code + message);
            clearTimeout(startTimer);
            ws.terminate();
            notifyClosed(false, new AsrError(fatal ? 'fatal' : 'transient', code, message));
            break;
          }
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
