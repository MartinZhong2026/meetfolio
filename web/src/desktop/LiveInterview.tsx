import { useState } from 'react';
import { useLanguage } from './language';
import { ArrowRight, Pause, Play, FileText, Star } from 'lucide-react';
import type { Interview } from './model';
import type { Segment, NoteCategory } from '../lib/types';
import { uuid, fmtClock, effectiveText } from '../lib/format';
import { NOTE_CATEGORIES, noteCategoryLabel } from './englishNotes';
import { TranscriptSegment } from './Transcript';
import { jump, type LiveProps } from './editor';
const recordingLabels: Record<Interview['recording'], string> = {
  idle: 'Not started',
  starting: 'Starting mic and model',
  recording: 'Transcribing locally',
  paused: 'Paused',
  interrupted: 'Recording interrupted',
  ended: 'Ended',
};
export function LiveInterview({
  i,
  save,
  setMessage,
  runtime,
  finish,
  patch,
  openSettings,
  segmentChange,
}: LiveProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  // The live transcript is the primary surface; guide and notes are optional panels.
  const [guideVisible, setGuideVisible] = useState(false);
  const [notesVisible, setNotesVisible] = useState(true);
  const manual = i.manualDraft;
  return (
    <>
      <section className="dt-recorder" aria-label={t("Recording controls")}>
        <div className="dt-recorder-left">
          <span
            className={`dt-record-dot ${i.recording === 'recording' ? 'recording' : ''}`}
          />
          <div>
            <h1 className="dt-live-title" tabIndex={-1}>{i.title} {i.participant && <small>· {i.participant}</small>}</h1>
            <strong>{fmtClock(i.elapsedMs)}</strong>
            <p role="status" data-testid="desktop-recording-status">
              {i.synthetic
                ? `DEMO · ${t(i.recording === 'recording' ? 'Demo running' : i.recording === 'paused' ? 'Demo paused' : 'Sample timeline (not real audio)')}`
                : t(recordingLabels[i.recording])}
            </p>
          </div>
        </div>
        <div className="dt-actions">
          <span className={`dt-chip ${!runtime.ready ? 'warning' : ''}`}>
            {t(i.synthetic ? 'DEMO · No speech recognition' : runtime.ready ? 'X-ASR Ready · Offline' : 'Local model not ready')}
          </span>
          {i.synthetic ? (
            <button
              className="dt-btn"
              onClick={() =>
                save({
                  recording:
                    i.recording === 'recording' ? 'paused' : 'recording',
                })
              }
            >
              {i.recording === 'recording' ? (
                <Pause size={14} />
              ) : (
                <Play size={14} />
              )}
              {t(i.recording === 'recording' ? 'Pause simulation' : 'Start simulation')}
            </button>
          ) : i.recording === 'recording' ? (
            <button className="dt-btn" disabled={runtime.settling} onClick={() => void runtime.stop(i.id)}>
              <Pause size={14} />
              {t("Pause transcription")}
            </button>
          ) : (
            <button
              className="dt-btn"
              disabled={
                !runtime.ready ||
                runtime.checking ||
                !i.consent ||
                i.recording === 'starting'
                || runtime.settling
              }
              onClick={() => void runtime.start(i)}
            >
              <Play size={14} />
              {t(i.recording === 'interrupted' ? 'Check device and resume' : 'Start transcription')}
            </button>
          )}
          <button
            className="dt-btn primary"
            disabled={i.recording === 'starting' || runtime.settling}
            onClick={() => void finish()}
          >
            {t("Finish & review")} <ArrowRight size={15} />
          </button>
        </div>
      </section>
      {!i.synthetic && (
        <div className="dt-capture-info">
          <span>
            {t('Microphone:')}{' '}
            {t(
              {
                unknown: 'Not requested',
                requesting: 'Waiting for permission',
                granted: 'Granted by runtime',
                denied: 'Permission denied; allow microphone in system settings',
                unavailable: 'Unavailable; check microphone',
              }[runtime.permission])
            }
          </span>
          <span>
            {t(i.consent ? 'Recording consent confirmed' : 'Consent not confirmed; manual notes still available')}
          </span>
          {window.meetfolioDesktop?.listRecordings && <span>{t("WAV saved locally · Export audio separately in Local storage & backup info")}</span>}
          {!runtime.ready && (
            <button className="dt-link" onClick={() => openSettings()}>
              {t("Open Model & Settings")}
            </button>
          )}
        </div>
      )}
      <div className="dt-live-layout-controls" role="group" aria-label={t("Live workspace layout")}>
        <button className="dt-small-btn" aria-pressed={guideVisible} onClick={() => setGuideVisible(value => !value)}>{t(guideVisible ? 'Hide interview guide' : 'Show interview guide')}</button>
        <button className="dt-small-btn" aria-pressed={notesVisible} onClick={() => setNotesVisible(value => !value)}>{t(notesVisible ? 'Hide research notes' : 'Show research notes')}</button>
        <button className="dt-small-btn" onClick={() => { setGuideVisible(false); setNotesVisible(false); }}>{t("Focus on transcript")}</button>
      </div>
      <div className={`dt-columns ${guideVisible ? 'with-guide' : 'without-guide'} ${notesVisible ? 'with-notes' : 'without-notes'}`} data-testid="desktop-columns">
        {guideVisible && <section className="dt-panel" aria-label={t("Interview guide")}>
          <div className="dt-panel-head">
            <h2>{t("Interview guide")}</h2>
            <small>
              {t('Covered')} {i.questions.filter((q) => q.done).length} /{' '}
              {i.questions.length}
            </small>
          </div>
          <div className="dt-panel-body">
            {!i.questions.length && (
              <p className="dt-empty">
                {t("Add questions in Preparation; manual notes are available at any time.")}
              </p>
            )}
            {i.questions.map((q, n) => (
              <label
                className={`dt-question ${q.done ? 'done' : ''}`}
                key={q.id}
              >
                <input
                  type="checkbox"
                  checked={q.done}
                  onChange={() =>
                    save({
                      questions: i.questions.map((old) =>
                        old.id === q.id ? { ...old, done: !old.done } : old,
                      ),
                    })
                  }
                />
                <span>
                  <small>{t('Question')} {String(n + 1).padStart(2, '0')}</small>
                  <strong>{q.text}</strong>
                </span>
              </label>
            ))}
            <div className="dt-guide-hint">
              <b>{t("Research reminder")}</b>
              <p>{t("Listen carefully; follow up naturally rather than reading every question mechanically.")}</p>
            </div>
            {i.reference && (
              <details>
                <summary>{t('Background references · Not participant speech')}</summary>
              {(i.referenceFiles ?? []).map(f => <details key={f.id}><summary>{f.name} · background</summary><p className="dt-reference">{f.text.slice(0,10000)}</p></details>)}
                <p className="dt-reference">{i.reference}</p>
              </details>
            )}
          </div>
        </section>}
        <section className="dt-panel dt-transcript-panel" aria-label={t("Live transcription")}>
          <div className="dt-panel-head">
            <h2>{t("Live transcription")}</h2>
            <small>
              {t(i.synthetic ? 'Synthetic demo text' : 'Local engine / manual entries')}
            </small>
          </div>
          <label className="dt-search">
            {t("Search transcript")}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Search transcript...")}
            />
          </label>
          <div className="dt-panel-body dt-transcript-list">
            {!i.segments.length && (
              <div className="dt-empty">
                <FileText size={30} />
                <h3>{t("Waiting for transcription")}</h3>
                <p>
                  {t("No transcript yet. Add manual segments or start X-ASR after the model is ready.")}
                </p>
              </div>
            )}
            {i.segments
              .filter((s) => !search || effectiveText(s).includes(search))
              .map((s) => (
                <TranscriptSegment
                  key={s.id}
                  segment={s}
                  onChange={segmentChange}
                />
              ))}
            {runtime.partial && <div className="dt-partial" data-testid="native-partial" role="status" aria-live="polite"><time>{fmtClock(runtime.partial.startMs)}</time><p>{runtime.partial.text}<span> · {t('Recognizing')}</span></p></div>}
          </div>
          <details className="dt-manual">
            <summary>{t("Add manual segment (not ASR)")}</summary>
            <label className="dt-label">
              {t('Manual entry (not ASR output)')}
              <textarea
                aria-label={t("Manual entry (not ASR output)")}
                value={manual}
                maxLength={200000}
                onChange={(e) => save({ manualDraft: e.target.value })}
                placeholder={t("Record anything missed by ASR, checking the timestamp...")}
              />
            </label>
            <button
              className="dt-btn"
              disabled={!manual.trim()}
              onClick={() => {
                const now = new Date().toISOString();
                patch(i.id, (current) => ({
                  ...current,
                  manualDraft: '',
                  segments: [
                    ...current.segments,
                    {
                      id: uuid(),
                      seq:
                        Math.max(0, ...current.segments.map((s) => s.seq)) + 1,
                      originalText: manual,
                      editedText: null,
                      startMs: current.elapsedMs,
                      endMs: current.elapsedMs,
                      speakerLabel: 'Manual entry',
                      isImportant: false,
                      source: 'manual',
                      updatedAt: now,
                    },
                  ],
                }));
              }}
            >
              {t("Add manual segment")}
            </button>
          </details>
          <div className="dt-panel-footer">
            {t('Timestamps and original text are preserved')} <span>{t('☆ Mark important')}</span>
          </div>
        </section>
        {notesVisible && <section className="dt-panel dt-notes-panel" aria-label={t("Research notes")}>
          <div className="dt-panel-head">
            <h2>{t("Research notes")}</h2>
            <small>{i.notes.length} {t('notes')}</small>
          </div>
          <div className="dt-panel-body">
            {!i.notes.length && (
              <p className="dt-empty">
                {t('Write observations, follow-up questions and research ideas; separate them from participant speech.')}
              </p>
            )}
            {i.notes.map((n) => (
              <article
                className={`dt-note ${n.category === 'finding' ? 'gold' : ''}`}
                key={n.id}
              >
                <div className="dt-note-meta">
                  <button
                    className="dt-link"
                    onClick={() => {
                      const nearest = i.segments.reduce<Segment | null>(
                        (best, s) =>
                          s.startMs <= (n.timestampMs ?? 0) &&
                          (!best || s.startMs > best.startMs)
                            ? s
                            : best,
                        null,
                      );
                      if (nearest) jump(`seg-${nearest.seq}`);
                      else setMessage(t('No transcript near this note timestamp.'));
                    }}
                  >
                    {fmtClock(n.timestampMs ?? 0)}
                  </button>
                  <span>· {t(noteCategoryLabel(n.category))}</span>
                  <button
                    aria-label={`${t('Important note')} ${n.id}`}
                    aria-pressed={n.isImportant}
                    onClick={() =>
                      save({
                        notes: i.notes.map((old) =>
                          old.id === n.id
                            ? { ...old, isImportant: !old.isImportant }
                            : old,
                        ),
                      })
                    }
                  >
                    <Star
                      size={12}
                      fill={n.isImportant ? 'currentColor' : 'none'}
                    />
                  </button>
                </div>
                <label className="dt-sr-only" htmlFor={`note-edit-${n.id}`}>
                  {t('Edit note')} {n.id}
                </label>
                <textarea
                  id={`note-edit-${n.id}`}
                  value={n.content}
                  maxLength={200000}
                  onChange={(e) =>
                    save({
                      notes: i.notes.map((old) =>
                        old.id === n.id
                          ? {
                              ...old,
                              content: e.target.value,
                              updatedAt: new Date().toISOString(),
                            }
                          : old,
                      ),
                    })
                  }
                />
                <label className="dt-sr-only" htmlFor={`note-category-${n.id}`}>
                  {t('Note category')} {n.id}
                </label>
                <select
                  id={`note-category-${n.id}`}
                  value={n.category}
                  onChange={(e) =>
                    save({
                      notes: i.notes.map((old) =>
                        old.id === n.id
                          ? {
                              ...old,
                              category: e.target.value as NoteCategory,
                            }
                          : old,
                      ),
                    })
                  }
                >
                  {NOTE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {t(c.label)}
                    </option>
                  ))}
                </select>
              </article>
            ))}
          </div>
          <div className="dt-note-editor">
            <label className="dt-label">
              {t("New research note")}
              <textarea
                aria-label={t("New research note")}
                value={i.draftNote}
                maxLength={200000}
                onChange={(e) => save({ draftNote: e.target.value })}
                placeholder={t("Record an observation, follow-up or research idea...")}
              />
            </label>
            <label className="dt-label">
              {t("Note category")}
              <select
                value={i.draftCategory}
                onChange={(e) =>
                  save({
                    draftCategory: e.target.value as NoteCategory,
                  })
                }
              >
                {NOTE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {t(c.label)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="dt-btn primary"
              disabled={!i.draftNote.trim()}
              onClick={() => {
                const now = new Date().toISOString();
                patch(i.id, (current) => ({
                  ...current,
                  notes: [
                    ...current.notes,
                    {
                      id: uuid(),
                      category: current.draftCategory,
                      content: current.draftNote,
                      isImportant: false,
                      timestampMs: current.elapsedMs,
                      createdAt: now,
                      updatedAt: now,
                    },
                  ],
                  draftNote: '',
                }));
              }}
            >
              {t("Save note")}
            </button>
            <small>{t("Drafts are saved locally")}</small>
          </div>
        </section>}
      </div>
    </>
  );
}
