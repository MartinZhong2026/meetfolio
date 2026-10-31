import { fmtClock, effectiveText } from '../lib/format';
import { noteCategoryLabel } from './englishNotes';
import { TranscriptSegment } from './Transcript';
import { jump, type ReviewProps } from './editor';
import { useRef, useState } from 'react';
import { SegmentPlayback, type SegmentPlaybackHandle } from './SegmentPlayback';
import { SpeakerManager } from './SpeakerManager';
import { Search, Star, FileText } from 'lucide-react';
export function ReviewExport({ i, save, segmentChange, doExport, exporting }: ReviewProps) {
  const playback = useRef<SegmentPlaybackHandle>(null);
  const [query, setQuery] = useState('');
  const [important, setImportant] = useState(false);
  const [speaker, setSpeaker] = useState('');
  const activeSpeaker = i.segments.some(s => s.speakerLabel === speaker) ? speaker : '';
  const visible = i.segments.filter(s => (!important || s.isImportant) && (!activeSpeaker || s.speakerLabel === activeSpeaker) && (!query.trim() || effectiveText(s).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const excerpts = (i.segments.some(s => s.isImportant) ? i.segments.filter(s => s.isImportant) : i.segments).slice(0, 3);
  const finding = i.notes.find(n => n.category === 'finding');
  return (
    <div className="dt-review-grid">
      <section className="dt-card dt-review-sources" aria-label="Review original text">
        <div className="dt-review-title"><div><div className="dt-eyebrow">CONVERSATION RECORD</div><h2>Transcript <span>{i.segments.length} segments</span></h2></div><FileText size={20}/></div>
        <div className="dt-transcript-toolbar"><label><Search size={15}/><input aria-label="Search transcript" type="search" placeholder="Find in transcript…" value={query} onChange={e => setQuery(e.target.value)}/></label>
          <select aria-label="Filter transcript by speaker" value={activeSpeaker} onChange={e => setSpeaker(e.target.value)}><option value="">All speakers</option>{[...new Set(i.segments.map(s => s.speakerLabel).filter(Boolean))].map(label => <option key={label} value={label!}>{label}</option>)}</select>
          <button className="dt-small-btn" aria-pressed={important} onClick={() => setImportant(v => !v)}><Star size={13}/>Marked</button>
        </div>
        <SegmentPlayback ref={playback} interviewId={i.id}/>
        <div className="dt-review-scroll">
          {visible.map(s => <TranscriptSegment key={s.id} segment={s} prefix="review-" onChange={segmentChange} onPlay={segment => playback.current?.play(segment)}/>)}
          {!!i.segments.length && !visible.length && <p className="dt-empty">No segments match. <button className="dt-small-btn" onClick={() => { setQuery(''); setImportant(false); setSpeaker(''); }}>Clear filters</button></p>}
          {i.notes.map(n => <article className="dt-evidence-note" id={`review-note-${n.id}`} key={n.id} tabIndex={-1}>
            <strong>Researcher note · {fmtClock(n.timestampMs ?? 0)} · {noteCategoryLabel(n.category)}</strong>
            <p>{n.content}</p>
          </article>)}
          {!i.segments.length && !i.notes.length && <p className="dt-empty">No text yet. Add manual transcript entries or notes in the live workspace.</p>}
        </div>
        <div className="dt-actions dt-export-actions">
          {(['txt', 'md', 'docx'] as const).map(format => <button className="dt-btn" key={format} disabled={exporting} onClick={() => void doExport(format)}>Export {format === 'md' ? 'Markdown' : format.toUpperCase()}</button>)}
        </div>
      </section>
      <section className="dt-card dt-review-inspector" aria-label="Manual evidence review">
        <SpeakerManager key={i.id} i={i} save={save}/>
        <div className="dt-eyebrow">RESEARCH DESK</div>
        <h2>Evidence & interpretation</h2>
        <p className="dt-muted">Trace findings to the conversation. Keep your interpretation alongside the original source.</p>
        <div className="dt-summary-box">
          <h3>{i.synthetic ? 'Fictional demo · Evidence excerpts' : 'Evidence excerpts (verbatim)'}</h3>
          {excerpts.map(s => <p key={s.id}>“{effectiveText(s)}” <button className="dt-citation" onClick={() => { setQuery(''); setImportant(false); setSpeaker(''); requestAnimationFrame(() => jump(`review-seg-${s.seq}`)); }}>Source {fmtClock(s.startMs)} ↗</button></p>)}
          {finding && <p className="dt-interpretation"><b>Researcher interpretation (not participant speech).</b> {finding.content} <button className="dt-citation" onClick={() => jump(`review-note-${finding.id}`)}>Note {fmtClock(finding.timestampMs ?? 0)} ↗</button></p>}
          {!excerpts.length && <p>Mark important transcript segments to create evidence links.</p>}
        </div>
        <label className="dt-label dt-review-label">Researcher review notes (manual)
          <textarea aria-label="Researcher review notes" value={i.reviewText} maxLength={200000} onChange={e => save({ reviewText: e.target.value })} placeholder="Write interpretations, verification findings and outstanding questions..." />
        </label>
        <p className="dt-fine">Evidence anchors are preserved in Markdown / JSON; DOCX and TXT retain timestamps.</p>
      </section>
    </div>
  );
}
