import { contextBridge, ipcRenderer } from 'electron';
import { MicCapture } from '../../web/src/audio/capture';
import { CHANNEL } from './policy';
import { createCloseRequestHandler } from './close-request';
import type { DesktopRuntime } from '../../web/src/desktop/runtime';

let active: { id: string; capture: MicCapture; stop: () => Promise<void> } | null = null;
let starting = false;
let flushNotebook: (() => Promise<boolean>) | null = null;
const listeners = new Set<(event: any) => void>();
const prepareClose = createCloseRequestHandler(() => flushNotebook !== null, async () => {
  let ok = true;
  try { await active?.stop(); } catch { ok = false; }
  try { ok = await flushNotebook?.() === true && ok; } catch { ok = false; }
  return ok;
}, (id, ok) => ipcRenderer.send(CHANNEL.closeReady, { id, ok }));
ipcRenderer.on(CHANNEL.event, (_event, message) => {
  if (message?.type === 'prepare-close' && typeof message.id === 'string') prepareClose(message.id);
  else for (const listener of listeners) listener(message);
});
const invoke = (channel: string, arg?: unknown) => ipcRenderer.invoke(channel, arg);
const diagnostic = (code: 'microphone_permission' | 'audio_capture' | 'ipc_error' | 'cleanup_failure') => ipcRenderer.send(CHANNEL.diagnostic, code);
const runtime: DesktopRuntime = {
  version: 1,
  saveExport: (name, bytes) => invoke(CHANNEL.save, { name, bytes }),
  onBeforeClose: handler => { flushNotebook = handler; return () => { if (flushNotebook === handler) flushNotebook = null; }; },
  getModelStatus: () => invoke(CHANNEL.status),
  subscribeModelStatus: callback => {
    const listener = (event: any) => { if (event?.type === 'model') callback(event.status); };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  downloadModel: async progress => {
    const listener = (event: any) => { if (event?.type === 'model') progress(event.status); };
    listeners.add(listener);
    try { await invoke(CHANNEL.download); } finally { listeners.delete(listener); }
  },
  cancelDownload: () => invoke(CHANNEL.cancel),
  importModel: async repair => { await invoke(CHANNEL.import, repair ?? false); },
  repairModel: async progress => {
    const listener = (event: any) => { if (event?.type === 'model') progress(event.status); };
    listeners.add(listener);
    try { await invoke(CHANNEL.repair); } finally { listeners.delete(listener); }
  },
  requestMicrophonePermission: async () => {
    const permission = await invoke(CHANNEL.permission);
    if (permission !== 'granted') return permission;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      return 'granted';
    } catch (error) { diagnostic('microphone_permission'); return (error as DOMException).name === 'NotAllowedError' ? 'denied' : 'unavailable'; }
  },
  startTranscription: async callbacks => {
    if (active || starting) throw new Error('Microphone session is already starting or active');
    starting = true;
    let id: string;
    try { id = await invoke(CHANNEL.start); } catch (error) { starting = false; diagnostic('ipc_error'); throw error; }
    const capture = new MicCapture();
    let stopped: Promise<void> | null = null;
    const listener = (event: any) => {
      if (event?.id !== id) return;
      if (event.type === 'final') callbacks.onSegment(event.segment);
      else if (event.type === 'partial') callbacks.onPartial?.(event.result);
      else if (event.type === 'recovering') callbacks.onRecovering?.();
      else if (event.type === 'interruption') {
        void capture.stop().catch(() => {});
        listeners.delete(listener);
        active = null;
        callbacks.onInterruption(event.reason);
      }
    };
    listeners.add(listener);
    const stop = () => {
      if (stopped) return stopped;
      stopped = (async () => {
        // Flush the capture worklet first, then native inference. Keep final callbacks until both finish.
        let captureError: unknown;
        try { await capture.stop(); } catch (error) { captureError = error; diagnostic('cleanup_failure'); }
        try { await invoke(CHANNEL.stop, id); if (captureError) throw captureError; }
        finally { listeners.delete(listener); if (active?.id === id) active = null; }
      })();
      return stopped;
    };
    active = { id, capture, stop };
    try {
      await capture.start(pcm => ipcRenderer.send(CHANNEL.audio, { id, pcm: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) }), () => {
        diagnostic('audio_capture');
        void stop().finally(() => callbacks.onInterruption('Audio capture stopped or the microphone disconnected. Confirmed text is preserved; review the end before resuming.')).catch(() => {});
      });
    } catch (error) { diagnostic('audio_capture'); await stop().catch(() => {}); throw error; }
    finally { starting = false; }
    return { stop };
  },
};
// Expose only this typed API. Never expose Electron, Node, raw IPC, arbitrary paths or process execution.
contextBridge.exposeInMainWorld('meetfolioDesktop', runtime);
