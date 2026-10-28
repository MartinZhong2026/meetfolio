import { describe, expect, it } from 'vitest';
import { createLlmClient, LlmError } from '../src/ai/llm.js';
import { loadConfig } from '../src/config.js';

/** Fake fetch: records request bodies and answers from a script. No network, no paid call. */
function fakeFetch(answers: Array<{ status: number; body?: string; sse?: string[] }>) {
  const calls: Array<{ url: string; body: any; auth: string | null }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('authorization') });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    if (a.sse) {
      const text = a.sse.map((d) => `data: ${d}\n\n`).join('') + 'data: [DONE]\n\n';
      return new Response(new Blob([text]).stream(), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(a.body ?? '', { status: a.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const cfg = (env: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', DASHSCOPE_API_KEY: 'sk-test', ...env } as NodeJS.ProcessEnv);
const ok = (content: string) => ({ status: 200, sse: [JSON.stringify({ model: 'm', choices: [{ delta: { content } }] }), JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } })] });
const msg = [{ role: 'user' as const, content: 'hi' }];

describe('LLM client (OpenAI-compatible DashScope endpoint)', () => {
  it('defaults to qwen3.7-plus / qwen3.8-max and the workspace compatible-mode endpoint', () => {
    const c = cfg({ DASHSCOPE_WORKSPACE_ID: 'llm-abc' });
    expect(c.LLM_MODEL_STANDARD).toBe('qwen3.7-plus');
    expect(c.LLM_MODEL_QUALITY).toBe('qwen3.8-max');
    expect(c.llmBaseUrl).toBe('https://llm-abc.cn-beijing.maas.aliyuncs.com/compatible-mode/v1');
    expect(cfg().llmBaseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(cfg({ LLM_BASE_URL: 'https://proxy.example/v1' }).llmBaseUrl).toBe('https://proxy.example/v1');
  });

  it('sends a streamed chat completion with Bearer auth, JSON mode and extra body; concatenates deltas; ignores reasoning deltas', async () => {
    const reasoning = { status: 200, sse: [JSON.stringify({ choices: [{ delta: { reasoning_content: '思考中…' } }] }), JSON.stringify({ choices: [{ delta: { content: '{"a":' } }] }), JSON.stringify({ choices: [{ delta: { content: '1}' } }], usage: { prompt_tokens: 5, completion_tokens: 6 } })] };
    const f = fakeFetch([reasoning]);
    const llm = createLlmClient(cfg({ LLM_EXTRA_BODY: '{"enable_thinking":false}' }), f.impl);
    const r = await llm.complete({ model: 'qwen3.8-max', messages: msg, json: true });
    expect(r.text).toBe('{"a":1}');
    expect(r.usage).toEqual({ promptTokens: 5, completionTokens: 6 });
    expect(f.calls[0]!.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(f.calls[0]!.auth).toBe('Bearer sk-test');
    expect(f.calls[0]!.body).toMatchObject({ model: 'qwen3.8-max', stream: true, response_format: { type: 'json_object' }, enable_thinking: false });
  });

  it('maps "model not available on this route" responses (incl. DashScope "url error" and Model.NotExist) to llm_model_not_found', async () => {
    for (const body of ['{"code":"InvalidParameter","message":"url error, please check url"}', '{"error":{"code":"Model.NotExist","message":"Model not exist."}}', 'model_not_found']) {
      const f = fakeFetch([{ status: 400, body }]);
      const e = await createLlmClient(cfg(), f.impl).complete({ model: 'qwen3.8-max', messages: msg }).catch((x) => x);
      expect(e).toBeInstanceOf(LlmError);
      expect(e.code).toBe('llm_model_not_found');
    }
  });

  it('retries once without JSON mode when a model rejects response_format', async () => {
    const f = fakeFetch([{ status: 400, body: '{"error":{"code":"InvalidParameter","message":"The response_format parameter is not supported in thinking mode"}}' }, ok('{"x":1}')]);
    const r = await createLlmClient(cfg(), f.impl).complete({ model: 'qwen3.8-max', messages: msg, json: true });
    expect(r.text).toBe('{"x":1}');
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]!.body.response_format).toEqual({ type: 'json_object' });
    expect(f.calls[1]!.body.response_format).toBeUndefined();
  });

  it('classifies auth, rate limit (retried), content filter and server errors', async () => {
    const code = async (answers: Parameters<typeof fakeFetch>[0]) => (await createLlmClient(cfg(), fakeFetch(answers).impl).complete({ model: 'm', messages: msg }).catch((x) => x)).code;
    expect(await code([{ status: 401, body: 'InvalidApiKey' }])).toBe('llm_auth');
    expect(await code([{ status: 400, body: '{"code":"DataInspectionFailed","message":"data_inspection_failed"}' }])).toBe('llm_content_filtered');
    const f = fakeFetch([{ status: 429, body: 'Throttling' }, ok('done')]);
    expect((await createLlmClient(cfg(), f.impl).complete({ model: 'm', messages: msg })).text).toBe('done');
    expect(f.calls).toHaveLength(2);
  }, 20_000);
});
