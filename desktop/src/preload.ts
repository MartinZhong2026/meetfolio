import { contextBridge, ipcRenderer } from 'electron';
import { MicCapture } from '../../web/src/audio/capture';
import { CHANNEL } from './policy';
import { createCloseRequestHandler } from './close-request';
import type { DesktopRuntime } from '../../web/src/desktop/runtime';

let active: { id: string; capture: MicCapture; stop: () => Promise<void> } | null = null;
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
    } catch (error) { return (error as DOMException).name === 'NotAllowedError' ? 'denied' : 'unavailable'; }
  },
  startTranscription: async callbacks => {
    if (active) throw new Error('麦克风正在使用中');
    const id = await invoke(CHANNEL.start);
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
        await capture.stop();
        try { await invoke(CHANNEL.stop, id); }
        finally { listeners.delete(listener); if (active?.id === id) active = null; }
      })();
      return stopped;
    };
    active = { id, capture, stop };
    try {
      await capture.start(pcm => ipcRenderer.send(CHANNEL.audio, { id, pcm: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) }), () => {
        void stop().finally(() => callbacks.onInterruption('麦克风设备已断开。已保存文字保留，请核对末尾内容。')).catch(() => {});
      });
    } catch (error) { await stop().catch(() => {}); throw error; }
    return { stop };
  },
};
// Expose only this typed API. Never expose Electron, Node, raw IPC, arbitrary paths or process execution.
contextBridge.exposeInMainWorld('meetfolioDesktop', runtime);
