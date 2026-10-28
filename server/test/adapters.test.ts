import { afterEach, describe, expect, it } from 'vitest';
import { QwenAudioStreamingProvider } from '../src/asr/qwenAudioStreaming.js';
import { QwenRealtimeProvider } from '../src/asr/qwenRealtime.js';
import { AsrError, type AsrResult } from '../src/asr/types.js';
import { inferenceHandler, realtimeHandler, startMock, type MockServer } from './mock-dashscope.js';

const opts = { languageHints: ['zh', 'en'], terms: ['养老护理', '认知障碍'], context: '养老护理员访谈', sampleRate: 16000 };
let server: MockServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});
const until = async (fn: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('qwen-audio streaming adapter (DashScope inference protocol, mock server)', () => {
  it('sends run-task with the documented envelope, authenticates with Bearer, streams binary PCM and maps results', async () => {
    server = await startMock(
      inferenceHandler({
        sentences: (ms) => [
          ...(ms >= 500 ? [{ __n: 1, begin_time: 100, end_time: null, text: '你好' }] : []),
          ...(ms >= 1000 ? [{ __n: 2, begin_time: 100, end_time: 900, text: '你好，请问养老护理。' }] : []),
          ...(ms >= 1200 ? [{ __n: 3, heartbeat: true, begin_time: 0, end_time: null, text: '' }] : []),
        ],
      }),
    );
    const results: AsrResult[] = [];
    const closed: unknown[] = [];
    const p = new QwenAudioStreamingProvider({ url: `${server.url}/api-ws/v1/inference`, apiKey: 'sk-test', model: 'qwen-audio-3.0-asr-flash-streaming', connectTimeoutMs: 2000 });
    const conn = await p.connect(opts, { onResult: (r) => results.push(r), onClosed: (i) => closed.push(i) });

    const run = server.received[0]!.messages[0];
    expect(server.received[0]!.headers.authorization).toBe('Bearer sk-test');
    expect(run.header.action).toBe('run-task');
    expect(run.header.streaming).toBe('duplex');
    expect(run.header.task_id).toMatch(/^[0-9a-f]{32}$/);
    expect(run.payload).toMatchObject({ task_group: 'audio', task: 'asr', function: 'recognition', model: 'qwen-audio-3.0-asr-flash-streaming' });
    expect(run.payload.parameters).toMatchObject({ format: 'pcm', sample_rate: 16000, language_hints: ['zh', 'en'] });
    // Instant hot-words: an object map, as in Alibaba's samples (not the [{text, weight}] list used to *create* a vocabulary).
    expect(run.payload.parameters.vocabulary).toEqual({ 养老护理: 4, 认知障碍: 4 });
    expect(run.payload.input.context[0].content[0]).toEqual({ type: 'input_text', text: '养老护理员访谈' });

    conn.sendAudio(Buffer.alloc(16000)); // 500 ms
    conn.sendAudio(Buffer.alloc(16000)); // 1000 ms
    conn.sendAudio(Buffer.alloc(6400)); //  1200 ms
    await until(() => results.length >= 2);
    expect(results[0]).toMatchObject({ kind: 'interim', text: '你好', startMs: 100, endMs: null });
    expect(results[1]).toMatchObject({ kind: 'final', text: '你好，请问养老护理。', startMs: 100, endMs: 900 });
    expect(results.some((r) => r.text === '')).toBe(false); // heartbeats are not results
    expect(server.received[0]!.binaryBytes).toBe(38400);

    expect(await conn.finish()).toBe(true);
    expect(server.received[0]!.messages.at(-1).header.action).toBe('finish-task');
    await until(() => closed.length === 1);
    expect(closed[0]).toMatchObject({ clean: true });
  });

  it('qwen-audio-3.1-asr-flash-streaming: same run-task protocol, only parameters with documentary evidence', async () => {
    server = await startMock(inferenceHandler({ sentences: (ms) => (ms >= 500 ? [{ __n: 1, begin_time: 0, end_time: 480, text: '你好' }] : []) }));
    const results: AsrResult[] = [];
    const p = new QwenAudioStreamingProvider({ url: server.url, apiKey: 'sk-test', model: 'qwen-audio-3.1-asr-flash-streaming', connectTimeoutMs: 2000 });
    const conn = await p.connect(opts, { onResult: (r) => results.push(r), onClosed() {} });
    const run = server.received[0]!.messages[0];
    expect(run.header).toMatchObject({ action: 'run-task', streaming: 'duplex' });
    expect(run.payload).toMatchObject({ task_group: 'audio', task: 'asr', function: 'recognition', model: 'qwen-audio-3.1-asr-flash-streaming' });
    expect(run.payload.parameters).toEqual({ format: 'pcm', sample_rate: 16000, language_hints: ['zh', 'en'], vocabulary: { 养老护理: 4, 认知障碍: 4 } });
    expect(run.payload.input).toEqual({}); // prompt context withheld until verified for 3.1
    conn.sendAudio(Buffer.alloc(16000));
    await until(() => results.length === 1);
    expect(results[0]).toMatchObject({ kind: 'final', text: '你好', startMs: 0, endMs: 480 });
    await conn.finish();
  });

  it('an unrecognised model id gets core parameters only, and invalid hot-words are dropped', async () => {
    const { instantVocabulary } = await import('../src/asr/qwenAudioStreaming.js');
    expect(instantVocabulary(['养老护理', '这是一个远远超过十五个汉字长度的不合格热词条目', 'a b c d e f g h', '  ', 'long term care'])).toEqual({ 养老护理: 4, 'long term care': 4 });
    server = await startMock(inferenceHandler());
    const p = new QwenAudioStreamingProvider({ url: server.url, apiKey: 'k', model: 'some-future-model', connectTimeoutMs: 2000 });
    const conn = await p.connect(opts, { onResult() {}, onClosed() {} });
    const run = server.received[0]!.messages[0];
    expect(run.payload.parameters).toEqual({ format: 'pcm', sample_rate: 16000, language_hints: ['zh', 'en'] });
    expect(run.payload.input).toEqual({});
    conn.close();
  });

  it('classifies bad credentials as fatal (handshake 401 and task-failed) and abnormal drops as unclean closes', async () => {
    server = await startMock(inferenceHandler());
    server.rejectWith = 401;
    const p = new QwenAudioStreamingProvider({ url: server.url, apiKey: 'bad', model: 'm', connectTimeoutMs: 2000 });
    const e1 = await p.connect(opts, { onResult() {}, onClosed() {} }).catch((e) => e);
    expect(e1).toBeInstanceOf(AsrError);
    expect(e1.kind).toBe('fatal');
    await server.close();

    server = await startMock(inferenceHandler({ failTask: { code: 'InvalidApiKey', message: 'Invalid API-key provided.' } }));
    const e2 = await new QwenAudioStreamingProvider({ url: server.url, apiKey: 'bad', model: 'm', connectTimeoutMs: 2000 }).connect(opts, { onResult() {}, onClosed() {} }).catch((e) => e);
    expect(e2.kind).toBe('fatal');
    expect(e2.code).toBe('InvalidApiKey');
    await server.close();

    server = await startMock(inferenceHandler({ failTask: { code: 'ServiceUnavailable', message: 'busy' } }));
    const e3 = await new QwenAudioStreamingProvider({ url: server.url, apiKey: 'k', model: 'm', connectTimeoutMs: 2000 }).connect(opts, { onResult() {}, onClosed() {} }).catch((e) => e);
    expect(e3.kind).toBe('transient');
    await server.close();

    // Mid-stream drop → onClosed({clean:false}) so the pipeline reconnects.
    const closed: Array<{ clean: boolean }> = [];
    server = await startMock((ws, rec, s) => {
      inferenceHandler()(ws, rec);
      (s as MockServer & { last?: typeof ws }).last = ws;
    });
    const conn = await new QwenAudioStreamingProvider({ url: server.url, apiKey: 'k', model: 'm', connectTimeoutMs: 2000 }).connect(opts, { onResult() {}, onClosed: (i) => closed.push(i) });
    (server as unknown as { last: { terminate(): void } }).last.terminate();
    await until(() => closed.length === 1);
    expect(closed[0]!.clean).toBe(false);
    conn.close();
  });

  it('keeps the provider connection alive with WebSocket pings', async () => {
    let pings = 0;
    server = await startMock((ws, rec) => {
      inferenceHandler()(ws, rec);
      ws.on('ping', () => pings++);
    });
    const closed: Array<{ clean: boolean }> = [];
    const p = new QwenAudioStreamingProvider({ url: server.url, apiKey: 'k', model: 'm', connectTimeoutMs: 2000, keepAliveMs: 40 });
    await p.connect(opts, { onResult() {}, onClosed: (i) => closed.push(i) });
    await until(() => pings >= 3);
    expect(closed).toHaveLength(0);
  });

  it('treats a peer that stops answering pings as a dead connection (abnormal close → pipeline reconnects)', async () => {
    server = await startMock((ws, rec) => inferenceHandler()(ws, rec), { autoPong: false });
    const closed: Array<{ clean: boolean }> = [];
    const p = new QwenAudioStreamingProvider({ url: server.url, apiKey: 'k', model: 'm', connectTimeoutMs: 2000, keepAliveMs: 40 });
    await p.connect(opts, { onResult() {}, onClosed: (i) => closed.push(i) });
    await until(() => closed.length === 1, 3000);
    expect(closed[0]!.clean).toBe(false);
  });

  it('times out when the service never answers task-started', async () => {
    server = await startMock(() => {});
    const e = await new QwenAudioStreamingProvider({ url: server.url, apiKey: 'k', model: 'm', connectTimeoutMs: 150 }).connect(opts, { onResult() {}, onClosed() {} }).catch((x) => x);
    expect(e.code).toBe('connect_timeout');
    expect(e.kind).toBe('transient');
  });

  it('finish() reports false (not success) when the service never confirms', async () => {
    server = await startMock((ws, rec) => {
      inferenceHandler()(ws, rec);
      ws.removeAllListeners('message');
      ws.on('message', (d, bin) => {
        if (bin) return;
        const m = JSON.parse(d.toString());
        if (m.header.action === 'run-task') ws.send(JSON.stringify({ header: { task_id: m.header.task_id, event: 'task-started' }, payload: {} }));
      });
    });
    const conn = await new QwenAudioStreamingProvider({ url: server.url, apiKey: 'k', model: 'm', connectTimeoutMs: 2000 }).connect(opts, { onResult() {}, onClosed() {} });
    expect(await conn.finish(150)).toBe(false);
  });
});

describe('qwen3-asr-flash-realtime adapter (DashScope Realtime protocol, mock server)', () => {
  it('performs the session.created → session.update → session.updated handshake, base64 audio and maps stash/completed events', async () => {
    server = await startMock(
      realtimeHandler({
        onAudio: (ws, total) => {
          if (total === 16000) {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.speech_started', audio_start_ms: 200 }));
            ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.text', item_id: 'item_1', text: '你好', stash: '，请问' }));
          }
          if (total === 32000) {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.speech_stopped', audio_end_ms: 900 }));
            ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1', transcript: '你好，请问养老护理。' }));
          }
        },
      }),
    );
    const results: AsrResult[] = [];
    const closed: unknown[] = [];
    const p = new QwenRealtimeProvider({ url: `${server.url}/api-ws/v1/realtime`, apiKey: 'sk-test', model: 'qwen3-asr-flash-realtime', connectTimeoutMs: 2000 });
    const conn = await p.connect(opts, { onResult: (r) => results.push(r), onClosed: (i) => closed.push(i) });

    expect(server.received[0]!.url).toContain('model=qwen3-asr-flash-realtime');
    expect(server.received[0]!.headers.authorization).toBe('Bearer sk-test');
    const update = server.received[0]!.messages[0];
    expect(update.type).toBe('session.update');
    expect(update.session).toMatchObject({ input_audio_format: 'pcm', sample_rate: 16000 });
    expect(update.session.input_audio_transcription.language).toBe('zh');
    expect(update.session.input_audio_transcription.corpus.text).toContain('养老护理员访谈');
    expect(update.session.input_audio_transcription.corpus.text).toContain('认知障碍');

    conn.sendAudio(Buffer.alloc(16000));
    conn.sendAudio(Buffer.alloc(16000));
    await until(() => results.length >= 2);
    expect(server.received[0]!.messages[1]).toMatchObject({ type: 'input_audio_buffer.append' });
    expect(results[0]).toMatchObject({ kind: 'interim', key: 'item_1', text: '你好，请问', startMs: 200 });
    expect(results[1]).toMatchObject({ kind: 'final', key: 'item_1', text: '你好，请问养老护理。', startMs: 200 });
    expect(results[1]!.endMs).toBeGreaterThanOrEqual(900);

    expect(await conn.finish()).toBe(true);
    await until(() => closed.length === 1);
    expect(closed[0]).toMatchObject({ clean: true });
  });

  it('maps API errors to fatal/transient and handshake rejections to fatal', async () => {
    server = await startMock((ws) => {
      ws.send(JSON.stringify({ type: 'error', error: { code: 'invalid_api_key', message: 'bad key' } }));
    });
    const e = await new QwenRealtimeProvider({ url: server.url, apiKey: 'x', model: 'm', connectTimeoutMs: 2000 }).connect(opts, { onResult() {}, onClosed() {} }).catch((x) => x);
    expect(e.kind).toBe('fatal');
    await server.close();
    server = await startMock(() => {});
    server.rejectWith = 403;
    const e2 = await new QwenRealtimeProvider({ url: server.url, apiKey: 'x', model: 'm', connectTimeoutMs: 2000 }).connect(opts, { onResult() {}, onClosed() {} }).catch((x) => x);
    expect(e2.kind).toBe('fatal');
  });
});
