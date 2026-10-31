export const AUDIO_LIMIT_BYTES = 64 * 1024 * 1024;
export const AUDIO_LIMIT_SECONDS = 20 * 60;
export function validateAudioFile(file: Pick<File, 'name' | 'size'>) {
  if (!/\.(wav|mp3|m4a)$/i.test(file.name)) throw new Error('Choose a WAV, MP3 or M4A recording.');
  if (!file.size || file.size > AUDIO_LIMIT_BYTES) throw new Error('Choose an audio file up to 64 MB.');
}
export function pcmFrame(buffer: AudioBuffer, offset: number, count: number) {
  const pcm = new Uint8Array(count * 2); const view = new DataView(pcm.buffer);
  for (let n = 0; n < count; n++) {
    let sample = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) sample += buffer.getChannelData(c)[offset + n] / buffer.numberOfChannels;
    if (!Number.isFinite(sample)) sample = 0;
    view.setInt16(n * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), true);
  }
  return pcm;
}
export async function decodeLocalAudio(file: File, signal: AbortSignal) {
  validateAudioFile(file); signal.throwIfAborted();
  const url = URL.createObjectURL(file); const media = new Audio();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => done(new Error('Cannot read audio duration. Try converting to WAV.')), 15000);
      const abort = () => done(new Error('Audio import cancelled.'));
      const done = (error?: Error) => { clearTimeout(timer); signal.removeEventListener('abort', abort); media.onloadedmetadata = null; media.onerror = null; error ? reject(error) : resolve(); };
      media.onloadedmetadata = () => done(!Number.isFinite(media.duration) || media.duration <= 0 || media.duration > AUDIO_LIMIT_SECONDS ? new Error('Choose a recording up to 20 minutes.') : undefined);
      media.onerror = () => done(new Error('This audio codec is unavailable. Try a PCM WAV.'));
      signal.addEventListener('abort', abort, { once: true }); media.preload = 'metadata'; media.src = url;
    });
  } finally { media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); }
  signal.throwIfAborted();
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer()); signal.throwIfAborted();
    if (decoded.sampleRate !== 16000 || decoded.duration > AUDIO_LIMIT_SECONDS || decoded.numberOfChannels > 2 || !decoded.length) throw new Error('Use a mono or stereo recording up to 20 minutes.');
    return decoded;
  } finally { await context.close(); }
}
