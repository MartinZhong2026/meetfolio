const fs = require('node:fs');
const path = require('node:path');
module.exports = async context => {
  const mac = context.electronPlatformName === 'darwin';
  const resources = mac ? path.join(context.appOutDir, 'MeetfolioPreview.app/Contents/Resources') : path.join(context.appOutDir, 'resources');
  const native = `sherpa-onnx-${context.electronPlatformName === 'win32' ? 'win' : context.electronPlatformName}-${process.arch}`;
  const required = context.electronPlatformName === 'win32'
    ? ['sherpa-onnx.node', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'sherpa-onnx-c-api.dll', 'sherpa-onnx-cxx-api.dll']
    : mac ? ['sherpa-onnx.node', 'libonnxruntime.dylib', 'libsherpa-onnx-c-api.dylib', 'libsherpa-onnx-cxx-api.dylib'] : ['sherpa-onnx.node', 'libonnxruntime.so', 'libsherpa-onnx-c-api.so', 'libsherpa-onnx-cxx-api.so'];
  for (const file of [
    'branding/meetfolio.ico', 'branding/meetfolio.png', 'app.asar', 'ui/index.html', 'ui/pcm-worklet.js', 'xasr/asr/xasrManager.js', 'xasr/asr/localXasrWorker.js', 'xasr/asr/audio-import-worker.cjs',
    'xasr/node_modules/proper-lockfile/index.js', 'xasr/node_modules/tar-stream/index.js',
    'xasr/node_modules/unbzip2-stream/index.js', 'xasr/node_modules/sherpa-onnx-node/sherpa-onnx.js',
    ...required.map(file => `xasr/node_modules/${native}/${file}`),
  ]) if (!fs.statSync(path.join(resources, file)).isFile()) throw new Error(`Packaged resource missing: ${file}`);
  const version = JSON.parse(fs.readFileSync(path.join(resources, 'xasr/node_modules', native, 'package.json'), 'utf8')).version;
  if (version !== '1.13.8') throw new Error('Packaged native version mismatch');
  if (mac && !fs.statSync(path.join(resources,'xasr/decoder/meetfolio-audio-decoder')).isFile()) throw new Error('Bundled system decoder missing');
  if (mac) await require('./sign-mac-preview.cjs')(context);
};
