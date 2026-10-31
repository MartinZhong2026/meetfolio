import { useState } from 'react';
import { Star, Pencil, Check, RotateCcw } from 'lucide-react';
import type { Segment } from '../lib/types';
import { effectiveText, fmtClock } from '../lib/format';
export function TranscriptSegment({
  segment: s,
  prefix = '',
  onChange,
  onPlay,
}: {
  segment: Segment;
  prefix?: string;
  onChange: (s: Segment) => void;
  onPlay?: (s: Segment) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [speakerEdit, setSpeakerEdit] = useState(false);
  const [speaker, setSpeaker] = useState('');
  return (
    <article
      id={`${prefix}seg-${s.seq}`}
      tabIndex={-1}
      className={`dt-segment ${s.isImportant ? 'important' : ''}`}
    >
      <time>{fmtClock(s.startMs)}</time>
      <div className="dt-bubble">
        <div className="dt-speaker">
          <button className="dt-speaker-name" aria-label={`${s.speakerLabel || 'Unlabeled speaker'} · Correct speaker for segment ${s.seq}`} onClick={() => { setSpeaker(s.speakerLabel || ''); setSpeakerEdit(v => !v); }}>{s.speakerLabel || 'Unlabeled speaker'}</button>{' '}
          <span className="dt-source-label">
            {s.source === 'demo'
              ? 'DEMO'
              : s.source === 'manual'
                ? 'Manual entry'
                : 'Local engine'}
          </span>
        </div>
        {speakerEdit && <div className="dt-speaker-correction"><label className="dt-label">Speaker for segment {s.seq}<input aria-label={`Speaker for segment ${s.seq}`} value={speaker} maxLength={200} onChange={e => setSpeaker(e.target.value)}/></label><button className="dt-small-btn" onClick={() => { onChange({ ...s, speakerLabel: speaker.trim() || null }); setSpeakerEdit(false); }}>Save speaker</button><button className="dt-small-btn" onClick={() => setSpeakerEdit(false)}>Cancel speaker change</button></div>}
        {s.audio && <p className="dt-audio-source">Original audio · {fmtClock(s.audio.startMs)}–{fmtClock(s.audio.endMs)} <span> / {s.audio.recordingId.slice(0, 8)}</span></p>}
        {editing ? (
          <>
            <label className="dt-label">
              Edit segment {s.seq}
              <textarea
                aria-label={`Edit segment ${s.seq}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={200000}
              />
            </label>
            <button
              className="dt-small-btn"
              onClick={() => {
                if (draft.trim()) {
                  onChange({
                    ...s,
                    editedText: draft === s.originalText ? null : draft,
                  });
                  setEditing(false);
                }
              }}
            >
              <Check size={12} />
              Save edit
            </button>
            <button className="dt-small-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          s.audio && onPlay ? <button className="dt-transcript-play" aria-label={`Play audio for segment ${s.seq}`} aria-describedby={`${prefix}audio-text-${s.id}`} onClick={() => onPlay(s)}><span id={`${prefix}audio-text-${s.id}`}>{effectiveText(s)}</span></button> : <p>{effectiveText(s)}</p>
        )}
        {s.editedText !== null && (
          <details>
            <summary>Compare original text</summary>
            <p>{s.originalText}</p>
            <button
              className="dt-small-btn"
              onClick={() => onChange({ ...s, editedText: null })}
            >
              <RotateCcw size={12} />
              Restore original
            </button>
          </details>
        )}
      </div>
      <div className="dt-segment-actions">
        <button
          aria-label={`Mark important segment ${s.seq}`}
          aria-pressed={s.isImportant}
          onClick={() => onChange({ ...s, isImportant: !s.isImportant })}
        >
          <Star size={14} fill={s.isImportant ? 'currentColor' : 'none'} />
        </button>
        <button
          aria-label={`Edit segment ${s.seq}`}
          onClick={() => {
            setDraft(effectiveText(s));
            setEditing(true);
          }}
        >
          <Pencil size={13} />
        </button>
      </div>
    </article>
  );
}
