import type { Config } from '../config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  model: string;
  messages: ChatMessage[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmResult {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export class LlmError extends Error {
  constructor(
    public code:
      | 'llm_not_configured'
      | 'llm_auth'
      | 'llm_model_not_found'
      | 'llm_rate_limited'
      | 'llm_timeout'
      | 'llm_bad_response'
      | 'llm_unavailable'
      | 'llm_content_filtered'
      | 'llm_json_unsupported',
    message: string,
  ) {
    super(message);
  }
}

export interface LlmClient {
  readonly configured: boolean;
  complete(req: LlmRequest): Promise<LlmResult>;
}

/**
 * Chat-completions client for DashScope's OpenAI-compatible endpoint. Requests are streamed so a long
 * report never hits an intermediate gateway's idle timeout; deltas are concatenated server-side.
 */
export function createLlmClient(config: Config, fetchImpl: typeof fetch = fetch): LlmClient {
  const extra: Record<string, unknown> = (() => {
    try {
      return config.LLM_EXTRA_BODY && config.llmExtraBodyValid ? JSON.parse(config.LLM_EXTRA_BODY) : {};
    } catch {
      return {};
    }
  })();

  return {
    configured: config.llmConfigured,
    async complete(req) {
      if (!config.DASHSCOPE_API_KEY) throw new LlmError('llm_not_configured', 'AI 服务尚未配置（DASHSCOPE_API_KEY）');
      let lastErr: LlmError | null = null;
      let current = req;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
        try {
          return await once(current);
        } catch (e) {
          if (!(e instanceof LlmError)) throw e;
          lastErr = e;
          // Reasoning models may refuse JSON mode; the summariser parses JSON from plain text too, so retry without it.
          if (e.code === 'llm_json_unsupported' && current.json) {
            current = { ...current, json: false };
            attempt--;
            continue;
          }
          if (!['llm_rate_limited', 'llm_unavailable'].includes(e.code)) throw e;
        }
      }
      throw lastErr!;
    },
  };

  async function once(req: LlmRequest): Promise<LlmResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.LLM_TIMEOUT_MS);
    req.signal?.addEventListener('abort', () => ctrl.abort());
    try {
      const res = await fetchImpl(`${config.llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.DASHSCOPE_API_KEY}` },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: true,
          stream_options: { include_usage: true },
          temperature: req.temperature ?? 0.2,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          ...extra,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 500);
        if (res.status === 401 || res.status === 403) throw new LlmError('llm_auth', 'AI 服务密钥无效或无权限');
        if (res.status === 429) throw new LlmError('llm_rate_limited', 'AI 服务繁忙，请稍后重试');
        // DashScope answers "url error" when a model is not served on this API route; for our purposes that is the same
        // as "this model id is not available here" and triggers the standard-model fallback.
        if (res.status === 400 && req.json && !/url error/i.test(body) && /response_format|json_object|json mode|json 模式|结构化输出/i.test(body)) {
          throw new LlmError('llm_json_unsupported', 'JSON 模式不被该模型支持');
        }
        if (res.status === 404 || /url error|model.*(not|does not).*(exist|found|support)|invalid.*model|model_not_found/i.test(body)) {
          throw new LlmError('llm_model_not_found', `模型 ${req.model} 不可用`);
        }
        if (/data_inspection_failed|content.*(filter|policy)/i.test(body)) throw new LlmError('llm_content_filtered', '内容未通过服务商的安全审核');
        if (res.status >= 500) throw new LlmError('llm_unavailable', 'AI 服务暂时不可用');
        throw new LlmError('llm_bad_response', `AI 服务返回错误 (${res.status})`);
      }
      if (!res.body) throw new LlmError('llm_bad_response', 'AI 服务无响应');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let text = '';
      let usage: LlmResult['usage'];
      let model = req.model;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            if (j.model) model = j.model;
            const delta = j.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') text += delta;
            if (j.usage) usage = { promptTokens: j.usage.prompt_tokens, completionTokens: j.usage.completion_tokens };
          } catch {
            /* ignore keep-alive / partial lines */
          }
        }
      }
      if (!text.trim()) throw new LlmError('llm_bad_response', 'AI 服务返回了空内容');
      return { text, model, usage };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if ((e as Error).name === 'AbortError') throw new LlmError('llm_timeout', 'AI 生成超时，请稍后重试');
      throw new LlmError('llm_unavailable', 'AI 服务连接失败');
    } finally {
      clearTimeout(timer);
    }
  }
}
