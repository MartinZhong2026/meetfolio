import { Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { confirmedModel, localRuntime } from './runtime';
import type { useLocalRuntime } from './useLocalRuntime';
export function ModelCard({ runtime: r }: { runtime: ReturnType<typeof useLocalRuntime> }) {
  const progress = r.model?.totalBytes && r.model.downloadedBytes !== undefined
    ? Math.max(0, Math.min(100, Math.round(r.model.downloadedBytes / r.model.totalBytes * 100))) : null;
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupPhase, setSetupPhase] = useState('');
  const [setupError, setSetupError] = useState('');
  const [speakerReady, setSpeakerReady] = useState(false);
  const [decoder, setDecoder] = useState({ supported: false, ready: false });
  useEffect(() => {
    let active = true;
    const native = localRuntime();
    void native?.getSpeakerStatus?.().then(value => { if (active) setSpeakerReady(value.ready); }).catch(() => {});
    void native?.getDecoderStatus?.().then(value => { if (active) setDecoder(value); }).catch(() => {});
    return () => { active = false; };
  }, [r.ready]);
  const allReady = r.ready && speakerReady && (!decoder.supported || decoder.ready);
  async function setupOffline() {
    if (setupBusy || r.downloading || r.checking) return;
    const native = localRuntime();
    if (!native) { setSetupError('Open the installed desktop app to set up offline transcription.'); return; }
    setSetupBusy(true);
    setSetupError('');
    try {
      if (!confirmedModel(await native.getModelStatus())) {
        if (!r.canDownload) throw new Error('Speech model download unavailable.');
        setSetupPhase('Step 1 · Installing the offline speech model');
        await r.download();
        if (!confirmedModel(await native.getModelStatus())) throw new Error('The speech model did not initialize. Retry or use Advanced setup.');
      }
      if (native.installSpeakerModels && !(await native.getSpeakerStatus?.())?.ready) {
        setSetupPhase('Step 2 · Installing offline speaker separation');
        const speaker = await native.installSpeakerModels();
        if (!speaker.ready) throw new Error('Speaker model installation did not finish.');
        setSpeakerReady(true);
      }
      const currentDecoder = await native.getDecoderStatus?.();
      if (currentDecoder?.supported && !currentDecoder.ready && native.installAudioDecoder) {
        setSetupPhase('Step 3 · Installing the optional local long-audio decoder');
        const result = await native.installAudioDecoder();
        if (!result.ready) throw new Error('Audio decoder installation did not finish.');
        setDecoder(result);
      }
      setSetupPhase('Setup complete · Offline transcription is ready');
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Offline setup incomplete. Existing model files are retained; retry setup.');
    } finally {
      setSetupBusy(false);
    }
  }
  return (
    <section className="dt-card dt-model-card" aria-label="Local transcription and model">
      <div className="dt-eyebrow">ON YOUR DEVICE</div>
      <h2>Offline speech model</h2>
      <p className="dt-muted">The installed desktop runtime must verify the model and microphone before transcription.</p>
      <p className="dt-fine">The first model download connects to the official GitHub release. You can also import the official archive. Speech recognition runs on this device.</p>
      <div className="dt-model-box">
        <div className="dt-unified-setup">
          <h3>One-time offline setup</h3>
          <p>One setup installs speech recognition, speaker separation and the optional Windows long-audio decoder. Models are downloaded only after you click. Audio is processed locally. The optional FFmpeg decoder is GPL-licensed and downloaded from its verified upstream source.</p>
          <button className="dt-btn primary" disabled={setupBusy || r.downloading || r.checking || allReady || !localRuntime()} onClick={() => void setupOffline()}>
            <Download size={15}/>{allReady ? 'Offline transcription ready' : setupBusy ? 'Setting up offline transcription…' : 'Set up offline transcription'}
          </button>
          <p role="status" aria-live="polite">{setupPhase || (allReady ? 'Speech, speaker and decoder components are ready.' : 'The setup can be retried without deleting previously installed models.')}</p>
          {setupError && <p className="dt-alert" role="alert">{setupError}</p>}
          <p className="dt-fine">X-ASR: {r.ready ? 'Ready' : 'Not ready'} · Speakers: {speakerReady ? 'Ready' : 'Not ready'} · Long-audio decoder: {decoder.supported ? decoder.ready ? 'Ready' : 'Optional setup required' : 'Built in / not required'}</p>
        </div>
        <div><strong><ShieldCheck size={16}/>{r.ready ? r.model?.modelId : 'Local offline speech model'}</strong>
          <span className={`dt-chip ${!r.ready ? 'warning' : ''}`}>
            {r.checking ? 'Checking' : r.downloading || r.model?.state === 'downloading' ? 'Downloading'
              : r.ready ? 'X-ASR Ready · Offline' : r.model?.state === 'loading' ? 'Initializing'
              : r.model?.state === 'error' || r.model?.state === 'download-failed' ? 'Model installation failed' : 'Not installed / pending load'}
          </span></div>
        <p>{r.ready ? 'Offline speech recognition confirmed; no cloud ASR service is used.'
          : r.model ? 'Transcription unavailable until the model is installed and initialized.'
          : 'Download or import the free speech model in the installed desktop application.'}</p>
        {(r.downloading || r.model?.state === 'downloading') && <>
          <progress aria-label="Model download progress" value={progress ?? undefined} max={100} />
          <small>{progress === null ? 'Download size unavailable' : `${progress}% · ${((r.model?.downloadedBytes ?? 0)/1048576).toFixed(1)} / ${((r.model?.totalBytes ?? 0)/1048576).toFixed(1)} MiB`}</small>
        </>}
        <details className="dt-advanced-model"><summary>Advanced model controls · import / repair / cancel</summary><div className="dt-actions">
          <button className="dt-btn" onClick={() => void r.check()} disabled={r.checking || r.downloading}><RefreshCw size={12}/> Check again</button>
          {r.downloading && r.canCancel && <button className="dt-btn" onClick={() => void r.cancel()}>Cancel download</button>}
          {r.canImport && <button className="dt-btn" disabled={r.downloading || r.checking} onClick={() => void r.importModel()}>Import official model</button>}
          {r.canRepair && <button className="dt-btn" disabled={r.downloading || r.checking} onClick={() => void r.repair()}>Repair model</button>}
          {r.canDownload && !r.ready && <button className="dt-btn" disabled={r.downloading || r.checking} onClick={() => void r.download()}><Download size={12}/> Download free speech model</button>}
        </div></details>
      </div>
      {r.runtimeError && <p role="alert" className="dt-alert">{r.runtimeError}</p>}
      <div className="dt-feature"><b>Desktop Lite · No AI summaries</b><p>Local X-ASR, interview guides, researcher notes, human review and TXT/Markdown/DOCX exports. No account or API key required.</p></div>
      <p className="dt-fine">Notebook text and audio are stored locally and are not encrypted or synchronized. Export JSON and WAV files separately. PDF/DOCX reference extraction and combined audio backup remain pending.</p>
    </section>
  );
}
