import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  FolderOpen,
  Grid2X2,
  LockKeyhole,
  Plus,
  Settings2,
  ShieldCheck,
  Upload,
  AudioLines,
} from 'lucide-react';
import { uuid } from '../lib/format';
import type { Segment } from '../lib/types';
import { backup, exportInterview } from './exports';
import { syntheticInterview } from './fixtures';
import {
  newInterview,
  parseNotebook,
  questionsFromGuide,
  recoverNotebook,
  type Interview,
  type Stage,
} from './model';
import { useNotebook } from './persistence';
import { useLocalRuntime } from './useLocalRuntime';
import { ModelCard } from './ModelCard';
import { Preparation } from './Preparation';
import { LiveInterview } from './LiveInterview';
import { ReviewExport } from './ReviewExport';
import { Recordings } from './Recordings';
import { AudioImport } from './AudioImport';
import { appendImportedTranscript } from './importTranscript';
import './desktop.css';

const stageLabels: Record<Stage, string> = {
  prepare: 'Preparation',
  live: 'Live session',
  review: 'Review & export',
};
const headings: Record<Stage, [string, string]> = {
  prepare: ['Preparation', 'PREPARATION'],
  live: ['Live interview', 'INTERVIEW'],
  review: ['Review & export', 'REVIEW'],
};
export default function DesktopApp({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const store = useNotebook();
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [librarySearch, setLibrarySearch] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const patch = useCallback(
    (id: string, change: (i: Interview) => Interview) =>
      store.update((b) => ({
        ...b,
        interviews: b.interviews.map((i) => (i.id === id ? change(i) : i)),
      })),
    [store.update],
  );
  const runtime = useLocalRuntime(patch);
  const i = store.book?.interviews.find((i) => i.id === store.book?.activeId);
  const busy = importBusy || runtime.settling || (!!i && ['starting', 'recording'].includes(i.recording));
  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);
  if (store.readOnly)
    return (
      <main className="dt-blocked">
        <h1>Use one window for editing</h1>
        <p>
          Another window is using this notebook, or your browser does not support safe single-window writes. Use the latest
          Chrome / Edge and close any duplicate windows before trying again.
        </p>
        <button className="dt-btn" onClick={() => location.reload()}>
          Reload
        </button>
      </main>
    );
  if (!store.book || !i)
    return (
      <main className="dt-blocked">
        <h1>Meetfolio · Local research workspace</h1>
        <p role={store.error ? 'alert' : 'status'}>
          {store.error || 'Loading local records...'}
        </p>
        {store.error && (
          <button className="dt-btn" onClick={() => location.reload()}>
            Retry loading
          </button>
        )}
      </main>
    );
  const book = store.book;
  const save = (change: Partial<Interview>) =>
    patch(i.id, (current) => ({ ...current, ...change }));
  const segmentChange = (s: Segment) =>
    patch(i.id, (current) => ({
      ...current,
      segments: current.segments.map((old) =>
        old.id === s.id ? { ...s, updatedAt: new Date().toISOString() } : old,
      ),
    }));
  function go(stage: Stage) {
    if (!i) return;
    if (importBusy) return;
    if (busy && stage !== 'live') {
      setMessage('Pause or finish the recording before changing stages.');
      return;
    }
    if (stage === 'live' && !i.title.trim()) {
      setMessage('Enter a topic or load the clearly labeled fictional demo first.');
      return;
    }
    save({ stage, questions: questionsFromGuide(i.guide, i.questions) });
    setSettings(false);
    setImportOpen(false);
    requestAnimationFrame(() => stage === 'live' ? document.querySelector<HTMLElement>('.dt-live-title')?.focus() : heading.current?.focus());
  }
  function create(synthetic = false) {
    if (busy) return;
    const next = synthetic ? syntheticInterview() : newInterview();
    store.update((b) => ({
      ...b,
      activeId: next.id,
      interviews: [next, ...b.interviews],
    }));
    setSettings(false);
    setImportOpen(false);
    setMessage(
      synthetic
        ? 'Fictional demo loaded; no real microphone or speech recognition used.'
        : 'A new local interview was created.',
    );
  }
  async function finish() {
    if (!i) return;
    if (i.synthetic) save({ recording: 'ended', stage: 'review' });
    else {
      await runtime.stop(i.id, true);
      patch(i.id, (current) => ({ ...current, stage: 'review' }));
    }
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function doExport(format: 'txt' | 'md' | 'docx') {
    if (!i) return;
    setExporting(true);
    try {
      await exportInterview(i, format);
      setMessage(
        `Exported ${format.toUpperCase()}. Keep research files secure.`,
      );
    } catch {
      setMessage('Export failed. Retry or save a JSON backup first.');
    } finally {
      setExporting(false);
    }
  }
  async function importBackup(file: File | undefined) {
    if (!file || busy) return;
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error('Backup exceeds 8 MB. Use the original notebook to split records.');
      const incoming = recoverNotebook(
        parseNotebook(JSON.parse(await file.text())),
      ).book;
      // Restore as copies; never overwrite existing local interviews.
      const copies = incoming.interviews.map((old) => ({
        ...old,
        id: uuid(),
        title: `${old.title || 'Untitled interview'} (restored copy)`,
      }));
      if (copies.length + book.interviews.length > 100)
        throw new Error('Import would exceed the 100-interview limit; nothing was restored.');
      store.update((b) => ({
        ...b,
        activeId: copies[0].id,
        interviews: [...copies, ...b.interviews],
      }));
      setMessage('Backup restored as copies. Existing interviews were not overwritten.');
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'Backup not supported. Existing records were not changed.',
      );
    }
    if (fileInput.current) fileInput.current.value = '';
  }
  return (
    <div className={`dt-app stage-${i.stage}${settings ? ' view-settings' : importOpen ? ' view-import' : ''}`}>
      <a className="dt-skip" href="#desktop-main">
        Skip to main content
      </a>
      <aside className="dt-rail" aria-label="Interview navigation">
        <a className="dt-brand" href={standalone ? '/' : '/desktop'}>
          <span>
            <BookOpen size={22} />
          </span>
          <div>
            <strong>Meetfolio</strong>
            <small>RESEARCH WORKSPACE</small>
          </div>
        </a>
        <p className="dt-nav-meta">Personal workspace</p>
        <button
          className={`dt-nav${!settings && !importOpen ? ' active' : ''}`}
          disabled={busy}
          onClick={() => {
            setSettings(false);
            setImportOpen(false);
            setMessage('Recent local interviews are listed below.');
          }}
        >
          <Grid2X2 size={17} />
          My interviews
        </button>
        <button
          className={`dt-nav${importOpen && !settings ? ' active' : ''}`}
          disabled={busy}
          onClick={() => { setSettings(false); setImportOpen(true); }}
        >
          <AudioLines size={18} />
          Import audio
        </button>
        <button
          className="dt-nav"
          disabled={busy || book.interviews.length >= 100}
          onClick={() => create()}
        >
          <Plus size={18} />
          New interview
        </button>
        <button
          className="dt-nav"
          disabled={busy}
          onClick={() => {
            go('prepare');
            setMessage('Research references are stored locally and are not participant speech.');
          }}
        >
          <FolderOpen size={17} />
          Memos & references
        </button>
        <label className="dt-library-search"><span>Search local interviews</span>
          <input aria-label="Search interviews" type="search" value={librarySearch}
            onChange={e => setLibrarySearch(e.target.value)} placeholder="Title, transcript or notes" />
        </label>
        <p className="dt-nav-meta recent-label">Recent interviews · local</p>
        <div className="dt-recents">
          {book.interviews.filter(item => {
            const q = librarySearch.trim().toLocaleLowerCase();
            return !q || [item.title, item.participant, ...item.segments.map(s => s.editedText ?? s.originalText),
              ...item.notes.map(n => n.content), ...(item.referenceFiles ?? []).map(f => f.name)]
              .some(text => text.toLocaleLowerCase().includes(q));
          }).map((item) => (
            <button
              key={item.id}
              className={item.id === i.id ? 'selected' : ''}
              disabled={busy}
              onClick={() => {
                store.update((b) => ({ ...b, activeId: item.id }));
                setSettings(false);
                setImportOpen(false);
              }}
            >
              <strong>
                {item.synthetic ? 'DEMO · ' : ''}
                {item.title || 'Untitled interview'}
              </strong>
              <small>
                {new Date(item.createdAt).toLocaleDateString('zh-CN')} ·{' '}
                {stageLabels[item.stage]}
              </small>
            </button>
          ))}
        </div>
        <div className="dt-rail-bottom">
          <button
            className="dt-nav"
            disabled={busy}
            onClick={() => setSettings((v) => !v)}
          >
            <Settings2 size={16} />
            Model & Settings
          </button>
          <small>
            {runtime.ready
              ? 'Offline model verified'
              : 'Local speech runtime · Not ready'}
          </small>
          <span>
            <LockKeyhole size={12} />
            Local records · No sign-in
          </span>
          {standalone ? (
            <small>The historical server prototype is a separate application</small>
          ) : (
            <a href="/meetings">Open historical server prototype ↗</a>
          )}
        </div>
      </aside>
      <div className="dt-workspace">
        <header className="dt-top">
          <div>
            My research <span>/</span> Local interviews <span>/</span>{' '}
            <b>{i.participant || 'Preparing'}</b>
          </div>
          <div className="dt-top-status">
            <span
              data-testid="desktop-save-status"
              role="status"
              className={store.dirty ? 'warning' : ''}
            >
              {store.error
                ? 'Not saved'
                : store.dirty
                  ? 'Saving locally...'
                  : 'Saved locally'}
            </span>
            <span>{online ? 'Local workspace' : 'Offline · Local workspace'}</span>
            <span className="dt-avatar" aria-label="No account required">
              M
            </span>
          </div>
        </header>
        <main id="desktop-main" className="dt-body">
          <div className="dt-heading">
            <div>
              <div className="dt-eyebrow">{headings[i.stage][1]}</div>
              <h1 ref={heading} tabIndex={-1}>
                {settings ? 'Models & local storage' : importOpen ? 'Import a recording' : headings[i.stage][0]}
              </h1>
              <p>
                {i.title || 'New research interview'}{' '}
                {i.participant ? `· Participant ${i.participant}` : ''}{' '}
                {i.synthetic
                  ? '· DEMO / synthetic · Fictional data, no recording or AI calls'
                  : ''}
              </p>
            </div>
            <div className="dt-actions">
              {i.stage === 'prepare' ? (
                <button className="dt-btn primary" onClick={() => go('live')}>
                  Start live interview <ArrowRight size={15} />
                </button>
              ) : i.stage === 'live' ? (
                <button className="dt-btn" disabled={busy} onClick={() => go('prepare')}>View interview guide</button>
              ) : (
                <>
                  <button className="dt-btn" onClick={() => go('live')}>
                    ← Back to transcript
                  </button>
                  <button
                    className="dt-btn primary"
                    disabled={exporting}
                    onClick={() => void doExport('md')}
                  >
                    Export research record <ArrowDownToLine size={15} />
                  </button>
                </>
              )}
            </div>
          </div>
          <nav className="dt-stages" aria-label="Interview stages">
            {(['prepare', 'live', 'review'] as Stage[]).map((stage, n) => (
              <button
                key={stage}
                onClick={() => go(stage)}
                aria-current={i.stage === stage ? 'step' : undefined}
                disabled={importBusy || (busy && stage !== 'live')}
              >
                <span>0{n + 1}</span>
                {stageLabels[stage]}
              </button>
            ))}
          </nav>
          {store.error && (
            <div className="dt-alert" role="alert">
              {store.error}
              <button className="dt-btn" onClick={store.retrySave}>
                Retry saving
              </button>
              <button className="dt-btn" onClick={() => void backup(book).catch(() => setMessage('Backup failed. Please retry.'))}>
                Export JSON backup now
              </button>
            </div>
          )}
          {(store.recovered || i.interruption) && (
            <div className="dt-alert" role="status">
              <b>Recovery & missing-data notice</b>
              <p>
                {i.interruption ||
                  'Interrupted interview recovered. Review recent saved text; missing audio may not be recoverable.'}
              </p>
            </div>
          )}
          {importOpen && !settings ? <AudioImport key={i.id} i={i} ready={runtime.ready} onBusy={setImportBusy} onClose={() => setImportOpen(false)} onDone={(segments, durationMs, name) => {
            patch(i.id, current => appendImportedTranscript(current, segments, durationMs, name));
            setImportOpen(false); setMessage(`Imported ${name}: ${segments.length} transcript segments. Review text, speaker labels and audio before using them as evidence.`);
          }}/> : settings ? (
            <div className="dt-prep-grid">
              <ModelCard runtime={runtime} />
              <section className="dt-card">
                <div className="dt-eyebrow">YOUR DATA / YOUR CHOICE</div>
                <h2>Backup & restore</h2>
                <p className="dt-muted">
                  Local records are neither encrypted nor synchronized. Export JSON
                  to preserve interview details, categories, transcript edits and drafts.
                </p>
                <div className="dt-actions">
                  <button
                    className="dt-btn primary"
                    onClick={() => void backup(book).catch(() => setMessage('Backup failed. Please retry.'))}
                  >
                    <ArrowDownToLine size={14} />
                    Export JSON backup
                  </button>
                  <button
                    className="dt-btn"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload size={14} />
                    Restore JSON backup
                  </button>
                </div>
                <p className="dt-fine">
                  Restoration creates local copies without overwriting existing interviews. Maximum JSON backup size:
                  8 MB. JSON contains text and audio identifiers only, never WAV files. Export WAVs separately below. Store backups securely.
                </p>
                <div className="dt-feature">
                  <b>Current recovery build limitations</b>
                  <p>
                    Combined audio backup and PDF / DOCX extraction are not restored here. Previous
                    server-backed AI experiments remain outside this local desktop recovery stage.
                  </p>
                  {standalone ? (
                    <p>The historical web server must be operated separately.</p>
                  ) : (
                    <a className="dt-btn" href="/meetings">
                      Open historical server prototype ↗
                    </a>
                  )}
                </div>
              </section>
              <Recordings key={i.id} interviewId={i.id} onRecoverTranscript={segments => {
                patch(i.id, current => appendImportedTranscript(current, segments, Math.max(0, ...segments.map(s => s.endMs))));
                setMessage('Recovered saved import text. Existing segment edits were preserved.');
              }}/>
            </div>
          ) : i.stage === 'prepare' ? (
            <><section className="dt-source-choice" aria-label="Choose conversation source"><div><span className="dt-eyebrow">YOUR NEXT CONVERSATION</span><h2>Listen closely. Keep the context.</h2><p>Prepare your research, capture a live conversation, or work from an existing recording.</p></div><button className="dt-btn" disabled={busy} onClick={() => setImportOpen(true)}><AudioLines size={17}/>Import recording</button></section><Preparation
              i={i}
              save={save}
              setMessage={setMessage}
              runtime={runtime}
              go={go}
              create={create}
              interviewCount={book.interviews.length}
            /></>
          ) : i.stage === 'live' ? (
            <LiveInterview
              i={i}
              save={save}
              setMessage={setMessage}
              runtime={runtime}
              finish={finish}
              patch={patch}
              openSettings={() => setSettings(true)}
              segmentChange={segmentChange}
            />
          ) : (
            <ReviewExport
              i={i}
              save={save}
              setMessage={setMessage}
              segmentChange={segmentChange}
              doExport={doExport}
              exporting={exporting}
            />
          )}
          <p className="dt-message" role="status" aria-live="polite">
            {message}
          </p>
          <footer className="dt-footer">
            <span>◆ Meetfolio Desktop · Local research workspace</span>
            <button disabled={busy} onClick={() => setSettings(true)}>
              <ShieldCheck size={12} />
              Local storage & backup info
            </button>
          </footer>
          <input
            className="dt-sr-only"
            aria-label="Import local JSON backup"
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            onChange={(e) => void importBackup(e.target.files?.[0])}
          />
        </main>
      </div>
    </div>
  );
}
