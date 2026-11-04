import { fmtClock, effectiveText } from '../lib/format';
import { noteCategoryLabel } from './englishNotes';
import { TranscriptSegment } from './Transcript';
import { jump, type ReviewProps } from './editor';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { SegmentPlayback, type SegmentPlaybackHandle } from './SegmentPlayback';
import { SpeakerManager } from './SpeakerManager';
import { Search, Star, FileText } from 'lucide-react';
import { localRuntime } from './runtime';
import { useLanguage } from './language';
export function ReviewExport({ i, save, segmentChange, doExport, exporting }: ReviewProps) {
  const { t } = useLanguage();
  const playback = useRef<SegmentPlaybackHandle>(null);
  const [query, setQuery] = useState('');
  const [important, setImportant] = useState(false);
  const [speaker, setSpeaker] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [page, setPage] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const [pendingSource, setPendingSource] = useState<number | null>(null);
  const [wavWorking, setWavWorking] = useState(false);
  const [wavMessage, setWavMessage] = useState('');
  const native = localRuntime();
  async function exportWav(recordingId: string) {
    if (!native?.exportRecording || wavWorking) return;
    setWavWorking(true);
    setWavMessage('');
    try {
      const saved = await native.exportRecording(recordingId);
      setWavMessage(saved ? t('WAV saved separately. Keep the original audio and transcript together.') : t('WAV export cancelled.'));
    } catch {
      setWavMessage(t('WAV export unavailable for this recording; check Local storage & backup info.'));
    } finally {
      setWavWorking(false);
    }
  }
  const activeSpeaker = i.segments.some(s => s.speakerLabel === speaker) ? speaker : '';
  const visible = i.segments.filter(s => (!important || s.isImportant) && (!needsReview || !!s.reviewReasons?.length) && (!activeSpeaker || s.speakerLabel === activeSpeaker) && (!deferredQuery.trim() || effectiveText(s).toLocaleLowerCase().includes(deferredQuery.trim().toLocaleLowerCase())));
  const pageCount = Math.max(1, Math.ceil(visible.length / 100));
  const currentPage = Math.min(page, pageCount - 1);
  useEffect(() => {
    if (pendingSource !== null && !query && !deferredQuery && !important && !needsReview && !activeSpeaker) {
      jump(`review-seg-${pendingSource}`); setPendingSource(null);
    }
  }, [pendingSource, query, deferredQuery, important, needsReview, activeSpeaker, currentPage]);
  const excerpts = (i.segments.some(s => s.isImportant) ? i.segments.filter(s => s.isImportant) : i.segments).slice(0, 3);
  const finding = i.notes.find(n => n.category === 'finding');
  // WAV identifiers are persisted on each ASR segment, including legacy merged imports.
  const sourceIds = Array.from(new Set(
    i.segments.map(segment => segment.audio?.recordingId).filter((id): id is string => !!id),
  ));
  const unlinkedCount = i.segments.filter(segment => !segment.audio).length;
  return (
    <div className={`dt-review-grid ${inspectorOpen ? "with-inspector" : "focus-transcript"}`}>
      <section className="dt-card dt-review-sources" aria-label={t("Review original text")}>
        <div className="dt-review-title"><div><div className="dt-eyebrow">{t("CONVERSATION RECORD")}</div><h2>{t("Transcript")} <span>{i.segments.length} segments</span></h2></div>
          <div className="dt-review-layout-actions">
            <FileText size={17} aria-hidden="true"/>
            <button type="button" className="dt-small-btn" aria-controls="dt-review-inspector" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(value => !value)}>
              {t(inspectorOpen ? 'Hide review panel' : 'Show review panel')}
            </button>
          </div>
        </div>
        <div className="dt-transcript-toolbar"><label><Search size={15}/><input aria-label={t("Search transcript")} type="search" placeholder={t("Find in transcript…")} value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/></label>
          <select aria-label={t("Filter transcript by speaker")} value={activeSpeaker} onChange={e => { setSpeaker(e.target.value); setPage(0); }}><option value="">{t("All speakers")}</option>{[...new Set(i.segments.map(s => s.speakerLabel).filter(Boolean))].map(label => <option key={label} value={label!}>{label}</option>)}</select>
          <button className="dt-small-btn" aria-pressed={important} onClick={() => { setImportant(v => !v); setPage(0); }}><Star size={13}/>{t("Marked")}</button>
          <button className="dt-small-btn" aria-pressed={needsReview} onClick={() => { setNeedsReview(v => !v); setPage(0); }}>{t("Needs review")}</button>
        </div>
        <SegmentPlayback ref={playback} interviewId={i.id}/>
        <div className="dt-review-scroll">
          {visible.slice(currentPage * 100, (currentPage + 1) * 100).map(s => <TranscriptSegment key={s.id} segment={s} prefix="review-" onChange={segmentChange} onPlay={segment => playback.current?.play(segment)}/>)}
          {!!i.segments.length && !visible.length && <p className="dt-empty">{t("No segments match.")} <button className="dt-small-btn" onClick={() => { setQuery(''); setImportant(false); setSpeaker(''); setNeedsReview(false); setPage(0); }}>{t("Clear filters")}</button></p>}
          {i.notes.map(n => <article className="dt-evidence-note" id={`review-note-${n.id}`} key={n.id} tabIndex={-1}>
            <strong>Researcher note · {fmtClock(n.timestampMs ?? 0)} · {noteCategoryLabel(n.category)}</strong>
            <p>{n.content}</p>
          </article>)}
          {!i.segments.length && !i.notes.length && <p className="dt-empty">{t("No text yet. Add manual transcript entries or notes in the live workspace.")}</p>}
        </div>
        {pageCount > 1 && <nav className="dt-transcript-pages" aria-label={t("Transcript pages")}><button className="dt-small-btn" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); document.querySelector('.dt-review-scroll')?.scrollTo(0,0); }}>{t("Previous 100")}</button><span>{currentPage * 100 + 1}–{Math.min(visible.length, (currentPage + 1) * 100)} of {visible.length}</span><button className="dt-small-btn" disabled={currentPage === pageCount - 1} onClick={() => { setPage(currentPage + 1); document.querySelector('.dt-review-scroll')?.scrollTo(0,0); }}>{t("Next 100")}</button></nav>}
        <details className="dt-review-export-menu">
          <summary>{t("Export options")} <span>{t("TXT · Markdown · DOCX · Original WAV")}</span></summary>
          <div className="dt-actions dt-export-actions">
            {(['txt', 'md', 'docx'] as const).map(format => <button className="dt-btn" key={format} disabled={exporting} onClick={() => void doExport(format)}>Export {format === 'md' ? 'Markdown' : format.toUpperCase()}</button>)}
          </div>
        {sourceIds.length > 0 && <section className="dt-per-recording-export" aria-label="Export individual recordings">
          <h3>{t("Export each recording separately")}</h3>
          <p className="dt-fine">{t("Each file below includes only transcript segments linked to that original WAV. Notes and unlinked manual segments stay in the complete interview export.")}</p>
          {sourceIds.map((sourceId, index) => <div className="dt-recording-export-row" key={sourceId}>
            <span><strong>Recording {index + 1}</strong> · {sourceId.slice(0, 8)} · {i.segments.filter(segment => segment.audio?.recordingId === sourceId).length} segments</span>
            <div className="dt-actions">
              {(['txt', 'md', 'docx'] as const).map(format => <button className="dt-small-btn" key={format} disabled={exporting} onClick={() => void doExport(format, sourceId)} aria-label={`Export recording ${index + 1} as ${format.toUpperCase()}`}>{format.toUpperCase()}</button>)}
              {native?.exportRecording && <button className="dt-small-btn" disabled={exporting || wavWorking} onClick={() => void exportWav(sourceId)} aria-label={`Export recording ${index + 1} as WAV`}>WAV</button>}
            </div>
          </div>)}
          {unlinkedCount > 0 && <p className="dt-fine">{unlinkedCount} segment(s) lack a WAV link; available in Export all only.</p>}
          <p role="status" aria-live="polite">{wavMessage}</p>
        </section>}
        </details>
      </section>
      {inspectorOpen && <section id="dt-review-inspector" className="dt-card dt-review-inspector" aria-label={t("Manual evidence review")}>
        <SpeakerManager key={i.id} i={i} save={save}/>
        <div className="dt-eyebrow">{t("RESEARCH DESK")}</div>
        <h2>{t("Evidence & interpretation")}</h2>
        <p className="dt-muted">{t("Trace findings to the conversation. Keep your interpretation alongside the original source.")}</p>
        <div className="dt-summary-box">
          <h3>{t(i.synthetic ? 'Fictional demo · Evidence excerpts' : 'Evidence excerpts (verbatim)')}</h3>
          {excerpts.map(s => <p key={s.id}>“{effectiveText(s)}” <button className="dt-citation" onClick={() => { setQuery(''); setImportant(false); setSpeaker(''); setNeedsReview(false); setPage(Math.floor(i.segments.findIndex(item => item.id === s.id) / 100)); setPendingSource(s.seq); }}>Source {fmtClock(s.startMs)} ↗</button></p>)}
          {finding && <p className="dt-interpretation"><b>{t("Researcher interpretation (not participant speech).")}</b> {finding.content} <button className="dt-citation" onClick={() => jump(`review-note-${finding.id}`)}>Note {fmtClock(finding.timestampMs ?? 0)} ↗</button></p>}
          {!excerpts.length && <p>{t("Mark important transcript segments to create evidence links.")}</p>}
        </div>
        <label className="dt-label dt-review-label">{t("Researcher review notes (manual)")}
          <textarea aria-label={t("Researcher review notes")} value={i.reviewText} maxLength={200000} onChange={e => save({ reviewText: e.target.value })} placeholder={t("Write interpretations, verification findings and outstanding questions...")} />
        </label>
        <p className="dt-fine">{t("Evidence anchors are preserved in Markdown / JSON; DOCX and TXT retain timestamps.")}</p>
      </section>}
    </div>
  );
}
