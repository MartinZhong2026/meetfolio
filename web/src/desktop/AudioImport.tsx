import { useEffect, useRef, useState } from 'react';
import { AudioLines, FileAudio2, Upload, X } from 'lucide-react';
import { localRuntime } from './runtime';
import { decodeLocalAudio, pcmFrame, validateAudioFile } from './audioDecode';
import type { Interview } from './model';
import type { Segment } from '../lib/types';
export function AudioImport({ i, ready, onBusy, onDone, onClose }: {
  i: Interview; ready: boolean; onBusy: (busy: boolean) => void;
  onDone: (segments: Segment[], durationMs: number, name: string) => void; onClose: () => void;
}) {
  const runtime = localRuntime();
  const [file, setFile] = useState<File | null>(null);
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
    const unsubscribe = runtime?.subscribeImportProgress?.(event => { if (event.id === job.current) { setPhase(event.phase); setPercent(event.percent); } });
    return () => { mounted.current = false; controller.current?.abort(); if (job.current) void runtime?.cancelAudioImport?.(job.current).catch(() => {}); unsubscribe?.(); };
  }, [runtime]);
  function choose(selected: File | undefined) {
    if (busy || !selected) return;
    try { validateAudioFile(selected); setFile(selected); setError(''); }
    catch (e) { setError((e as Error).message); }
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
    if (!file || !consent || !ready || !runtime?.beginAudioImport || locked.current || (diarize && !speakerReady)) return;
    locked.current = true; setBusy(true); onBusy(true); setError(''); setPhase('Decoding audio on this device'); setPercent(0);
    const abort = new AbortController(); controller.current = abort;
    try {
      const buffer = await decodeLocalAudio(file, abort.signal);
      abort.signal.throwIfAborted();
      job.current = await runtime.beginAudioImport({ interviewId: i.id, diarize, numSpeakers, consent: true });
      for (let offset = 0; offset < buffer.length; offset += 16000) {
        abort.signal.throwIfAborted();
        await runtime.appendAudioImport!({ id: job.current, pcm: pcmFrame(buffer, offset, Math.min(16000, buffer.length - offset)) });
        setPhase('Saving a local audio copy'); setPercent(Math.round(offset / buffer.length * 100));
      }
      abort.signal.throwIfAborted(); setPhase('Starting offline transcription'); setPercent(0);
      const result = await runtime.finishAudioImport!(job.current);
      abort.signal.throwIfAborted();
      if (mounted.current) onDone(result.segments, result.durationMs, file.name);
    } catch (e) {
      if (job.current) await runtime.cancelAudioImport?.(job.current).catch(() => {});
      if (mounted.current) { setError(abort.signal.aborted ? 'Import cancelled. Any audio already saved is retained in Local storage.' : (e as Error).message); setPhase(''); }
    } finally {
      job.current = null; controller.current = null; locked.current = false;
      if (mounted.current) setBusy(false); onBusy(false);
    }
  }
  return <section className="dt-import" aria-label="Import audio recording">
    <div className="dt-import-intro"><div className="dt-import-symbol"><AudioLines size={30}/></div>
      <div><div className="dt-eyebrow">AUDIO → RESEARCH RECORD</div><h2>Bring a conversation into focus.</h2><p>Import a recording. Transcribe locally. Return to every voice.</p></div>
      <button className="dt-icon-button" aria-label="Close audio import" disabled={busy} onClick={onClose}><X size={18}/></button>
    </div>
    <div className="dt-import-grid"><div>
      <label className={`dt-dropzone ${busy ? 'disabled' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files[0]); }}>
        <FileAudio2 size={32}/><strong>{file?.name || 'Choose or drop an audio file'}</strong><span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ready to import` : 'WAV, MP3, M4A · up to 64 MB / 20 minutes'}</span>
        <span className="dt-btn"><Upload size={14}/>Choose recording</span><input className="dt-sr-only" type="file" accept=".wav,.mp3,.m4a" aria-label="Choose audio recording" disabled={busy} onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }}/>
      </label>
      <p className="dt-fine dt-import-privacy">Audio and transcript stay on this device. A normalized WAV copy is stored with this interview; keep the original recording as your source.</p>
    </div><div className="dt-import-options">
      <h3>Transcription settings</h3><p className="dt-muted">Chinese · English · mixed speech</p>
      <label className="dt-consent"><input type="checkbox" checked={diarize} disabled={busy} onChange={e => setDiarize(e.target.checked)}/>Automatically separate speakers</label>
      {diarize && <><label className="dt-label">Expected speakers<select aria-label="Expected speakers" value={numSpeakers} disabled={busy} onChange={e => setNumSpeakers(Number(e.target.value))}><option value={-1}>Detect automatically</option>{[1,2,3,4,5,6,8,12].map(n => <option key={n} value={n}>{n} speakers</option>)}</select></label>
        <p className="dt-fine">{speakerReady ? 'Speaker models verified · ready offline' : 'Install free speaker models once (~45 MB download).'} Labels are estimates; review short turns and overlapping voices.</p>
        {!speakerReady && <div className="dt-actions"><button className="dt-btn" disabled={busy || !runtime?.installSpeakerModels} onClick={() => void setup()}>Download speaker models</button><button className="dt-small-btn" disabled={busy || !runtime?.importSpeakerModels} onClick={() => void setup(true)}>Import model folder</button></div>}</>}
      <label className="dt-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)}/>I have permission to process this recording locally.</label>
      {!ready && <p className="dt-fine">Install and verify X-ASR in Model & Settings before transcribing.</p>}
      <button className="dt-btn primary" disabled={busy || !file || !consent || !ready || !runtime?.beginAudioImport || (diarize && !speakerReady)} onClick={() => void run()}><AudioLines size={16}/>Transcribe recording</button>
      {busy && <div role="status"><p>{phase}</p><progress aria-label="Audio import progress" value={percent} max={100}/><button className="dt-small-btn" onClick={() => { controller.current?.abort(); void runtime?.cancelSpeakerInstall?.(); if (job.current) void runtime?.cancelAudioImport?.(job.current).catch(() => {}); }}>Cancel processing</button></div>}
      {!busy && phase && <p role="status">{phase}</p>}{error && <p className="dt-alert" role="alert">{error}</p>}
    </div></div>
  </section>;
}
