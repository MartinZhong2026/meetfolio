import { useState } from 'react';
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
  const [search, setSearch] = useState('');
  const manual = i.manualDraft;
  return (
    <>
      <section className="dt-recorder" aria-label="Recording controls">
        <div className="dt-recorder-left">
          <span
            className={`dt-record-dot ${i.recording === 'recording' ? 'recording' : ''}`}
          />
          <div>
            <h1 className="dt-live-title" tabIndex={-1}>{i.title} {i.participant && <small>· {i.participant}</small>}</h1>
            <strong>{fmtClock(i.elapsedMs)}</strong>
            <p role="status" data-testid="desktop-recording-status">
              {i.synthetic
                ? `DEMO · ${i.recording === 'recording' ? 'Demo running' : i.recording === 'paused' ? 'Demo paused' : 'Sample timeline (not real audio)'}`
                : recordingLabels[i.recording]}
            </p>
          </div>
        </div>
        <div className="dt-actions">
          <span className={`dt-chip ${!runtime.ready ? 'warning' : ''}`}>
            {i.synthetic
              ? 'DEMO · No speech recognition'
              : runtime.ready
                ? 'X-ASR Ready · Offline'
                : 'Local model not ready'}
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
              {i.recording === 'recording' ? 'Pause simulation' : 'Start simulation'}
            </button>
          ) : i.recording === 'recording' ? (
            <button className="dt-btn" disabled={runtime.settling} onClick={() => void runtime.stop(i.id)}>
              <Pause size={14} />
              Pause transcription
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
              {i.recording === 'interrupted'
                ? 'Check device and resume'
                : 'Start transcription'}
            </button>
          )}
          <button
            className="dt-btn primary"
            disabled={i.recording === 'starting' || runtime.settling}
            onClick={() => void finish()}
          >
            Finish & review <ArrowRight size={15} />
          </button>
        </div>
      </section>
      {!i.synthetic && (
        <div className="dt-capture-info">
          <span>
            Microphone:{' '}
            {
              {
                unknown: 'Not requested',
                requesting: 'Waiting for permission',
                granted: 'Granted by runtime',
                denied: 'Permission denied; allow microphone in system settings',
                unavailable: 'Unavailable; check microphone',
              }[runtime.permission]
            }
          </span>
          <span>
            {i.consent ? 'Recording consent confirmed' : 'Consent not confirmed; manual notes still available'}
          </span>
          {window.meetfolioDesktop?.listRecordings && <span>WAV saved locally · Export audio separately in Local storage & backup info</span>}
          {!runtime.ready && (
            <button className="dt-link" onClick={() => openSettings()}>
              Open Model & Settings
            </button>
          )}
        </div>
      )}
      <div className="dt-columns" data-testid="desktop-columns">
        <section className="dt-panel" aria-label="Interview guide">
          <div className="dt-panel-head">
            <h2>Interview guide</h2>
            <small>
              Covered {i.questions.filter((q) => q.done).length} /{' '}
              {i.questions.length}
            </small>
          </div>
          <div className="dt-panel-body">
            {!i.questions.length && (
              <p className="dt-empty">
                Add questions in Preparation; manual notes are available at any time.
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
                  <small>Question {String(n + 1).padStart(2, '0')}</small>
                  <strong>{q.text}</strong>
                </span>
              </label>
            ))}
            <div className="dt-guide-hint">
              <b>Research reminder</b>
              <p>Listen carefully; follow up naturally rather than reading every question mechanically.</p>
            </div>
            {i.reference && (
              <details>
                <summary>Background references · Not participant speech</summary>
              {(i.referenceFiles ?? []).map(f => <details key={f.id}><summary>{f.name} · background</summary><p className="dt-reference">{f.text.slice(0,10000)}</p></details>)}
                <p className="dt-reference">{i.reference}</p>
              </details>
            )}
          </div>
        </section>
        <section className="dt-panel dt-transcript-panel" aria-label="Live transcription">
          <div className="dt-panel-head">
            <h2>Live transcription</h2>
            <small>
              {i.synthetic ? 'Synthetic demo text' : 'Local engine / manual entries'}
            </small>
          </div>
          <label className="dt-search">
            Search transcript
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transcript..."
            />
          </label>
          <div className="dt-panel-body dt-transcript-list">
            {!i.segments.length && (
              <div className="dt-empty">
                <FileText size={30} />
                <h3>Waiting for transcription</h3>
                <p>
                  No transcript yet. Add manual segments or start X-ASR after the model is ready.
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
            {runtime.partial && <div className="dt-partial" data-testid="native-partial" role="status" aria-live="polite"><time>{fmtClock(runtime.partial.startMs)}</time><p>{runtime.partial.text}<span> · Recognizing</span></p></div>}
          </div>
          <details className="dt-manual">
            <summary>Add manual segment (not ASR)</summary>
            <label className="dt-label">
              Manual entry (not ASR output)
              <textarea
                aria-label="Manual entry (not ASR output)"
                value={manual}
                maxLength={200000}
                onChange={(e) => save({ manualDraft: e.target.value })}
                placeholder="Record anything missed by ASR, checking the timestamp..."
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
              Add manual segment
            </button>
          </details>
          <div className="dt-panel-footer">
            Timestamps and original text are preserved <span>☆ Mark important</span>
          </div>
        </section>
        <section className="dt-panel dt-notes-panel" aria-label="Research notes">
          <div className="dt-panel-head">
            <h2>Research notes</h2>
            <small>{i.notes.length} notes</small>
          </div>
          <div className="dt-panel-body">
            {!i.notes.length && (
              <p className="dt-empty">
                Write observations, follow-up questions and research ideas; separate them from participant speech.
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
                      else setMessage('No transcript near this note timestamp.');
                    }}
                  >
                    {fmtClock(n.timestampMs ?? 0)}
                  </button>
                  <span>· {noteCategoryLabel(n.category)}</span>
                  <button
                    aria-label={`Important note ${n.id}`}
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
                  Edit note {n.id}
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
                  Note category {n.id}
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
                      {c.label}
                    </option>
                  ))}
                </select>
              </article>
            ))}
          </div>
          <div className="dt-note-editor">
            <label className="dt-label">
              New research note
              <textarea
                aria-label="New research note"
                value={i.draftNote}
                maxLength={200000}
                onChange={(e) => save({ draftNote: e.target.value })}
                placeholder="Record an observation, follow-up or research idea..."
              />
            </label>
            <label className="dt-label">
              Note category
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
                    {c.label}
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
              Save note
            </button>
            <small>Drafts are saved locally</small>
          </div>
        </section>
      </div>
    </>
  );
}
