/** Inspect installed Windows PE resources, not filenames/configuration alone. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NtExecutable, NtExecutableResource, Resource, Data } = require('resedit');
const [installer, installed, out = 'work/installed-app-evidence'] = process.argv.slice(2);
assert(installer && installed, 'Supply installer EXE and installed directory');
await fs.mkdir(out, { recursive: true });
const digest = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const master = Data.IconFile.from(await fs.readFile('desktop/assets/meetfolio.ico'));
const iconBytes = icon => icon.isIcon() ? icon.generate() : icon.bin;
const expected = master.icons.map(icon => digest(iconBytes(icon.data))).sort();
assert.equal(expected.length, 7);
const report = { signatureVerification: 'Separate Windows Authenticode check; icon matching does not establish publisher trust', files: [], caveat: 'Resource identity is checked independently of the Windows Explorer icon cache.' };
for (const file of [installer, path.join(installed, 'Meetfolio.exe'), path.join(installed, 'Uninstall Meetfolio.exe')]) {
  const pe = NtExecutable.from(await fs.readFile(file), { ignoreCert: true });
  const entries = NtExecutableResource.from(pe).entries;
  const groups = Resource.IconGroupEntry.fromEntries(entries);
  assert(groups.length, `No icon resources: ${file}`);
  for (const group of groups) assert.deepEqual(group.getIconItemsFromEntries(entries).map(icon => digest(iconBytes(icon))).sort(), expected,
    `Generic/mismatched icon group ${group.id}: ${file}`);
  const manifests = entries.filter(entry => entry.type === 24).map(entry => Buffer.from(entry.bin).toString('utf8'));
  assert(manifests.some(text => /requestedExecutionLevel\s+level=["']asInvoker["']/.test(text)), `Unexpected execution level: ${file}`);
  report.files.push({ file: path.basename(file), groups: groups.length, iconSizes: [16, 24, 32, 48, 64, 128, 256], allIconPayloadsMatchMaster: true, executionLevel: 'asInvoker' });

}
// NSIS page art is compressed payload, not RT_BITMAP. Exact source bytes and actual rendered
// green/white control checks are separate so Windows DPI/theme scaling cannot fake a mismatch.
const files = await fs.readdir(out);
const observed = files.filter(name => /^fresh-(scope|finish)-bitmap-.*\.png$/.test(name));
const payloads = files.filter(name => /^fresh-(scope|finish)-payload-.*\.bmp$/i.test(name));
report.installerBitmaps = [];
for (const name of ['installer-header.bmp', 'installer-sidebar.bmp']) {
  const expected = await fs.readFile(path.join('desktop/assets', name));
  let match = null;
  for (const image of payloads) if (digest(await fs.readFile(path.join(out, image))) === digest(expected)) { match = image; break; }
  assert(match, `Custom NSIS payload bitmap missing: ${name}; extracted: ${payloads.join(', ')}`);
  report.installerBitmaps.push({ source: name, extractedPayload: match, sourceHashMatches: true });
}
report.displayedControls = [];
for (const image of observed) {
  const actual = await sharp(path.join(out, image)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let green = 0, white = 0;
  for (let i = 0; i < actual.data.length; i += 3) {
    const r = actual.data[i], g = actual.data[i + 1], b = actual.data[i + 2];
    if (Math.abs(r - 53) <= 4 && Math.abs(g - 95) <= 4 && Math.abs(b - 82) <= 4) green++;
    if (r > 245 && g > 245 && b > 245) white++;
  }
  const pixels = actual.info.width * actual.info.height;
  report.displayedControls.push({ image, width: actual.info.width, height: actual.info.height, forestGreenFraction: green / pixels, whiteFraction: white / pixels });
}
console.log(JSON.stringify({ displayedControls: report.displayedControls }));
assert(report.displayedControls.some(i => i.width > i.height && i.forestGreenFraction > 0.02 && i.whiteFraction > 0.02), 'Branded header not observed in the actual installer');
assert(report.displayedControls.some(i => i.height > i.width && i.forestGreenFraction > 0.4 && i.whiteFraction > 0.02), 'Branded sidebar not observed in the actual installer');
await fs.writeFile(path.join(out, 'branding-resources.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
