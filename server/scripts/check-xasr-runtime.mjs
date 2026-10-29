/** Fail the desktop package build if optional native dependencies were omitted or drifted. */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const platform = process.platform === 'win32' ? 'win' : process.platform;
const packageName = `sherpa-onnx-${platform}-${process.arch}`;
const main = require('sherpa-onnx-node/package.json');
const nativeFile = require.resolve(`${packageName}/package.json`);
const native = require(nativeFile);
assert.equal(main.version, '1.13.8'); assert.equal(native.version, '1.13.8');
const files = process.platform === 'win32'
  ? ['sherpa-onnx.node', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'sherpa-onnx-c-api.dll', 'sherpa-onnx-cxx-api.dll']
  : process.platform === 'linux' ? ['sherpa-onnx.node', 'libonnxruntime.so', 'libsherpa-onnx-c-api.so', 'libsherpa-onnx-cxx-api.so'] : ['sherpa-onnx.node'];
for (const file of files) assert(fs.statSync(path.join(path.dirname(nativeFile), file)).size > 0, `Missing ${file}`);
assert.equal(typeof require('sherpa-onnx-node').OnlineRecognizer, 'function');
console.log(JSON.stringify({ platform: process.platform, arch: process.arch, version: native.version, files }));
