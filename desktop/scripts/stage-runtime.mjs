import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildMacDecoder } from './build-mac-decoder.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function stageRuntime() {
  const target = path.join(root, 'work/desktop-runtime/xasr');
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.join(target, 'asr'), { recursive: true });
  const files = ['localXasr.js', 'localXasrWorker.js', 'localXasrModel.js', 'xasrArchive.js', 'xasrManager.js', 'types.js'];
  for (const file of files) await fs.copyFile(path.join(root, 'server/dist/asr', file), path.join(target, 'asr', file));
  await build({ entryPoints: ['audio-import-worker', 'speaker-models', 'audio-decoder'].map(name => path.join(root, `desktop/src/${name}.ts`)), outdir: path.join(target, 'asr'), outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
  const versions = new Map();
  async function find(name, from) {
    for (let dir = from;; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', name);
      try { await fs.stat(path.join(candidate, 'package.json')); return candidate; } catch {}
      if (path.dirname(dir) === dir) throw new Error(`Missing packaged dependency: ${name}`);
    }
  }
  async function copy(name, from, optional = false) {
    let source;
    try { source = await find(name, from); } catch (error) { if (optional) return; throw error; }
    const manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
    if (versions.has(name)) {
      if (versions.get(name) !== manifest.version) throw new Error(`Conflicting native resource dependency versions: ${name}`);
      return;
    }
    versions.set(name, manifest.version);
    await fs.cp(source, path.join(target, 'node_modules', name), { recursive: true, dereference: true });
    for (const dependency of Object.keys(manifest.dependencies ?? {})) await copy(dependency, source);
    const native = `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      if (name === 'sherpa-onnx-node' && dependency !== native) continue;
      await copy(dependency, source, name !== 'sherpa-onnx-node');
    }
  }
  for (const name of ['sherpa-onnx-node', 'tar-stream', 'unbzip2-stream', 'proper-lockfile']) await copy(name, root);
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'meetfolio-native-runtime', private: true, type: 'module', versions: Object.fromEntries(versions) }, null, 2));
  await fs.writeFile(path.join(root, 'work/desktop-runtime/dependencies.json'), JSON.stringify(Object.fromEntries(versions), null, 2));
  await buildMacDecoder(root, target);
  return target;
}
