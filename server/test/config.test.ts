import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const load = (env: Record<string, string>) => loadConfig({ NODE_ENV: 'production', ...env } as NodeJS.ProcessEnv);

describe('deployment configuration', () => {
  it('TRUST_PROXY=auto trusts the proxy only on Railway; explicit values win', () => {
    expect(load({}).trustProxy).toBe(false);
    expect(load({ RAILWAY_ENVIRONMENT_NAME: 'staging' }).trustProxy).toBe(true);
    expect(load({ RAILWAY_PROJECT_ID: 'p', TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(load({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
  });

  it('production defaults: secure cookies, demo off; LLM_EXTRA_BODY must be a JSON object', () => {
    const c = load({});
    expect(c.cookieSecure).toBe(true);
    expect(c.demoEnabled).toBe(false);
    expect(load({ LLM_EXTRA_BODY: '{"enable_thinking":false}' }).llmExtraBodyValid).toBe(true);
    expect(load({ LLM_EXTRA_BODY: '[1]' }).llmExtraBodyValid).toBe(false);
    expect(load({ LLM_EXTRA_BODY: 'not json' }).llmExtraBodyValid).toBe(false);
  });

  it('selects the ASR model and the workspace endpoint from configuration', () => {
    expect(load({}).asrModel).toBe('qwen-audio-3.0-asr-flash-streaming');
    const c = load({ ASR_MODEL: 'qwen-audio-3.1-asr-flash-streaming', DASHSCOPE_API_KEY: 'sk', DASHSCOPE_WORKSPACE_ID: 'llm-x' });
    expect(c.asrModel).toBe('qwen-audio-3.1-asr-flash-streaming');
    expect(c.asrWsUrl).toBe('wss://llm-x.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference');
    expect(c.asrConfigured).toBe(true);
    expect(load({ ASR_PROVIDER: 'qwen3-realtime' }).asrModel).toBe('qwen3-asr-flash-realtime');
  });
});
