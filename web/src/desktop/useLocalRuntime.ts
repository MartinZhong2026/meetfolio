import { useEffect, useRef, useState } from 'react';
import {
  confirmedModel,
  localRuntime,
  type LocalSession,
  type ModelStatus,
} from './runtime';
import type { Interview } from './model';
import type { Segment } from '../lib/types';
import { uuid } from '../lib/format';
type Patch = (id: string, update: (i: Interview) => Interview) => void;
export function useLocalRuntime(patch: Patch) {
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const [partial, setPartial] = useState<{ text: string; startMs: number } | null>(null);
  const [permission, setPermission] = useState<
    'unknown' | 'requesting' | 'granted' | 'denied' | 'unavailable'
  >('unknown');
  const session = useRef<LocalSession | null>(null);
  const token = useRef(0);
  const clock = useRef<ReturnType<typeof setInterval>>();
  const stopClock = () => {
    clearInterval(clock.current);
    clock.current = undefined;
  };
  async function check() {
    setChecking(true);
    try {
      const r = localRuntime();
      const status = r ? await r.getModelStatus() : null;
      setModel(status);
      setRuntimeError('');
      return status;
    } catch {
      setModel(null);
      setRuntimeError('Cannot confirm local model state. Check the runtime and retry.');
      return null;
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void check();
    const unsubscribe = localRuntime()?.subscribeModelStatus?.(status => {
      setModel(status);
      if (confirmedModel(status)) setRuntimeError('');
    });
    return () => {
      unsubscribe?.();
      token.current++;
      setPartial(null);
      stopClock();
      void session.current?.stop().catch(() => {});
    };
  }, []);
  async function install(action: 'download' | 'import' | 'repair') {
    const r = localRuntime();
    if (!r) return;
    setDownloading(true);
    setRuntimeError('');
    let failure = '';
    try {
      if (action === 'import') await r.importModel?.(model?.state !== 'missing');
      else if (action === 'repair') await r.repairModel?.(setModel);
      else await r.downloadModel?.(setModel);
      const status = await check();
      if (status && !confirmedModel(status) && status.state !== 'missing') failure = 'Model not loaded. Check its status and retry.';
    } catch {
      failure = 'Model operation incomplete. Try downloading, importing or repairing; notes are unaffected.';
      await check();
    } finally {
      setRuntimeError(failure);
      setDownloading(false);
    }
  }
  const download = () => install('download');
  async function stop(id: string, ended = false) {
    stopClock();
    try {
      await session.current?.stop();
      setPartial(null);
      token.current++;
      session.current = null;
      patch(id, (i) => ({ ...i, recording: ended ? 'ended' : 'paused' }));
    } catch {
      token.current++;
      session.current = null;
      patch(id, (i) => ({
        ...i,
        recording: 'interrupted',
        interruption:
          'Error stopping local transcription. Review recent text; unconfirmed audio may be lost.',
      }));
    }
  }
  async function start(i: Interview) {
    const r = localRuntime();
    if (!r || !i.consent) return;
    patch(i.id, (current) => ({ ...current, recording: 'starting' }));
    const currentToken = ++token.current;
    const sessionId = uuid();
    const interrupt = (reason: string) => {
      if (currentToken !== token.current) return;
      token.current++;
      setPartial(null);
      stopClock();
      void session.current?.stop().catch(() => {});
      session.current = null;
      patch(i.id, (current) => ({
        ...current,
        recording: 'interrupted',
        interruption:
          reason ||
          'Local session interrupted. Review saved transcript; unsaved audio may be lost.',
      }));
    };
    try {
      // Recheck on every start; a cached UI badge is never sufficient.
      const status = await check();
      if (!status || !confirmedModel(status)) throw new Error('Speech model is not ready');
      if (currentToken !== token.current) return;
      setPermission('requesting');
      const result = await r.requestMicrophonePermission();
      setPermission(result);
      if (result !== 'granted') {
        patch(i.id, (current) => ({ ...current, recording: 'idle' }));
        return;
      }
      if (currentToken !== token.current) return;
      const live = await r.startTranscription({
        onSegment: (segment: Segment) => {
          if (currentToken !== token.current) return;
          if (
            !segment ||
            typeof segment.originalText !== 'string' ||
            segment.originalText.length > 200000 ||
            !Number.isFinite(segment.startMs) ||
            !Number.isFinite(segment.endMs) ||
            segment.startMs < 0 ||
            segment.endMs < segment.startMs
          ) {
            interrupt('Local speech engine returned an invalid segment. Review recent text.');
            return;
          }
          patch(i.id, (current) => {
            const id = `${sessionId}_${typeof segment.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(segment.id) ? segment.id : uuid()}`;
            if (current.segments.some((s) => s.id === id)) return current;
            const seq = Math.max(0, ...current.segments.map((s) => s.seq)) + 1;
            return {
              ...current,
              elapsedMs: Math.max(
                current.elapsedMs,
                i.elapsedMs + segment.endMs,
              ),
              segments: [
                ...current.segments,
                {
                  id,
                  seq,
                  originalText: segment.originalText,
                  editedText: null,
                  speakerLabel:
                    typeof segment.speakerLabel === 'string'
                      ? segment.speakerLabel
                      : null,
                  startMs: i.elapsedMs + segment.startMs,
                  endMs: i.elapsedMs + segment.endMs,
                  isImportant: false,
                  source: 'local',
                  updatedAt: new Date().toISOString(),
                },
              ],
            };
          });
        },
        onPartial: result => {
          if (currentToken !== token.current) return;
          setPartial(result.text ? { text: result.text, startMs: i.elapsedMs + result.startMs } : null);
        },
        onRecovering: () => setRuntimeError('Local engine recovering; unconfirmed audio temporarily buffered.'),
        onInterruption: interrupt,
      });
      if (currentToken !== token.current) {
        await live.stop();
        return;
      }
      session.current = live;
      patch(i.id, (current) => ({ ...current, recording: 'recording' }));
      const start = performance.now();
      const offset = i.elapsedMs;
      clock.current = setInterval(
        () =>
          patch(i.id, (current) => ({
            ...current,
            elapsedMs: Math.max(
              current.elapsedMs,
              offset + performance.now() - start,
            ),
          })),
        1000,
      );
    } catch {
      setPermission((p) => (p === 'requesting' ? 'unavailable' : p));
      interrupt(
        'Cannot start transcription. Check model and microphone permissions; saved data is unaffected.',
      );
    }
  }
  return {
    model,
    partial,
    checking,
    downloading,
    runtimeError,
    permission,
    check,
    download,
    importModel: () => install('import'),
    repair: () => install('repair'),
    cancel: () => localRuntime()?.cancelDownload?.(),
    canImport: !!localRuntime()?.importModel,
    canRepair: !!localRuntime()?.repairModel,
    canCancel: !!localRuntime()?.cancelDownload,
    start,
    stop,
    ready: !!model && confirmedModel(model),
    canDownload: !!localRuntime()?.downloadModel,
  };
}
