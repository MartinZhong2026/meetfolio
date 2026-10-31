import { Download, RefreshCw, ShieldCheck } from 'lucide-react';
import type { useLocalRuntime } from './useLocalRuntime';
export function ModelCard({ runtime: r }: { runtime: ReturnType<typeof useLocalRuntime> }) {
  const progress = r.model?.totalBytes && r.model.downloadedBytes !== undefined
    ? Math.max(0, Math.min(100, Math.round(r.model.downloadedBytes / r.model.totalBytes * 100))) : null;
  return (
    <section className="dt-card dt-model-card" aria-label="Local transcription and model">
      <div className="dt-eyebrow">ON YOUR DEVICE</div>
      <h2>Offline speech model</h2>
      <p className="dt-muted">The installed desktop runtime must verify the model and microphone before transcription.</p>
      <p className="dt-fine">The first model download connects to the official GitHub release. You can also import the official archive. Speech recognition runs on this device.</p>
      <div className="dt-model-box">
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
        <div className="dt-actions">
          <button className="dt-btn" onClick={() => void r.check()} disabled={r.checking || r.downloading}><RefreshCw size={12}/> Check again</button>
          {r.downloading && r.canCancel && <button className="dt-btn" onClick={() => void r.cancel()}>Cancel download</button>}
          {r.canImport && <button className="dt-btn" disabled={r.downloading || r.checking} onClick={() => void r.importModel()}>Import official model</button>}
          {r.canRepair && <button className="dt-btn" disabled={r.downloading || r.checking} onClick={() => void r.repair()}>Repair model</button>}
          {r.canDownload && !r.ready && <button className="dt-btn" disabled={r.downloading || r.checking} onClick={() => void r.download()}><Download size={12}/> Download free speech model</button>}
        </div>
      </div>
      {r.runtimeError && <p role="alert" className="dt-alert">{r.runtimeError}</p>}
      <div className="dt-feature"><b>Desktop Lite · No AI summaries</b><p>Local X-ASR, interview guides, researcher notes, human review and TXT/Markdown/DOCX exports. No account or API key required.</p></div>
      <p className="dt-fine">Notebook text and audio are stored locally and are not encrypted or synchronized. Export JSON and WAV files separately. PDF/DOCX reference extraction and combined audio backup remain pending.</p>
    </section>
  );
}
