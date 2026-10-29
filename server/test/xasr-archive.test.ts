import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fixtures from './xasr-archive-fixtures.json' with { type: 'json' };
import { extractXAsrArchive } from '../src/asr/xasrArchive.js';

for (const [name, hex] of Object.entries(fixtures)) {
  it(`safely handles archive entry ${name}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'xasr-archive-'));
    try {
      const archive = path.join(root, 'archive.bz2'), output = path.join(root, 'extracted');
      await writeFile(archive, Buffer.from(hex, 'hex'));
      if (name === 'good/model.txt') {
        await extractXAsrArchive(archive, output);
        expect(await readFile(path.join(output, name), 'utf8')).toBe('test');
      } else { await expect(extractXAsrArchive(archive, output)).rejects.toThrow(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
