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
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
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
import { LanguageProvider, useLanguage } from './language';
// Huninn is bundled by Vite for offline desktop use (no Google Fonts requests).
import '@fontsource/huninn/400.css';
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
export default function DesktopApp(props: { standalone?: boolean }) {
  return <LanguageProvider><DesktopWorkspace {...props}/></LanguageProvider>;
}
function DesktopWorkspace({ standalone = false }: { standalone?: boolean }) {
  const { t, lang, setLang } = useLanguage();
  const store = useNotebook();
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [librarySearch, setLibrarySearch] = useState('');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const cancelDeletionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (deleteTarget) cancelDeletionRef.current?.focus(); }, [deleteTarget]);
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
        <h1>{t("Use one window for editing")}</h1>
        <p>
          Another window is using this notebook, or your browser does not support safe single-window writes. Use the latest
          Chrome / Edge and close any duplicate windows before trying again.
        </p>
        <button className="dt-btn" onClick={() => location.reload()}>
          {t("Reload")}
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
  const pendingDelete = deleteTarget ? book.interviews.find(entry => entry.id === deleteTarget) : undefined;
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
    setLibraryOpen(false);
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
    setLibraryOpen(false);
    setMessage(
      synthetic
        ? 'Fictional demo loaded; no real microphone or speech recognition used.'
        : 'A new local interview was created.',
    );
  }
  function deleteInterview(targetId: string) {
    if (busy || store.error) {
      setMessage(t('Finish recording and resolve local save errors before deleting.'));
      return;
    }
    const target = book.interviews.find(entry => entry.id === targetId);
    if (!target || ['starting', 'recording'].includes(target.recording)) return;
    store.update(current => {
      const remaining = current.interviews.filter(entry => entry.id !== targetId);
      if (!remaining.length) remaining.push(newInterview());
      return { ...current, interviews: remaining,
        activeId: current.activeId === targetId ? remaining[0].id : current.activeId };
    });
    setDeleteTarget(null);
    setSettings(false);
    setImportOpen(false);
    setLibraryOpen(true);
    setMessage('Interview removed from this notebook. Original WAV files were NOT deleted; find them under Local storage & backup info.');
  }
  function openImport() {
    if (busy || !i) return;
    // Never mix a new audio file into an already populated interview by default.
    // Leave an empty draft in place so a cancelled picker does not create another blank entry.
    const hasContent = i.synthetic || !!i.title.trim() || i.segments.length > 0 ||
      i.notes.length > 0 || !!i.guide.trim() || !!i.reference.trim() ||
      (i.referenceFiles?.length ?? 0) > 0 || i.recording !== 'idle';
    if (hasContent) {
      if (book.interviews.length >= 100) {
        setMessage('100-interview limit reached. Export/backup and remove unused entries before importing a new file.');
        return;
      }
      const next = newInterview();
      store.update(current => ({ ...current, activeId: next.id, interviews: [next, ...current.interviews] }));
      setMessage(t('A separate local interview has been created for the next recording. Previous transcripts remain in My interviews.'));
    }
    setSettings(false);
    setLibraryOpen(false);
    setImportOpen(true);
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
  async function doExport(format: 'txt' | 'md' | 'docx', recordingId?: string) {
    if (!i) return;
    setExporting(true);
    try {
      let scoped = i;
      if (recordingId) {
        const related = i.segments.filter(segment => segment.audio?.recordingId === recordingId);
        if (!related.length) throw new Error('No segments for selected recording.');
        const sources = Array.from(new Set(i.segments.map(segment => segment.audio?.recordingId).filter(Boolean)));
        const sourceNumber = sources.indexOf(recordingId) + 1;
        scoped = { ...i,
          title: `${i.title || 'Interview'} — Recording ${sourceNumber} (${recordingId.slice(0, 8)})`,
          segments: related.map(segment => ({ ...segment, startMs: segment.audio!.startMs, endMs: segment.audio!.endMs })),
          notes: [], draftNote: '', manualDraft: '', reviewText: '', guide: '', questions: [],
          reference: '', referenceFiles: [], interruption: null,
        };
      }
      await exportInterview(scoped, format, recordingId);
      setMessage(`Exported ${recordingId ? 'individual recording ' + recordingId.slice(0, 8) : 'entire interview'} as ${format.toUpperCase()}.`);
    } catch {
      setMessage(t('Export failed. Retry or save a JSON backup first.'));
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
      setMessage(t('Backup restored as copies. Existing interviews were not overwritten.'));
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'Backup not supported. Existing records were not changed.',
      );
    }
    if (fileInput.current) fileInput.current.value = '';
  }
  return (
    <div className={`dt-app stage-${i.stage}${settings ? ' view-settings' : importOpen ? ' view-import' : libraryOpen ? ' view-library' : ''}`}>
      <a className="dt-skip" href="#desktop-main">
        {t("Skip to main content")}
      </a>
      <aside className={`dt-rail${railCollapsed ? ' collapsed' : ''}`} aria-label={t("Interview navigation")}>
        <button type="button" className="dt-rail-toggle" aria-label={t(railCollapsed ? 'Expand navigation' : 'Collapse navigation')} title={t(railCollapsed ? 'Expand navigation' : 'Collapse navigation')} aria-expanded={!railCollapsed} onClick={() => setRailCollapsed(value => !value)}>
          {railCollapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}
        </button>
        <a className="dt-brand" aria-label={railCollapsed ? 'Meetfolio' : undefined} href={standalone ? '/' : '/desktop'}>
          <span>
            <BookOpen size={22} />
          </span>
          <div>
            <strong>Meetfolio</strong>
            <small>RESEARCH WORKSPACE</small>
          </div>
        </a>
        <p className="dt-nav-meta">{t("Personal workspace")}</p>
        <button
          className={`dt-nav${!settings && !importOpen ? ' active' : ''}`}
          aria-label={t("My interviews")} title={t("My interviews")}
          disabled={busy}
          onClick={() => {
            setSettings(false);
            setImportOpen(false);
            setLibraryOpen(true);
            setMessage(t('Select any saved interview to open its transcript and exports.'));
          }}
        >
          <Grid2X2 size={17} />
          <span className="dt-nav-text">{t("My interviews")}</span>
        </button>
        <button
          className={`dt-nav${importOpen && !settings ? ' active' : ''}`}
          aria-label={t("Import audio")} title={t("Import audio")}
          disabled={busy}
          onClick={openImport}
        >
          <AudioLines size={18} />
          <span className="dt-nav-text">{t("Import audio")}</span>
        </button>
        <button
          className="dt-nav"
          aria-label={t("New interview")} title={t("New interview")}
          disabled={busy || book.interviews.length >= 100}
          onClick={() => create()}
        >
          <Plus size={18} />
          <span className="dt-nav-text">{t("New interview")}</span>
        </button>
        <button
          className="dt-nav"
          aria-label={t("Memos & references")} title={t("Memos & references")}
          disabled={busy}
          onClick={() => {
            go('prepare');
            setMessage(t('Research references are stored locally and are not participant speech.'));
          }}
        >
          <FolderOpen size={17} />
          <span className="dt-nav-text">{t("Memos & references")}</span>
        </button>
        <label className="dt-library-search"><span>{t("Search local interviews")}</span>
          <input aria-label={t("Search interviews")} type="search" value={librarySearch}
            onChange={e => setLibrarySearch(e.target.value)} placeholder={t("Title, transcript or notes")} />
        </label>
        <button type="button" className="dt-recent-toggle" aria-controls="dt-recent-interviews" aria-expanded={recentOpen}
          onClick={() => setRecentOpen(value => !value)} title={t(recentOpen ? 'Hide recent interviews' : 'Show recent interviews')}>
          <span>{t("Recent interviews")}</span><span aria-hidden="true">{book.interviews.length} {recentOpen ? '▴' : '▾'}</span>
        </button>
        <div className="dt-recents" id="dt-recent-interviews" hidden={!recentOpen}>
          {book.interviews.filter(item => {
            const q = librarySearch.trim().toLocaleLowerCase();
            return !q || [item.title, item.participant, ...item.segments.map(s => s.editedText ?? s.originalText),
              ...item.notes.map(n => n.content), ...(item.referenceFiles ?? []).map(f => f.name)]
              .some(text => text.toLocaleLowerCase().includes(q));
          }).map((item) => (
            <div className="dt-recent-row" key={item.id}>
              <button
                className={item.id === i.id ? 'selected' : ''}
                disabled={busy}
                onClick={() => {
                  store.update((b) => ({ ...b, activeId: item.id }));
                  setSettings(false);
                  setImportOpen(false);
                  setLibraryOpen(false);
                }}
              >
                <strong>{item.synthetic ? t('DEMO · ') : ''}{item.title || t('Untitled interview')}</strong>
                <small>{new Date(item.createdAt).toLocaleDateString(lang)} · {t(stageLabels[item.stage])}</small>
              </button>
              <button type="button" className="dt-delete-interview" title={t("Delete interview")} aria-label={`${t('Delete interview')} ${item.title || t('Untitled interview')}`} disabled={busy || !!store.error} onClick={() => setDeleteTarget(item.id)}>
                <Trash2 size={15}/>
              </button>
            </div>
          ))}
        </div>
        <div className="dt-rail-bottom">
          <button
            className="dt-nav"
            aria-label={t("Model & Settings")} title={t("Model & Settings")}
            disabled={busy}
            onClick={() => { setLibraryOpen(false); setImportOpen(false); setSettings((v) => !v); }}
          >
            <Settings2 size={16} />
            <span className="dt-nav-text">{t("Model & Settings")}</span>
          </button>
          <small>
            {runtime.ready
              ? 'Offline model verified'
              : 'Local speech runtime · Not ready'}
          </small>
          <span>
            <LockKeyhole size={12} />
            {t("Local records · No sign-in")}
          </span>
          {standalone ? (
            <small>{t("The historical server prototype is a separate application")}</small>
          ) : (
            <a href="/meetings">{t("Open historical server prototype ↗")}</a>
          )}
        </div>
      </aside>
      <div className="dt-workspace">
        <header className="dt-top">
          <div>
            {t('My research')} <span>/</span> {t('Local interviews')} <span>/</span>{' '}
            <b>{i.participant || t('Preparing')}</b>
          </div>
          <div className="dt-top-status">
            <div className="dt-lang-switch" role="group" aria-label={t("Interface language")}>
              <button type="button" lang="zh-CN" aria-pressed={lang === "zh-CN"} onClick={() => setLang("zh-CN")}>中文</button>
              <button type="button" lang="en" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
            </div>
            <span
              data-testid="desktop-save-status"
              role="status"
              className={store.dirty ? 'warning' : ''}
            >
              {t(store.error ? 'Not saved' : store.dirty ? 'Saving locally...' : 'Saved locally')}
            </span>
            <span>{t(online ? 'Local workspace' : 'Offline · Local workspace')}</span>
            <span className="dt-avatar" aria-label={t('No account required')}>
              M
            </span>
          </div>
        </header>
        <main id="desktop-main" className="dt-body">
          <div className="dt-heading">
            <div>
              <div className="dt-eyebrow">{headings[i.stage][1]}</div>
              <h1 ref={heading} tabIndex={-1}>
                {t(libraryOpen ? 'Saved interviews' : settings ? 'Models & local storage' : importOpen ? 'Import a recording' : headings[i.stage][0])}
              </h1>
              <p>
                {libraryOpen ? (lang === 'zh-CN' ? `本地保存 ${book.interviews.length} 份访谈` : `${book.interviews.length} interviews stored locally`) : i.title || t('New research interview')}{' '}
                {i.participant ? (lang === 'zh-CN' ? `· 受访者 ${i.participant}` : `· Participant ${i.participant}`) : ''}{' '}
                {i.synthetic
                  ? t('· DEMO / synthetic · Fictional data, no recording or AI calls')
                  : ''}
              </p>
            </div>
            <div className="dt-actions">
              {libraryOpen ? <button className="dt-btn primary" disabled={busy} onClick={openImport}>{t("Import another recording")}</button> : i.stage === 'prepare' ? (
                <button className="dt-btn primary" onClick={() => go('live')}>
                  {t('Start live interview')} <ArrowRight size={15} />
                </button>
              ) : i.stage === 'live' ? (
                <button className="dt-btn" disabled={busy} onClick={() => go('prepare')}>{t("View interview guide")}</button>
              ) : (
                <>
                  <button className="dt-btn" onClick={() => go('live')}>
                    {t('← Back to transcript')}
                  </button>
                  <button
                    className="dt-btn primary"
                    disabled={exporting}
                    onClick={() => void doExport('md')}
                  >
                    {t('Export research record')} <ArrowDownToLine size={15} />
                  </button>
                </>
              )}
            </div>
          </div>
          {!libraryOpen && <nav className="dt-stages" aria-label={t("Interview stages")}>
            {(['prepare', 'live', 'review'] as Stage[]).map((stage, n) => (
              <button
                key={stage}
                onClick={() => go(stage)}
                aria-current={i.stage === stage ? 'step' : undefined}
                disabled={importBusy || (busy && stage !== 'live')}
              >
                <span>0{n + 1}</span>
                {t(stageLabels[stage])}
              </button>
            ))}
          </nav>}
          {store.error && (
            <div className="dt-alert" role="alert">
              {store.error}
              <button className="dt-btn" onClick={store.retrySave}>
                {t("Retry saving")}
              </button>
              <button className="dt-btn" onClick={() => void backup(book).catch(() => setMessage(t('Backup failed. Please retry.')))}>
                {t("Export JSON backup now")}
              </button>
            </div>
          )}
          {(store.recovered || i.interruption) && (
            <div className="dt-alert" role="status">
              <b>{t("Recovery & missing-data notice")}</b>
              <p>
                {i.interruption ||
                  'Interrupted interview recovered. Review recent saved text; missing audio may not be recoverable.'}
              </p>
            </div>
          )}
          {libraryOpen ? <section className="dt-card dt-library-view" aria-label={t("Saved interviews")}>
            <h2>{t("All saved interviews")}</h2>
            <p className="dt-muted">{t("These records remain on this device. Imported recordings are listed under their file names; older combined interviews may contain more than one WAV.")}</p>
            <label className="dt-label">{t("Find an interview")}
              <input type="search" aria-label={t("Search saved interviews")} value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} placeholder={t("Search title, transcript or notes")} />
            </label>
            <div className="dt-library-list">
              {book.interviews.filter(entry => {
                const query = librarySearch.trim().toLocaleLowerCase();
                return !query || [entry.title, entry.participant, ...entry.segments.map(seg => seg.editedText ?? seg.originalText), ...entry.notes.map(note => note.content)].some(v => v.toLocaleLowerCase().includes(query));
              }).map(entry => {
                const sources = new Set(entry.segments.map(segment => segment.audio?.recordingId).filter(Boolean));
                return <div className="dt-library-row" key={entry.id}>
                  <div><strong>{entry.synthetic ? t('DEMO · ') : ''}{entry.title || t('Untitled interview')}</strong>
                    <small>{new Date(entry.createdAt).toLocaleString(lang)} · {entry.segments.length} {t('segments')} · {sources.size} {t('linked recording(s)')}</small>
                  </div>
                  <button className="dt-btn" disabled={busy} onClick={() => {
                    store.update(current => ({ ...current, activeId: entry.id }));
                    setLibraryOpen(false); setImportOpen(false); setSettings(false);
                  }}>{t(entry.segments.length ? 'Open transcript' : 'Open interview')}</button>
                </div>;
              })}
            </div>
          </section> : importOpen && !settings ? <AudioImport key={i.id} i={i} ready={runtime.ready} onBusy={setImportBusy} onClose={() => setImportOpen(false)} onDone={(segments, durationMs, name, partial) => {
            patch(i.id, current => appendImportedTranscript(current, segments, durationMs, name));
            setLibraryOpen(false); setImportOpen(false); setMessage(partial ? `Recovered ${segments.length} confirmed segments. Transcription is unfinished; return to Import audio to resume.` : `Saved ${name} under My interviews: ${segments.length} transcript segments. Review this transcript or open it later from the saved interview list.`);
          }}/> : settings ? (
            <div className="dt-prep-grid">
              <ModelCard runtime={runtime} />
              <section className="dt-card">
                <div className="dt-eyebrow">{t("YOUR DATA / YOUR CHOICE")}</div>
                <h2>{t("Backup & restore")}</h2>
                <p className="dt-muted">
                  Local records are neither encrypted nor synchronized. Export JSON
                  to preserve interview details, categories, transcript edits and drafts.
                </p>
                <div className="dt-actions">
                  <button
                    className="dt-btn primary"
                    onClick={() => void backup(book).catch(() => setMessage(t('Backup failed. Please retry.')))}
                  >
                    <ArrowDownToLine size={14} />
                    {t("Export JSON backup")}
                  </button>
                  <button
                    className="dt-btn"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload size={14} />
                    {t("Restore JSON backup")}
                  </button>
                </div>
                <p className="dt-fine">
                  Restoration creates local copies without overwriting existing interviews. Maximum JSON backup size:
                  8 MB. JSON contains text and audio identifiers only, never WAV files. Export WAVs separately below. Store backups securely.
                </p>
                <div className="dt-feature">
                  <b>{t("Current recovery build limitations")}</b>
                  <p>
                    Combined audio backup and PDF / DOCX extraction are not restored here. Previous
                    server-backed AI experiments remain outside this local desktop recovery stage.
                  </p>
                  {standalone ? (
                    <p>{t("The historical web server must be operated separately.")}</p>
                  ) : (
                    <a className="dt-btn" href="/meetings">
                      {t("Open historical server prototype ↗")}
                    </a>
                  )}
                </div>
              </section>
              <Recordings key={i.id} interviewId={i.id} onRecoverTranscript={segments => {
                patch(i.id, current => appendImportedTranscript(current, segments, Math.max(0, ...segments.map(s => s.endMs))));
                setMessage(t('Recovered saved import text. Existing segment edits were preserved.'));
              }}/>
            </div>
          ) : i.stage === 'prepare' ? (
            <><section className="dt-source-choice" aria-label={t("Choose conversation source")}><div><span className="dt-eyebrow">{t("YOUR NEXT CONVERSATION")}</span><h2>{t("Listen closely. Keep the context.")}</h2><p>{t("Prepare your research, capture a live conversation, or work from an existing recording.")}</p></div><button className="dt-btn" disabled={busy} onClick={openImport}><AudioLines size={17}/>{t("Import recording")}</button></section><Preparation
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
              openSettings={() => { setLibraryOpen(false); setImportOpen(false); setSettings(true); }}
              segmentChange={segmentChange}
            />
          ) : (
            <ReviewExport
              key={i.id}
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
            <button disabled={busy} onClick={() => { setLibraryOpen(false); setImportOpen(false); setSettings(true); }}>
              <ShieldCheck size={12} />
              {t("Local storage & backup info")}
            </button>
          </footer>
          <input
            className="dt-sr-only"
            aria-label={t("Import local JSON backup")}
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            onChange={(e) => void importBackup(e.target.files?.[0])}
          />
        </main>
      </div>
      {pendingDelete && <div className="dt-delete-overlay">
        <div className="dt-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="dt-delete-title" onKeyDown={e => { if (e.key === 'Escape') setDeleteTarget(null); }}>
          <h2 id="dt-delete-title">{t("Delete this interview?")}</h2>
          <p><strong>{pendingDelete.title || t('Untitled interview')}</strong></p>
          <p>This removes the transcript, corrections and notes from the local notebook. It cannot be undone. Original WAV files remain in local storage and can be found in Local storage &amp; backup info.</p>
          <div className="dt-actions">
            <button ref={cancelDeletionRef} className="dt-btn" onClick={() => setDeleteTarget(null)}>{t("Cancel")}</button>
            <button className="dt-btn dt-danger" disabled={busy || !!store.error} onClick={() => deleteInterview(pendingDelete.id)}>{t("Delete interview")}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
