import { Check, Copy, Pencil, RotateCcw, Star } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { effectiveText, fmtClock } from '../../lib/format';
import { highlight } from '../../lib/highlight';
import type { Segment } from '../../lib/types';
import { patchSegment } from '../../store/workspace';
import { toast } from '../ui';

const SPEAKERS = ['访谈员', '受访者', '参与者A', '参与者B', '其他'];

interface Props {
  seg: Segment;
  meetingId: string;
  term: string;
  activeMatch: number;
  matchCounter?: { n: number };
  flash: boolean;
  readOnly?: boolean;
}

function SegmentRowImpl({ seg, meetingId, term, activeMatch, matchCounter, flash, readOnly }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const text = effectiveText(seg);
  const edited = seg.editedText !== null;

  useEffect(() => {
    if (editing && ta.current) {
      ta.current.focus();
      ta.current.setSelectionRange(ta.current.value.length, ta.current.value.length);
    }
  }, [editing]);

  const save = async () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === text) return;
    try {
      await patchSegment(meetingId, seg.id, { editedText: next });
    } catch {
      toast.error('修改未能保存，已恢复');
    }
  };
  const revert = async () => {
    setEditing(false);
    try {
      await patchSegment(meetingId, seg.id, { editedText: null });
    } catch {
      toast.error('恢复失败');
    }
  };
  const speaker = async (v: string) => {
    let label = v;
    if (v === '__custom') {
      label = (window.prompt('发言者名称', seg.speakerLabel ?? '') ?? '').trim();
      if (!label) return;
    }
    try {
      await patchSegment(meetingId, seg.id, { speakerLabel: label });
    } catch {
      toast.error('保存失败');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`[${fmtClock(seg.startMs)}] ${seg.speakerLabel ? seg.speakerLabel + '：' : ''}${text}`);
      toast.success('已复制');
    } catch {
      toast.error('复制失败，请手动选择文字');
    }
  };
  const sourceChip = seg.source === 'recovery' ? '补录' : seg.source === 'demo' ? '演示' : seg.source === 'manual' ? '手动补记' : null;

  return (
    <article
      id={`seg-${seg.seq}`}
      data-seq={seg.seq}
      className={`seg-row group relative rounded-lg px-3 py-2.5 transition-colors hover:bg-sunken/70 ${seg.isImportant ? 'bg-warn-soft/60 hover:bg-warn-soft' : ''} ${flash ? 'flash-seg' : ''}`}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <time className="font-mono text-muted" dateTime={`PT${Math.floor(seg.startMs / 1000)}S`}>
          [{fmtClock(seg.startMs)}]
        </time>
        {readOnly ? (
          seg.speakerLabel && <span className="font-medium text-ink-soft">{seg.speakerLabel}：</span>
        ) : (
          <select
            value={SPEAKERS.includes(seg.speakerLabel ?? '') || !seg.speakerLabel ? (seg.speakerLabel ?? '') : '__current'}
            onChange={(e) => void speaker(e.target.value)}
            aria-label="发言者"
            className={`max-w-[8rem] cursor-pointer rounded border-0 bg-transparent py-0 pl-0 pr-5 text-xs font-medium focus:ring-2 focus:ring-primary/40 ${seg.speakerLabel ? 'text-ink-soft' : 'text-muted opacity-60 group-hover:opacity-100'}`}
          >
            <option value="">未标注发言者</option>
            {SPEAKERS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {seg.speakerLabel && !SPEAKERS.includes(seg.speakerLabel) && <option value="__current">{seg.speakerLabel}</option>}
            <option value="__custom">自定义…</option>
          </select>
        )}
        {sourceChip && <span className="chip border-line py-0 text-[11px]">{sourceChip}</span>}
        {edited && (
          <button className="chip border-primary-ring bg-primary-soft py-0 text-[11px] text-primary-hover" onClick={() => setShowOriginal((v) => !v)} aria-expanded={showOriginal} title="已校对，点击对照原始识别文字">
            已修订
          </button>
        )}
        <span className="ml-auto flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {!readOnly && (
            <button className={`btn-icon !h-7 !w-7 ${seg.isImportant ? 'text-warn' : ''}`} aria-label={seg.isImportant ? '取消重点' : '标记为重点'} aria-pressed={seg.isImportant} onClick={() => void patchSegment(meetingId, seg.id, { isImportant: !seg.isImportant }).catch(() => toast.error('保存失败'))}>
              <Star className="h-3.5 w-3.5" fill={seg.isImportant ? 'currentColor' : 'none'} />
            </button>
          )}
          <button className="btn-icon !h-7 !w-7" aria-label="复制这一段" onClick={() => void copy()}>
            <Copy className="h-3.5 w-3.5" />
          </button>
          {!readOnly && (
            <button
              className="btn-icon !h-7 !w-7"
              aria-label="编辑文字"
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
        {readOnly && seg.isImportant && <Star className="h-3.5 w-3.5 text-warn" fill="currentColor" aria-label="重点" />}
      </header>

      {editing ? (
        <div className="mt-1.5">
          <textarea
            ref={ta}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
            }}
            rows={Math.max(2, Math.ceil(draft.length / 28))}
            className="input !min-h-0 leading-relaxed"
            aria-label="编辑转录文字"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-muted">
            <span>原始识别文字会被保留。Ctrl/⌘+Enter 保存，Esc 取消。</span>
            {edited && (
              <button className="inline-flex items-center gap-1 text-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => void revert()}>
                <RotateCcw className="h-3 w-3" /> 恢复原文
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[1rem] leading-[1.75]" onDoubleClick={() => !readOnly && (setDraft(text), setEditing(true))}>
          {highlight(text, term, activeMatch, matchCounter)}
        </p>
      )}
      {showOriginal && edited && (
        <p className="mt-1.5 rounded border border-dashed border-line-strong bg-surface px-2 py-1 text-sm text-muted">
          <span className="mr-1 text-xs">原始识别：</span>
          {seg.originalText}
        </p>
      )}
    </article>
  );
}

export const SegmentRow = memo(SegmentRowImpl, (a, b) => a.seg === b.seg && a.term === b.term && a.activeMatch === b.activeMatch && a.flash === b.flash && a.meetingId === b.meetingId && a.readOnly === b.readOnly && !a.term);
void Check;
