import { useEffect, useState } from 'react';
import { localRuntime, type RecordingInfo } from './runtime';
import { fmtClock } from '../lib/format';
import type { Segment } from '../lib/types';
import { useLanguage } from './language';

/** Audio lives outside JSON/IndexedDB. Keep orphaned files discoverable after notebook restore. */
export function Recordings({ interviewId, onRecoverTranscript }: { interviewId: string; onRecoverTranscript?: (segments: Segment[]) => void }) {
  const { t } = useLanguage();
  const runtime = localRuntime();
  const [items, setItems] = useState<RecordingInfo[]>([]);
  const [all, setAll] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (runtime?.listRecordings) {
      setWorking(true);
      void runtime.listRecordings().then(value => {
        if (!cancelled) setItems(value);
      }).catch(() => {
        if (!cancelled) setMessage(t('Cannot read recording storage. Files have not been deleted; check disk access and retry.'));
      }).finally(() => { if (!cancelled) setWorking(false); });
    }
    return () => { cancelled = true; };
  }, [interviewId, runtime]);
  if (!runtime?.listRecordings) return null;
  async function refresh() {
    setWorking(true); setMessage('');
    try { setItems(await runtime!.listRecordings!()); }
    catch { setMessage(t('Cannot read recording storage. Check disk access and retry.')); }
    finally { setWorking(false); }
  }
  async function action(item: RecordingInfo, recover = false) {
    setWorking(true); setMessage('');
    try {
      if (recover) {
        await runtime!.recoverRecording!(item.id);
        setItems(await runtime!.listRecordings!());
        setMessage(t('Saved audio recovered as interrupted. Original partial audio retained; the missing tail cannot be recreated.'));
      } else {
        const saved = await runtime!.exportRecording!(item.id);
        setMessage(saved ? t('WAV exported. Store it securely alongside the separate JSON notebook backup.') : t('Export cancelled.'));
      }
    } catch {
      setMessage(recover ? t('Recovery incomplete. Original files retained; stop capture, check storage and retry.') : t('Cannot export this recording. It may need recovery first; check storage and retry.'));
    } finally { setWorking(false); }
  }
  const visible = all ? items : items.filter(item => item.interviewId === interviewId);
  return <section className="dt-card" aria-label={t("Local WAV recordings")}>
    <h2>{t("Local WAV recordings")}</h2>
    <p className="dt-muted">{t('Each capture is a separate 16 kHz mono WAV. Paused time is excluded. Interrupted files may be incomplete; listen and verify them before research use.')}</p>
    <p>{t('JSON backups and text exports do not contain audio. Export each WAV separately. Audio is local and unencrypted; combined audio backup is pending.')}</p>
    <div className="dt-actions">
      <button className="dt-btn" disabled={working} onClick={() => void refresh()}>{t("Refresh recordings")}</button>
      <label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> {t('Show all local recordings (including restored or missing interviews)')}</label>
    </div>
    {!visible.length && <p>{t('No saved recordings found for')} {t(all ? 'this profile' : 'this interview')}. {t('Earlier transcripts and demo entries have no audio.')}</p>}
    <ul>{visible.map(item => <li key={item.id}>
      <p><strong>{item.id}</strong><br />{item.createdAt} · {fmtClock(item.durationMs)} · {item.bytes.toLocaleString()} bytes · {t(item.status)}<br />{t('Interview')}: {item.interviewId}</p>
      {item.unavailable && <p role="alert">{t('Cannot inspect this recording. Original files retained; other recordings can still be exported.')}</p>}
      <div className="dt-actions">
        <button className="dt-btn" disabled={working || item.status === 'recording' || item.recoverable || item.unavailable} onClick={() => void action(item)}>{t('Export WAV')} {item.id.slice(0, 8)}</button>
        {item.recoverable && <button className="dt-btn" disabled={working} onClick={() => void action(item, true)}>{t('Recover saved audio')} {item.id.slice(0, 8)}</button>}
        {item.interviewId === interviewId && !item.unavailable && runtime.recoverAudioImport && onRecoverTranscript && <button className="dt-btn" disabled={working || item.status === 'recording' || item.recoverable} onClick={async () => {
          setWorking(true); setMessage('');
          try { onRecoverTranscript(await runtime.recoverAudioImport!({ interviewId, recordingId: item.id })); setMessage(t('Saved import transcript recovered; existing edits preserved.')); }
          catch { setMessage(t('No completed import transcript available for this WAV. The audio is retained and can be exported and imported again.')); }
          finally { setWorking(false); }
        }}>{t('Recover import text')} {item.id.slice(0, 8)}</button>}
      </div>
    </li>)}</ul>
    <p role="status" aria-live="polite">{t(working ? 'Reading or saving local audio…' : message)}</p>
  </section>;
}
