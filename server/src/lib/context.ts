import type { Mailer } from '../auth/mailer.js';
import type { AsrProviderFactory } from '../asr/types.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { LlmClient } from '../ai/llm.js';
import type { Storage } from '../storage/index.js';
import type { Logger } from './logger.js';
import type { TranscriptionRegistry } from '../asr/registry.js';

/** Everything the HTTP/WS layers need; injected so tests can swap providers. */
export interface AppContext {
  config: Config;
  db: Db;
  logger: Logger;
  storage: Storage;
  mailer: Mailer;
  asr: AsrProviderFactory;
  llm: LlmClient;
  registry: TranscriptionRegistry;
}
