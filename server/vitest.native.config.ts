import { defineConfig } from 'vitest/config';

// Native lifecycle and model-cache tests need no PostgreSQL or external ASR services.
export default defineConfig({ test: {
  environment: 'node', include: ['test/xasr.test.ts', 'test/xasr-archive.test.ts', 'test/local-xasr-provider.test.ts'],
  fileParallelism: false, testTimeout: 30000,
} });
