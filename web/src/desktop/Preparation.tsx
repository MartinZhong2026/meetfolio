import { ArrowRight, FileText, Trash2, Upload } from 'lucide-react';
import { ModelCard } from './ModelCard';
import type { PreparationProps } from './editor';
import { uuid } from '../lib/format';
import { useLanguage } from './language';

export function Preparation({ i, save, setMessage, runtime, go, create, interviewCount }: PreparationProps) {
  const { t } = useLanguage();
  return (
    <div className="dt-prep-grid">
      <section className="dt-card">
        <div className="dt-eyebrow">{t("BEFORE THE INTERVIEW")}</div>
        <h2>{t("Interview details")}</h2>
        <p className="dt-muted">{t("Prepare a topic, participant and guide. Confirm informed consent before recording.")}</p>
        <label className="dt-label">{t("Interview topic")}
          <input aria-label={t("Interview topic")} value={i.title} maxLength={500}
            onChange={e => save({ title: e.target.value })} placeholder={t("e.g. Caregiver interview")} />
        </label>
        <label className="dt-label">{t("Participant (name, role or anonymous ID)")}
          <input aria-label={t("Participant (name, role or anonymous ID)")} value={i.participant} maxLength={200}
            onChange={e => save({ participant: e.target.value })} placeholder={t("e.g. P07 or Dr. Smith")} />
        </label>
        <label className="dt-label">{t("Interview guide (one question per line)")}
          <textarea aria-label={t("Interview guide (one question per line)")} value={i.guide} maxLength={200000}
            onChange={e => save({ guide: e.target.value })}
            placeholder={t("1. Could you describe your typical day?")} />
        </label>
        <details>
          <summary>{t("Research memo & references · Not participant speech")}</summary>
          <label className="dt-label">{t("Research memo (manual)")}
            <textarea aria-label={t("Research memo (manual)")} value={i.reference} maxLength={200000}
              onChange={e => save({ reference: e.target.value })} />
          </label>
          <label className="dt-file-label">
            <span className="dt-btn"><Upload size={14} /> {t("Import local TXT / Markdown files")}</span>
            <input type="file" multiple accept=".txt,.md,text/plain,text/markdown" aria-label={t("Import local TXT or Markdown")}
              onChange={async e => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                const refs = [...(i.referenceFiles ?? [])];
                for (const file of files) {
                  try {
                    if (refs.length >= 8) throw new Error(t('Maximum 8 reference files per interview.'));
                    const suffix = file.name.split('.').pop()?.toLowerCase();
                    if (suffix !== 'txt' && suffix !== 'md') throw new Error('Only .txt and .md are supported in this recovery build.');
                    if (file.size > 6 * 1024 * 1024) throw new Error(t('File exceeds 6 MB.'));
                    const text = await file.text();
                    if (!text.trim() || text.length > 100000 || text.includes('\0')) throw new Error('No usable text or more than 100,000 characters.');
                    refs.push({ id: uuid(), name: file.name.slice(0,200), kind: suffix, text, addedAt: new Date().toISOString() });
                    save({ referenceFiles: [...refs] });
                  } catch(err) { setMessage(`${file.name}: ${err instanceof Error ? err.message : t('Import failed')}`); }
                }
              }} />
          </label>
          <p className="dt-fine">{t("Files are read on this device; only text is stored in the local notebook. The original file is not uploaded. PDF/DOCX local extraction and OCR are NOT implemented in this recovery stage.")}</p>
          {(i.referenceFiles ?? []).map(file => (
            <div className="dt-reference-row" key={file.id}>
              <FileText size={15} /><div><strong>{file.name}</strong><small>{file.text.length.toLocaleString()} {t('characters · local')}</small></div>
              <button className="dt-icon-button" aria-label={`Remove ${file.name}`} onClick={() => save({ referenceFiles: (i.referenceFiles ?? []).filter(f => f.id !== file.id) })}><Trash2 size={14} /></button>
            </div>
          ))}
        </details>
        <label className="dt-consent"><input type="checkbox" checked={i.consent} onChange={e => save({ consent: e.target.checked })} />
          {t("I have obtained informed recording consent from the participant (required)")}
        </label>
        <div className="dt-actions">
          <button className="dt-btn primary" onClick={() => go('live')}>{t("Start live interview")} <ArrowRight size={15} /></button>
          <button className="dt-btn" disabled={interviewCount >= 100} onClick={() => create(true)}>{t("Load fictional demo")}</button>
        </div>
      </section>
      <ModelCard runtime={runtime} />
    </div>
  );
}
