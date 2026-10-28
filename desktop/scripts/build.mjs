import { build } from 'esbuild';
import { stageRuntime } from './stage-runtime.mjs';
await build({ entryPoints: ['src/main.ts', 'src/preload.ts'], bundle: true, outdir: 'dist', outExtension: { '.js': '.cjs' }, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false });
await stageRuntime();
