import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat, truncate, readFile, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { XAsrModelManager, verifyXAsrArchive } from '../src/asr/xasrManager.js';
import { XASR, modelFiles, sealModelCache, verifyModelCache } from '../src/asr/localXasrModel.js';
import type { AsrConnection, AsrHandlers, AsrProvider } from '../src/asr/types.js';
import { createAsrFactory } from '../src/asr/factory.js';
import { loadConfig } from '../src/config.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function root() { const p = await mkdtemp(path.join(os.tmpdir(), 'meetfolio-xasr-')); roots.push(p); return p; }
async function installed(root: string) {
  const dir = path.join(root, XASR.id); await mkdir(dir);
  for (const name of Object.values(XASR.files)) await writeFile(path.join(dir, name), 'test fixture, not ONNX');
  await sealModelCache(dir);
  return dir;
}
function fakeNative(failure = false) {
  let handlers: AsrHandlers;
  const conn: AsrConnection = { sendAudio: vi.fn(), finish: vi.fn(async () => { handlers.onClosed({ clean: true }); return true; }), close: vi.fn(() => handlers.onClosed({ clean: false })) };
  const provider: AsrProvider = { name: 'test-only', model: 'mock', isDemo: false,
    connect: vi.fn(async (_opts, h) => { handlers = h; if (failure) throw new Error('Native DLL load failed'); return conn; }) };
  return { provider, conn, result: () => handlers.onResult({ kind: 'final', key: '0', text: 'test fixture', startMs: 0, endMs: 100 }) };
}

describe('X-ASR manager lifecycle (injected native test double)', () => {
  it('never infers Ready from model files; loads before readiness and reuses the loaded connection', async () => {
    const r = await root(); await installed(r); const fake = fakeNative();
    const manager = new XAsrModelManager({ root: r, provider: () => fake.provider });
    const states: string[] = []; manager.on('status', s => states.push(s.state));
    expect(manager.getStatus().state).toBe('installed');
    await manager.initialize();
    expect(states).toEqual(['loading', 'ready']);
    const onResult = vi.fn();
    const conn = await manager.connect({ sampleRate: 16000, terms: [], languageHints: [] }, { onResult, onClosed: vi.fn() });
    expect(fake.provider.connect).toHaveBeenCalledTimes(1);
    fake.result(); expect(onResult).toHaveBeenCalledTimes(1);
    await expect(manager.download()).rejects.toThrow('in progress');
    await expect(manager.repair()).rejects.toThrow('in progress');
    await conn.finish(); expect(manager.getStatus().state).toBe('installed');
    await manager.dispose();
  });
  it('reports Error on actual engine startup failure and permits a later retry', async () => {
    const r = await root(); await installed(r); let fail = true;
    const manager = new XAsrModelManager({ root: r, provider: () => fakeNative(fail).provider });
    await expect(manager.initialize()).rejects.toThrow('DLL');
    expect(manager.getStatus().state).toBe('error');
    fail = false; await manager.initialize(); expect(manager.getStatus().state).toBe('ready'); await manager.dispose();
  });
  it('rejects missing model, wrong rate, already aborted session and use after disposal', async () => {
    const manager = new XAsrModelManager({ root: await root() });
    expect(manager.getStatus().state).toBe('not-installed');
    await expect(manager.initialize()).rejects.toThrow('Install');
    const handlers = { onResult: vi.fn(), onClosed: vi.fn() };
    await expect(manager.connect({ sampleRate: 48000, terms: [], languageHints: [] }, handlers)).rejects.toThrow('16 kHz');
    await expect(manager.connect({ sampleRate: 16000, terms: [], languageHints: [] }, handlers, AbortSignal.abort())).rejects.toThrow('cancelled');
    await manager.dispose(); await expect(manager.initialize()).rejects.toThrow('closed');
  });
  it('selects local ASR with no paid credentials or model installed and never falls back to cloud/demo', () => {
    const config = loadConfig({ ASR_PROVIDER: 'local-xasr', DEMO_MODE: 'false', ASR_MODEL: 'cloud-model', DASHSCOPE_WORKSPACE_ID: 'unused' });
    expect(config.asrModel).toBe(XASR.id); expect(config.asrWsUrl).toBeNull();
    const factory = createAsrFactory(config);
    expect(factory.live()?.name).toBe('local-xasr'); expect(factory.live()?.isDemo).toBe(false); expect(factory.demo()).toBeNull();
  });
});

describe('pinned downloads and recovery', () => {
  it('detects non-empty model tampering and rejects unverified legacy caches without deleting them', async () => {
    const r = await root(), dir = await installed(r);
    await verifyModelCache(dir);
    await writeFile(path.join(dir, XASR.files.encoder), 'changed fixture, still non-empty');
    await expect(verifyModelCache(dir)).rejects.toThrow('mismatch');
    await rm(path.join(dir, '.meetfolio-integrity.json'));
    await expect(verifyModelCache(dir)).rejects.toThrow('import or repair');
    expect((await stat(path.join(dir, XASR.files.encoder))).size).toBeGreaterThan(0);
  });
  it('reports a failed download and retries from retained bytes with a Range request', async () => {
    const r = await root(); await writeFile(path.join(r, `${XASR.id}.part`), 'partial');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('', { status: 503 }));
    const manager = new XAsrModelManager({ root: r, fetch: fetcher });
    await expect(manager.download()).rejects.toThrow('503'); expect(manager.getStatus().state).toBe('download-failed');
    await expect(manager.download()).rejects.toThrow('503');
    expect(fetcher.mock.calls[1][1]?.headers).toEqual({ Range: 'bytes=7-' });
    expect(await readFile(path.join(r, `${XASR.id}.part`), 'utf8')).toBe('partial');
    expect(await stat(path.join(r, '.xasr-install-lock')).catch(() => null)).toBeNull();
  });
  it('cancels an in-flight download, retains complete chunks and releases the install lock', async () => {
    const r = await root();
    const fetcher: typeof fetch = async (_url, init) => {
      const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(32)); init?.signal?.addEventListener('abort', () => controller.error(new Error('cancelled')), { once: true }); } });
      return new Response(stream);
    };
    const manager = new XAsrModelManager({ root: r, fetch: fetcher });
    manager.on('status', s => { if (s.downloadedBytes === 32) manager.cancel(); });
    await expect(manager.download()).rejects.toThrow(); expect(manager.getStatus().state).toBe('not-installed');
    expect(await stat(path.join(r, '.xasr-install-lock')).catch(() => null)).toBeNull();
  });
  it('rejects unexpected byte size and hash without extracting anything', async () => {
    const r = await root(), file = path.join(r, 'bad'); await writeFile(file, 'wrong');
    await expect(verifyXAsrArchive(file)).rejects.toThrow('size');
    await truncate(file, XASR.size);
    await expect(verifyXAsrArchive(file)).rejects.toThrow('SHA-256');
    expect(() => modelFiles(r)).toThrow();
  });
  it('restarts safely when Range is ignored and rejects a truncated body', async () => {
    const r = await root(); await writeFile(path.join(r, `${XASR.id}.part`), 'old');
    const manager = new XAsrModelManager({ root: r, fetch: async () => new Response('new') });
    await expect(manager.download()).rejects.toThrow('size');
    expect(await stat(path.join(r, XASR.id)).catch(() => null)).toBeNull();
    expect(await stat(path.join(r, `${XASR.id}.part`)).catch(() => null)).toBeNull();
  });
  it('rejects a conflicting installer and an import of another archive', async () => {
    const r = await root(); await mkdir(path.join(r, '.xasr-install-lock'));
    const manager = new XAsrModelManager({ root: r, fetch: vi.fn() });
    await expect(manager.download()).rejects.toThrow('Another installer');
    await rm(path.join(r, '.xasr-install-lock'), { recursive: true });
    const file = path.join(r, 'not-model'); await writeFile(file, 'invalid');
    await expect(manager.importArchive(file)).rejects.toThrow('size'); expect(manager.getStatus().state).toBe('error');
  });
  it('reclaims a stale heartbeat lock after an interrupted process', async () => {
    const r = await root(), lock = path.join(r, '.xasr-install-lock');
    await mkdir(lock); const old = new Date(Date.now() - 60_000); await utimes(lock, old, old);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const manager = new XAsrModelManager({ root: r, fetch: fetcher });
    await expect(manager.download()).rejects.toThrow('503');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await stat(lock).catch(() => null)).toBeNull();
  });
  it('rejects the wrong repair archive without modifying a previous model', async () => {
    const r = await root(), dir = await installed(r), archive = path.join(r, 'invalid.tar.bz2');
    await writeFile(archive, 'invalid');
    const manager = new XAsrModelManager({ root: r });
    await expect(manager.importArchive(archive, { repair: true })).rejects.toThrow('size');
    expect(await readFile(path.join(dir, XASR.files.encoder), 'utf8')).toBe('test fixture, not ONNX');
    expect(manager.getStatus().state).toBe('error');
  });

});
