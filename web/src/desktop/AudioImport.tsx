import { useEffect, useRef, useState } from 'react';
import { AudioLines, FileAudio2, Upload, X } from 'lucide-react';
import { localRuntime, type SelectedAudio, type ImportTask } from './runtime';
import { fmtClock } from '../lib/format';
import { decodeLocalAudio, pcmFrame, validateAudioFile } from './audioDecode';
import type { Interview } from './model';
import type { Segment } from '../lib/types';
export function AudioImport({ i, ready, onBusy, onDone, onClose }: {
  i: Interview; ready: boolean; onBusy: (busy: boolean) => void;
  onDone: (segments: Segment[], durationMs: number, name: string, partial?: boolean) => void; onClose: () => void;
}) {
  const runtime = localRuntime();
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<SelectedAudio | null>(null);
  const [nativeConsumed, setNativeConsumed] = useState(false);
  const [decoderReady, setDecoderReady] = useState(false);
  const [decoderSupported, setDecoderSupported] = useState(false);
  const [tasks, setTasks] = useState<ImportTask[]>([]);
  const [completedMs, setCompletedMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);
  const [consent, setConsent] = useState(false);
  const [diarize, setDiarize] = useState(true);
  const [speakerReady, setSpeakerReady] = useState(false);
  const [numSpeakers, setNumSpeakers] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const job = useRef<string | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void runtime?.getSpeakerStatus?.().then(s => { if (mounted.current) setSpeakerReady(s.ready); }).catch(() => {});
    void runtime?.getDecoderStatus?.().then(s => { if (mounted.current) { setDecoderReady(s.ready); setDecoderSupported(s.supported); } }).catch(() => {});
    void runtime?.listImportTasks?.({ interviewId: i.id }).then(value => { if (mounted.current) setTasks(value); }).catch(() => {});
    const unsubscribe = runtime?.subscribeImportProgress?.(event => { if (event.id === job.current) { setPhase(event.phase); setPercent(event.percent); if (event.completedMs !== undefined) setCompletedMs(event.completedMs); if (event.totalMs !== undefined) setTotalMs(event.totalMs); } });
    const unsubscribeDecoder = runtime?.subscribeDecoderProgress?.(event => { if (mounted.current) { setPhase(`Downloading local decoder · ${(event.downloadedBytes / 1024 / 1024).toFixed(1)} / ${(event.totalBytes / 1024 / 1024).toFixed(1)} MB`); setPercent(Math.round(event.downloadedBytes / event.totalBytes * 100)); } });
    return () => { mounted.current = false; controller.current?.abort(); if (job.current) void runtime?.cancelAudioImport?.(job.current).catch(() => {}); unsubscribe?.(); unsubscribeDecoder?.(); };
  }, [runtime, i.id]);
  function choose(selected: File | undefined) {
    if (busy || !selected) return;
    try { validateAudioFile(selected); setFile(selected); setSelected(null); setNativeConsumed(false); setError(''); }
    catch (e) { setError((e as Error).message + (decoderReady ? ' Use Choose recording for native import up to 120 minutes / 2 GiB.' : '')); }
  }
  async function chooseNative() {
    if (locked.current) return; locked.current = true; setBusy(true); onBusy(true); setPhase('Inspecting recording…');
    try { const value = await runtime?.selectAudioFile?.(); if (value) { setSelected(value); setNativeConsumed(false); setFile(null); setError(''); } }
    catch (e) { setError(e instanceof Error ? e.message : 'Cannot select this recording. Choose a local WAV, MP3 or M4A up to 2 GiB.'); }
    finally { locked.current = false; setBusy(false); onBusy(false); setPhase(''); }
  }
  async function setupDecoder(importArchive = false) {
    if (locked.current) return; locked.current = true; setBusy(true); onBusy(true); setError(''); setPhase('Preparing local audio decoder…');
    try { const value = importArchive ? await runtime?.importAudioDecoder?.() : await runtime?.installAudioDecoder?.(); setDecoderReady(value?.ready === true); setPhase(value?.ready ? 'Local decoder ready · up to 120 minutes / 2 GiB' : 'Decoder setup cancelled.'); }
    catch (e) { const detail = e instanceof Error ? /Decoder setup failed while [a-z ]+: [A-Z_a-z ]+/.exec(e.message)?.[0] : undefined; setError(`${detail || 'Decoder setup incomplete'}. Retry the download or import the verified FFmpeg ZIP archive. Small recordings can still use the browser decoder.`); }
    finally { locked.current = false; setBusy(false); onBusy(false); }
  }
  async function resume(task: ImportTask) {
    if (locked.current || !ready || !runtime?.resumeAudioImport) return;
    locked.current = true; setBusy(true); onBusy(true); setError(''); setPhase('Resuming from saved checkpoint');
    const abort = new AbortController(); controller.current = abort;
    setCompletedMs(task.completedMs); setTotalMs(task.durationMs); setPercent(Math.round(task.completedMs / task.durationMs * 100));
    try { job.current = await runtime.resumeAudioImport({ interviewId: i.id, recordingId: task.recordingId }); const result = await runtime.finishAudioImport!(job.current); abort.signal.throwIfAborted(); onDone(result.segments, result.durationMs, task.name || 'Resumed recording'); }
    catch (e) { setError(abort.signal.aborted ? 'Processing paused. Saved checkpoints and audio are retained.' : (e as Error).message); }
    finally { job.current = null; controller.current = null; locked.current = false; if (mounted.current) setBusy(false); onBusy(false); void runtime.listImportTasks?.({ interviewId: i.id }).then(value => { if (mounted.current) setTasks(value); }).catch(() => {}); }
  }
  async function setup(importFolder = false) {
    if (locked.current) return; locked.current = true;
    setBusy(true); onBusy(true); setError(''); setPhase('Installing speaker models…');
    try {
      const result = importFolder ? await runtime?.importSpeakerModels?.() : await runtime?.installSpeakerModels?.();
      setSpeakerReady(result?.ready === true); setPhase(result?.ready ? 'Speaker models ready for offline use.' : 'Model setup cancelled.');
    } catch { setError('Speaker model setup incomplete. Check the connection or import the verified model folder.'); }
    finally { locked.current = false; setBusy(false); onBusy(false); }
  }
  async function run() {
    if ((!file && !selected) || (selected && nativeConsumed) || !consent || !ready || !runtime?.beginAudioImport || locked.current || (diarize && !speakerReady)) return;
    locked.current = true; setBusy(true); onBusy(true); setError(''); setPhase('Decoding audio on this device'); setPercent(0); setCompletedMs(0); setTotalMs(0);
    const abort = new AbortController(); controller.current = abort;
    try {
      if (selected && runtime.beginFileImport) {
        job.current = await runtime.beginFileImport({ token: selected.token, interviewId: i.id, diarize, numSpeakers, consent: true });
        setNativeConsumed(true);
      } else {
      const buffer = await decodeLocalAudio(file!, abort.signal);
      abort.signal.throwIfAborted();
      job.current = await runtime.beginAudioImport({ interviewId: i.id, diarize, numSpeakers, consent: true, name: file!.name.slice(0,200) });
      for (let offset = 0; offset < buffer.length; offset += 16000) {
        abort.signal.throwIfAborted();
        await runtime.appendAudioImport!({ id: job.current, pcm: pcmFrame(buffer, offset, Math.min(16000, buffer.length - offset)) });
        setPhase('Saving a local audio copy'); setPercent(Math.round(offset / buffer.length * 100));
      }
      }
      abort.signal.throwIfAborted(); setPhase('Starting offline transcription'); setPercent(0);
      const result = await runtime.finishAudioImport!(job.current);
      abort.signal.throwIfAborted();
      if (mounted.current) onDone(result.segments, result.durationMs, selected?.name || file!.name);
    } catch (e) {
      if (job.current) await runtime.cancelAudioImport?.(job.current).catch(() => {});
      if (mounted.current) { setError(abort.signal.aborted ? 'Import cancelled. Any audio already saved is retained in Local storage.' : (e as Error).message); setPhase(''); }
    } finally {
      job.current = null; controller.current = null; locked.current = false;
      if (mounted.current) setBusy(false); onBusy(false);
      void runtime.listImportTasks?.({ interviewId: i.id }).then(value => { if (mounted.current) setTasks(value); }).catch(() => {});
    }
  }
  const FileDrop = decoderReady ? 'div' : 'label';
  return <section className="dt-import" aria-label="Import audio recording">
    <div className="dt-import-intro"><div className="dt-import-symbol"><AudioLines size={30}/></div>
      <div><div className="dt-eyebrow">AUDIO → RESEARCH RECORD</div><h2>Bring a conversation into focus.</h2><p>Import a recording. Transcribe locally. Return to every voice.</p></div>
      <button className="dt-icon-button" aria-label="Close audio import" disabled={busy} onClick={onClose}><X size={18}/></button>
    </div>
    <div className="dt-import-grid"><div>
      <FileDrop className={`dt-dropzone ${busy ? 'disabled' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files[0]); }}>
        <FileAudio2 size={32}/><strong>{selected?.name || file?.name || (decoderReady ? 'Choose a local recording' : 'Choose or drop an audio file')}</strong><span>{selected || file ? `${selected?.durationMs ? fmtClock(selected.durationMs) + ' · ' : ''}${((selected?.bytes ?? file!.size) / 1024 / 1024).toFixed(1)} MB · ready to import` : decoderReady ? 'WAV, MP3, M4A · up to 2 GiB / 120 minutes' : 'WAV, MP3, M4A · up to 64 MB / 20 minutes'}</span>
        {decoderReady ? <button type="button" className="dt-btn" disabled={busy} onClick={e => { e.preventDefault(); e.stopPropagation(); void chooseNative(); }}><Upload size={14}/>Choose recording</button> : <span className="dt-btn"><Upload size={14}/>Choose recording</span>}
        {!decoderReady && <input className="dt-sr-only" type="file" accept=".wav,.mp3,.m4a" aria-label="Choose audio recording" disabled={busy} onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }}/>}
      </FileDrop>
      <p className="dt-fine dt-import-privacy">Audio and transcript stay on this device. A normalized WAV copy is stored with this interview; keep the original recording as your source.</p>
      {decoderSupported && !decoderReady && <div className="dt-decoder-setup"><h3>Working with a long interview?</h3><p className="dt-muted">Install the local decoder once for recordings up to 120 minutes / 2 GiB. Audio streams to disk instead of filling browser memory.</p><p className="dt-fine">FFmpeg 9.0.2 · optional upstream GPL download (~110 MB). Not bundled in Meetfolio.</p><div className="dt-actions"><button className="dt-btn" disabled={busy} onClick={() => void setupDecoder()}>Download local decoder</button><button className="dt-small-btn" disabled={busy} onClick={() => void setupDecoder(true)}>Import decoder ZIP</button></div></div>}
      {!!tasks.filter(t => !t.complete).length && <div className="dt-import-resume"><h3>Continue unfinished work</h3><p className="dt-fine">Resume from the last complete two-minute window. Saved audio and reviewed text are kept.</p>{tasks.filter(t => !t.complete).map(task => <div key={task.recordingId}><span><b>{task.name || `Recording ${task.recordingId.slice(0,8)}`}</b><br/>{fmtClock(task.completedMs)} / {fmtClock(task.durationMs)} · {task.segmentCount} confirmed segments</span><div className="dt-actions"><button className="dt-btn" disabled={busy || !ready} onClick={() => void resume(task)}>Resume {task.recordingId.slice(0,8)}</button><button className="dt-small-btn" disabled={busy || !task.segmentCount} onClick={async () => { try { onDone(await runtime!.recoverAudioImport!({ interviewId: i.id, recordingId: task.recordingId }), task.durationMs, task.name || 'Saved recording', true); } catch { setError('Cannot recover confirmed text. Audio and checkpoints are retained.'); } }}>Review confirmed text</button></div></div>)}</div>}
    </div><div className="dt-import-options">
      <h3>Transcription settings</h3><p className="dt-muted">Chinese · English · mixed speech</p>
      <label className="dt-consent"><input type="checkbox" checked={diarize} disabled={busy} onChange={e => setDiarize(e.target.checked)}/>Automatically separate speakers</label>
      {diarize && <><label className="dt-label">Expected speakers<select aria-label="Expected speakers" value={numSpeakers} disabled={busy} onChange={e => setNumSpeakers(Number(e.target.value))}><option value={-1}>Detect automatically</option>{[1,2,3,4,5,6,8,12].map(n => <option key={n} value={n}>{n} speakers</option>)}</select></label>
        <p className="dt-fine">{speakerReady ? 'Speaker models verified · ready offline' : 'Install free speaker models once (~45 MB download).'} Labels are estimates; review short turns and overlapping voices.</p>
        {!speakerReady && <div className="dt-actions"><button className="dt-btn" disabled={busy || !runtime?.installSpeakerModels} onClick={() => void setup()}>Download speaker models</button><button className="dt-small-btn" disabled={busy || !runtime?.importSpeakerModels} onClick={() => void setup(true)}>Import model folder</button></div>}</>}
      <label className="dt-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)}/>I have permission to process this recording locally.</label>
      {!ready && <p className="dt-fine">Install and verify X-ASR in Model & Settings before transcribing.</p>}
      <button className="dt-btn primary" disabled={busy || (!file && !selected) || (!!selected && nativeConsumed) || !consent || !ready || !runtime?.beginAudioImport || (diarize && !speakerReady)} onClick={() => void run()}><AudioLines size={16}/>Transcribe recording</button>
      {busy && <div role="status"><p>{phase}</p>{totalMs > 0 && <p className="dt-fine">Checkpoint: {fmtClock(completedMs)} / {fmtClock(totalMs)} · saved every 2 minutes of audio</p>}<progress aria-label="Audio import progress" value={percent} max={100}/><button className="dt-small-btn" onClick={() => { controller.current?.abort(); void runtime?.cancelSpeakerInstall?.(); void runtime?.cancelDecoderInstall?.(); if (job.current) void runtime?.cancelAudioImport?.(job.current).catch(() => {}); }}>Cancel processing</button></div>}
      {!busy && phase && <p role="status">{phase}</p>}{error && <p className="dt-alert" role="alert">{error}</p>}
      {!busy && nativeConsumed && error && <p className="dt-fine">Resume a saved task below, or choose the source recording again to start a separate import.</p>}
    </div></div>
  </section>;
}
