import { XAsrModelManager } from './xasrManager.js';
import type { Config } from '../config.js';
import { DemoAsrProvider } from './demo.js';
import { QwenAudioStreamingProvider } from './qwenAudioStreaming.js';
import { QwenRealtimeProvider } from './qwenRealtime.js';
import type { AsrProvider, AsrProviderFactory } from './types.js';

export function createAsrFactory(config: Config): AsrProviderFactory {
  let live: AsrProvider | null = null;
  if (config.ASR_PROVIDER === 'local-xasr') {
    live = new XAsrModelManager({ modelDir: config.X_ASR_MODEL_DIR });
  } else if (config.asrConfigured) {
    const base = { url: config.asrWsUrl!, apiKey: config.DASHSCOPE_API_KEY!, model: config.asrModel, connectTimeoutMs: config.ASR_CONNECT_TIMEOUT_MS };
    live = config.ASR_PROVIDER === 'qwen3-realtime' ? new QwenRealtimeProvider(base) : new QwenAudioStreamingProvider(base);
  }
  return {
    live: () => live,
    demo: () => (config.demoEnabled ? new DemoAsrProvider() : null),
  };
}
