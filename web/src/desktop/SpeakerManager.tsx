import { useState } from 'react';
import { Users } from 'lucide-react';
import type { Interview } from './model';
import { useLanguage } from './language';

export function SpeakerManager({ i, save }: { i: Interview; save: (change: Partial<Interview>) => void }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [merging, setMerging] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  // Unlabelled turns are not a separate detected person.
  const speakers = [...new Set(i.segments.map(s => s.speakerLabel).filter((v): v is string => !!v))];
  const unlabeledCount = i.segments.filter(s => !s.speakerLabel).length;

  function closeMerge() {
    setMerging(null);
    setTarget('');
    setConfirming(false);
  }
  function mergeLabels(source: string, into: string) {
    if (!source || !into || source === into || !speakers.includes(source) || !speakers.includes(into)) return;
    // The user chooses the target voice. Never infer that distinct voice labels
    // are the same person and never modify the original audio or transcript text.
    const when = new Date().toISOString();
    save({ segments: i.segments.map(s => s.speakerLabel === source
      ? { ...s, speakerLabel: into, updatedAt: when }
      : s) });
    closeMerge();
  }
  return <section className="dt-speaker-manager" aria-label={t("Speaker management")}>
    <div className="dt-section-title"><Users size={16}/><h3>{t("Speakers")}</h3><span>{speakers.length}</span></div>
    <details className="dt-speaker-help"><summary>{t("About speaker labels")}</summary><p className="dt-fine">{t("Detected voice labels are estimates, not confirmed people. The same person may have several labels in a long interview. Listen to a few turns before merging. Rename or merge labels without re-transcribing. Export a local JSON backup first if you need a way to restore earlier labels.")}</p></details>
    {unlabeledCount > 0 && <p className="dt-fine">{unlabeledCount} unlabeled turn(s) are not counted as speakers. Use the speaker control on an individual turn to assign them.</p>}
    {speakers.map((speaker, n) => <div className="dt-speaker-row" key={speaker}>
      <span className={`dt-speaker-avatar voice-${n % 4}`}>{String(n + 1).padStart(2, '0')}</span>
      {editing === speaker ? <form onSubmit={e => { e.preventDefault(); const label = name.trim(); if (label) { save({ segments: i.segments.map(s => s.speakerLabel === speaker ? { ...s, speakerLabel: label, updatedAt: new Date().toISOString() } : s) }); setEditing(null); } }}>
        <input aria-label={`Rename ${speaker}`} value={name} maxLength={200} onChange={e => setName(e.target.value)} autoFocus/>
        <button className="dt-small-btn" type="submit">{t("Save name")}</button><button className="dt-small-btn" type="button" onClick={() => setEditing(null)}>{t("Cancel")}</button>
      </form> : <><div><strong>{speaker}</strong><small>{i.segments.filter(s => s.speakerLabel === speaker).length} {t('turns')}</small></div><button className="dt-small-btn" aria-label={`Rename ${speaker} throughout interview`} onClick={() => { closeMerge(); setEditing(speaker); setName(speaker); }}>{t("Rename")}</button>
        {speakers.length > 1 && <button className="dt-small-btn" aria-label={`Merge ${speaker} into another speaker`} onClick={() => { setEditing(null); setMerging(speaker); setTarget(''); setConfirming(false); }}>{t("Merge")}</button>}
      </>}
      {merging === speaker && <div className="dt-speaker-merge">
        <label className="dt-label">Merge {speaker} into
          <select aria-label={`Target speaker for ${speaker}`} value={target} onChange={e => { setTarget(e.target.value); setConfirming(false); }}>
            <option value="">{t("Select the same person's correct label")}</option>
            {speakers.filter(value => value !== speaker).map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        {!confirming ? <div className="dt-actions">
          <button type="button" className="dt-small-btn" disabled={!target} onClick={() => setConfirming(true)}>{t("Review merge")}</button>
          <button type="button" className="dt-small-btn" onClick={closeMerge}>{t("Cancel merge")}</button>
        </div> : <>
          <p className="dt-fine" role="status">Change all {i.segments.filter(s => s.speakerLabel === speaker).length} {t('turns')} labelled {speaker} to {target} throughout this interview. Original words, timestamps, WAV files and edits remain unchanged. Speaker labels cannot be automatically undone.</p>
          <div className="dt-actions">
            <button type="button" className="dt-btn" onClick={() => mergeLabels(speaker, target)}>{t("Confirm merge")}</button>
            <button type="button" className="dt-small-btn" onClick={closeMerge}>{t("Cancel merge")}</button>
          </div>
        </>}
      </div>}
    </div>)}
    {!speakers.length && <p className="dt-muted">{t("No voices labelled yet. You can assign speakers on individual transcript turns.")}</p>}
  </section>;
}
