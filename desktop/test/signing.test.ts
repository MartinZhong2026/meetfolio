import { afterEach, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const run = (provider: string, values: Record<string, string> = {}) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'meetfolio-signing-')); dirs.push(directory);
  const out = path.join(directory, 'signing.json');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('MEETFOLIO_')) delete env[key];
  const result = spawnSync(process.execPath, ['scripts/prepare-signing.mjs', provider, out], { env: { ...env, ...values }, encoding: 'utf8' });
  return { ...result, out };
};
test('signing fails closed without a maintainer-approved identity and certificate', () => {
  expect(run('store').status).not.toBe(0);
  expect(run('store', { MEETFOLIO_SIGNING_PUBLISHER: 'Test metadata only', MEETFOLIO_CERTIFICATE_SHA1: 'invalid' }).status).not.toBe(0);
});
test('hardware store configuration requires signing and retains no private credentials', () => {
  const result = run('store', { MEETFOLIO_SIGNING_PUBLISHER: 'Test metadata only', MEETFOLIO_CERTIFICATE_SHA1: 'A'.repeat(40),
    AZURE_CLIENT_SECRET: 'must-not-be-copied', WIN_CSC_KEY_PASSWORD: 'must-not-be-copied' });
  expect(result.status).toBe(0);
  const text = readFileSync(result.out, 'utf8'); const config = JSON.parse(text);
  expect(config.extraMetadata.author.name).toBe('Test metadata only');
  expect(config.forceCodeSigning).toBe(true); expect(config.win.signExecutable).toBe(true);
  expect(config.win.signtoolOptions.signingHashAlgorithms).toEqual(['sha256']);
  expect(text).not.toContain('must-not-be-copied'); expect(config.win.azureSignOptions).toBeUndefined();
});
test('cloud signing rejects credential-bearing or unofficial endpoints without authenticating', () => {
  const values = { MEETFOLIO_SIGNING_PUBLISHER: 'Test metadata only', MEETFOLIO_ARTIFACT_ACCOUNT: 'test', MEETFOLIO_ARTIFACT_PROFILE: 'test' };
  for (const endpoint of ['http://eus.codesigning.azure.net', 'https://codesigning.azure.net.evil.example', 'https://user:secret@eus.codesigning.azure.net']) {
    expect(run('azure', { ...values, MEETFOLIO_ARTIFACT_ENDPOINT: endpoint }).status).not.toBe(0);
  }
  const result = run('azure', { ...values, MEETFOLIO_ARTIFACT_ENDPOINT: 'https://eus.codesigning.azure.net/' });
  expect(result.status).toBe(0);
  expect(JSON.parse(readFileSync(result.out, 'utf8')).win.azureSignOptions.fileDigest).toBe('SHA256');
});
