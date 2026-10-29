import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { AsrError } from './types.js';
import { modelFiles } from './localXasrModel.js';
/**
 * Local X-ASR provider. Audio stays on this device; CPU inference is isolated in
 * a child process. Models are installed by XAsrModelManager; native runtime is a pinned optional dependency.
 */
export class LocalXAsrProvider {
    modelDir;
    name = 'local-xasr';
    model = 'x-asr-480ms-streaming';
    isDemo = false;
    lastMetrics;
    constructor(modelDir) {
        this.modelDir = modelDir;
    }
    async connect(opts, handlers, signal) {
        if (opts.sampleRate !== 16_000)
            throw new AsrError('fatal', 'local_sample_rate', 'X-ASR 仅支持 16 kHz 单声道音频。');
        if (signal?.aborted)
            throw new AsrError('transient', 'local_asr_aborted', 'Local recognition cancelled');
        const files = modelFiles(this.modelDir);
        const entry = new URL(import.meta.url.endsWith('.ts') ? '../../dist/asr/localXasrWorker.js' : './localXasrWorker.js', import.meta.url);
        if (!existsSync(entry))
            throw new AsrError('fatal', 'local_asr_build_missing', 'Build the native inference child with npm run build -w server');
        const childOptions = {
            windowsHide: true, serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [],
            env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
        };
        const worker = fork(entry, [JSON.stringify(files)], childOptions);
        // Keep only the last ~2 KB of native diagnostics (no audio or transcript is written to stderr)
        // so an engine crash can be explained in the error message and the desktop log.
        let stderrTail = '';
        worker.stderr?.setEncoding('utf8');
        worker.stderr?.on('data', (chunk) => { stderrTail = (stderrTail + chunk).slice(-2000); });
        const withStderr = (message) => stderrTail.trim() ? `${message}｜${stderrTail.trim().split('\n').slice(-3).join(' / ').slice(0, 600)}` : message;
        const exited = new Promise(resolve => worker.once('close', () => resolve()));
        let ready = false;
        let closed = false;
        let queuedBytes = 0;
        let finishing = null;
        let finishCallback = null;
        let connectResolve = null;
        let connectReject = null;
        const fail = (error) => {
            if (closed)
                return;
            closed = true;
            const settle = finishCallback;
            finishCallback = null;
            void exited.then(() => { settle?.(false); if (!ready)
                connectReject?.(error); });
            if (ready)
                handlers.onClosed({ clean: false, error });
            worker.kill();
        };
        const stop = (clean) => {
            if (closed)
                return;
            closed = true;
            const settle = finishCallback;
            finishCallback = null;
            void exited.then(() => {
                settle?.(clean);
                if (!ready)
                    connectReject?.(new AsrError('fatal', 'local_asr_closed', '模型尚未加载就已关闭。'));
            });
            if (ready)
                handlers.onClosed({ clean });
            worker.kill();
        };
        const conn = {
            sendAudio(pcm) {
                if (closed || !ready || finishing)
                    throw new AsrError('transient', 'local_asr_closed', 'Recognition is not accepting audio');
                if (pcm.byteLength % 2) {
                    fail(new AsrError('fatal', 'local_pcm_alignment', 'PCM16 frames must contain complete samples'));
                    return;
                }
                queuedBytes += pcm.byteLength;
                // Avoid unbounded memory on slow laptops; a failed worker triggers ordinary gap recovery.
                if (queuedBytes > 16_000 * 2 * 30) {
                    fail(new AsrError('transient', 'local_asr_overloaded', '电脑无法跟上实时转录，已停止本地引擎以防止内存持续增加。'));
                    return;
                }
                const copy = Uint8Array.from(pcm);
                worker.send({ type: 'audio', pcm: copy }, error => { if (error)
                    fail(new AsrError('transient', 'local_asr_ipc', error.message)); });
            },
            finish(timeoutMs = 8000) {
                if (finishing)
                    return finishing;
                if (closed)
                    return Promise.resolve(false);
                finishing = new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        fail(new AsrError('transient', 'local_asr_finish_timeout', '本地识别收尾超时'));
                    }, timeoutMs);
                    finishCallback = (ok) => {
                        clearTimeout(timeout);
                        resolve(ok);
                    };
                    worker.send({ type: 'finish' }, error => { if (error)
                        fail(new AsrError('transient', 'local_asr_ipc', error.message)); });
                });
                return finishing;
            },
            close() {
                stop(false);
            },
        };
        const pending = new Promise((resolve, reject) => {
            connectResolve = resolve;
            connectReject = reject;
        });
        const startupTimeout = setTimeout(() => {
            fail(new AsrError('fatal', 'local_asr_load_timeout', 'X-ASR 模型加载超时'));
        }, 60_000);
        const abort = () => fail(new AsrError('transient', 'local_asr_aborted', '本地识别已取消'));
        signal?.addEventListener('abort', abort, { once: true });
        worker.on('message', (msg) => {
            if (closed)
                return;
            if (msg.type === 'ready') {
                clearTimeout(startupTimeout);
                ready = true;
                connectResolve?.(conn);
            }
            else if (msg.type === 'ack') {
                queuedBytes = Math.max(0, queuedBytes - (msg.bytes ?? 0));
            }
            else if (msg.type === 'result' && msg.kind && msg.key !== undefined) {
                handlers.onResult({
                    kind: msg.kind,
                    key: msg.key,
                    text: msg.text ?? '',
                    startMs: msg.startMs ?? 0,
                    endMs: msg.kind === 'final' ? (msg.endMs ?? 0) : null,
                });
            }
            else if (msg.type === 'metrics') {
                this.lastMetrics = msg.metrics;
            }
            else if (msg.type === 'finished') {
                stop(true);
            }
            else if (msg.type === 'error') {
                clearTimeout(startupTimeout);
                fail(new AsrError('fatal', 'local_asr_runtime_error', withStderr(msg.message ?? 'X-ASR 引擎发生错误')));
            }
        });
        worker.on('error', (e) => {
            clearTimeout(startupTimeout);
            fail(new AsrError('transient', 'local_asr_worker_error', e.message));
        });
        worker.on('exit', (code) => {
            clearTimeout(startupTimeout);
            if (!closed)
                fail(new AsrError('transient', 'local_asr_worker_exit', withStderr('本地 ASR 进程退出：' + code)));
        });
        try {
            return await pending;
        }
        finally {
            clearTimeout(startupTimeout);
            signal?.removeEventListener('abort', abort);
        }
    }
}
