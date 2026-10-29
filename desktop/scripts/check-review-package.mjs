/** Static review only. Does not execute or install the generated installer. */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { listPackage } from '@electron/asar';
import checkPack from './check-pack.cjs';

const root = path.resolve('work/desktop-packages');
const appOutDir = path.join(root, 'win-unpacked');
await checkPack({ appOutDir, electronPlatformName: 'win32' });
const entries = listPackage(path.join(appOutDir, 'resources/app.asar')).map(entry => entry.replace(/\\/g, '/'));
assert(entries.every(entry => entry === '/package.json' || entry === '/dist' || entry.startsWith('/dist/')), 'Unexpected source/reference files in application ASAR');
await assert.rejects(fs.stat(path.join(appOutDir, 'resources/recovery-reference')));
const installers = (await fs.readdir(root)).filter(name => name.endsWith('-windows-x64-setup.exe'));
assert.equal(installers.length, 1, 'Expected exactly one review installer');
const file = path.join(root, installers[0]);
const handle = await fs.open(file); const header = Buffer.alloc(2);
try { await handle.read(header, 0, 2, 0); } finally { await handle.close(); }
assert.equal(header.toString(), 'MZ');
const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
const report = { platform: process.platform, installer: installers[0], bytes: (await fs.stat(file)).size, sha256: hash.digest('hex'),
  staticResources: 'Passed', historicalReferencesInAsar: false, installation: 'Not run', physicalMicrophone: 'Not verified', signedRelease: false };
await fs.writeFile(path.join(root, 'static-review.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
