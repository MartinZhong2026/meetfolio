/**
 * Provider-neutral realtime ASR contracts. The pipeline only knows these types; each DashScope
 * protocol lives in its own adapter so a different model/protocol can be swapped in via config.
 */
/** 16 kHz, mono, 16-bit little-endian PCM. */
export const SAMPLE_RATE = 16_000;
export const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000; // 32
export const msToBytes = (ms) => Math.round(ms * BYTES_PER_MS) & ~1; // keep sample alignment
export const bytesToMs = (bytes) => bytes / BYTES_PER_MS;
export class AsrError extends Error {
    kind;
    code;
    constructor(kind, code, message) {
        super(message);
        this.kind = kind;
        this.code = code;
    }
}
