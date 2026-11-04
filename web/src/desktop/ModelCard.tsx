import { Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { confirmedModel, localRuntime } from './runtime';
import type { useLocalRuntime } from './useLocalRuntime';
import { useLanguage } from './language';
export function ModelCard({ runtime: r }: { runtime: ReturnType<typeof useLocalRuntime> }) {
  const { t } = useLanguage();
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
    if (!native) { setSetupError(t('Open the installed desktop app to set up offline transcription.')); return; }
    setSetupBusy(true);
    setSetupError('');
    try {
      if (!confirmedModel(await native.getModelStatus())) {
        if (!r.canDownload) throw new Error(t('Speech model download unavailable.'));
        setSetupPhase(t('Step 1 · Installing the offline speech model'));
        await r.download();
        if (!confirmedModel(await native.getModelStatus())) throw new Error(t('The speech model did not initialize. Retry or use Advanced setup.'));
      }
      if (native.installSpeakerModels && !(await native.getSpeakerStatus?.())?.ready) {
        setSetupPhase(t('Step 2 · Installing offline speaker separation'));
        const speaker = await native.installSpeakerModels();
        if (!speaker.ready) throw new Error(t('Speaker model installation did not finish.'));
        setSpeakerReady(true);
      }
      const currentDecoder = await native.getDecoderStatus?.();
      if (currentDecoder?.supported && !currentDecoder.ready && native.installAudioDecoder) {
        setSetupPhase(t('Step 3 · Installing the optional local long-audio decoder'));
        const result = await native.installAudioDecoder();
        if (!result.ready) throw new Error(t('Audio decoder installation did not finish.'));
        setDecoder(result);
      }
      setSetupPhase(t('Setup complete · Offline transcription is ready'));
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : t('Offline setup incomplete. Existing model files are retained; retry setup.'));
    } finally {
      setSetupBusy(false);
    }
  }
  return (
    <section className="dt-card dt-model-card" aria-label="Local transcription and model">
      <div className="dt-eyebrow">{t("ON YOUR DEVICE")}</div>
      <h2>{t("Offline speech model")}</h2>
      <p className="dt-muted">{t("The installed desktop runtime must verify the model and microphone before transcription.")}</p>
      <p className="dt-fine">{t("The first model download connects to the official GitHub release. You can also import the official archive. Speech recognition runs on this device.")}</p>
      <div className="dt-model-box">
        <div className="dt-unified-setup">
          <h3>{t("One-time offline setup")}</h3>
          <p>{t("One setup installs speech recognition, speaker separation and the optional Windows long-audio decoder. Models are downloaded only after you click. Audio is processed locally. The optional FFmpeg decoder is GPL-licensed and downloaded from its verified upstream source.")}</p>
          <button className="dt-btn primary" disabled={setupBusy || r.downloading || r.checking || allReady || !localRuntime()} onClick={() => void setupOffline()}>
            <Download size={15}/>{t(allReady ? 'Offline transcription ready' : setupBusy ? 'Setting up offline transcription…' : 'Set up offline transcription')}
          </button>
          <p role="status" aria-live="polite">{setupPhase || t(allReady ? 'Speech, speaker and decoder components are ready.' : 'The setup can be retried without deleting previously installed models.')}</p>
          {setupError && <p className="dt-alert" role="alert">{setupError}</p>}
          <p className="dt-fine">{t('X-ASR:')} {t(r.ready ? 'Ready' : 'Not ready')} · {t('Speakers:')} {t(speakerReady ? 'Ready' : 'Not ready')} · {t('Long-audio decoder:')} {t(decoder.supported ? (decoder.ready ? 'Ready' : 'Optional setup required') : 'Built in / not required')}</p>
        </div>
        <div><strong><ShieldCheck size={16}/>{r.ready ? r.model?.modelId : t('Local offline speech model')}</strong>
          <span className={`dt-chip ${!r.ready ? 'warning' : ''}`}>
            {t(r.checking ? 'Checking' : r.downloading || r.model?.state === 'downloading' ? 'Downloading'
              : r.ready ? 'X-ASR Ready · Offline' : r.model?.state === 'loading' ? 'Initializing'
              : r.model?.state === 'error' || r.model?.state === 'download-failed' ? 'Model installation failed' : 'Not installed / pending load')}
          </span></div>
        <p>{t(r.ready ? 'Offline speech recognition confirmed; no cloud ASR service is used.'
          : r.model ? 'Transcription unavailable until the model is installed and initialized.'
          : 'Download or import the free speech model in the installed desktop application.')}</p>
        {(r.downloading || r.model?.state === 'downloading') && <>
          <progress aria-label={t("Model download progress")} value={progress ?? undefined} max={100} />
          <small>{progress === null ? t('Download size unavailable') : `${progress}% · ${((r.model?.downloadedBytes ?? 0)/1048576).toFixed(1)} / ${((r.model?.totalBytes ?? 0)/1048576).toFixed(1)} MiB`}</small>
        </>}
        <details className="dt-advanced-model"><summary>{t("Advanced model controls · import / repair / cancel")}</summary><div className="dt-actions">
          <button className="dt-btn" onClick={() => void r.check()} disabled={r.checking || r.downloading}><RefreshCw size={12}/> {t("Check again")}</button>
          {r.downloading && r.canCancel && <button className="dt-btn" onClick={() => void r.cancel()}>{t("Cancel download")}</button>}
          {r.canImport && <button className="dt-btn" disabled={r.downloading || r.checking} onClick={() => void r.importModel()}>{t("Import official model")}</button>}
          {r.canRepair && <button className="dt-btn" disabled={r.downloading || r.checking} onClick={() => void r.repair()}>{t("Repair model")}</button>}
          {r.canDownload && !r.ready && <button className="dt-btn" disabled={r.downloading || r.checking} onClick={() => void r.download()}><Download size={12}/> {t("Download free speech model")}</button>}
        </div></details>
      </div>
      {r.runtimeError && <p role="alert" className="dt-alert">{r.runtimeError}</p>}
      <div className="dt-feature"><b>{t("Desktop Lite · No AI summaries")}</b><p>{t("Local X-ASR, interview guides, researcher notes, human review and TXT/Markdown/DOCX exports. No account or API key required.")}</p></div>
      <p className="dt-fine">{t("Notebook text and audio are stored locally and are not encrypted or synchronized. Export JSON and WAV files separately. PDF/DOCX reference extraction and combined audio backup remain pending.")}</p>
    </section>
  );
}
