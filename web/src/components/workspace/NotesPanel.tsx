import { Clock, Star, Trash2 } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { fmtClock } from '../../lib/format';
import type { Note, NoteCategory } from '../../lib/types';
import { NOTE_CATEGORIES, noteCategoryLabel } from '../../lib/zh';
import { editNote, newId, removeNote, useWorkspace } from '../../store/workspace';
import { Button, toast } from '../ui';
import { jumpToTime } from './TranscriptPanel';

function AutoTextarea({ value, onChange, placeholder, className = '', autoFocus, onKeyDown, label }: { value: string; onChange(v: string): void; placeholder?: string; className?: string; autoFocus?: boolean; onKeyDown?: (e: React.KeyboardEvent) => void; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`block w-full resize-none bg-transparent leading-relaxed focus:outline-none focus-visible:!ring-0 focus-visible:!ring-offset-0 ${className}`} autoFocus={autoFocus} onKeyDown={onKeyDown} aria-label={label} />;
}

const CAT_TONE: Record<NoteCategory, string> = {
  general: 'bg-sunken text-ink-soft',
  quote: 'bg-primary-soft text-primary-hover',
  observation: 'bg-[#EEF1F7] text-[#3A4A6B]',
  finding: 'bg-warn-soft text-warn',
  followup: 'bg-[#F3ECF6] text-[#5C3F6B]',
  todo: 'bg-danger-soft text-danger',
};

const NoteCard = memo(function NoteCard({ note, meetingId }: { note: Note; meetingId: string }) {
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <li className={`group rounded-xl border bg-surface p-3 shadow-card ${note.isImportant ? 'border-warn-line' : 'border-line'}`} data-testid="note">
      <div className="flex items-center gap-2 text-xs">
        <select
          value={note.category}
          onChange={(e) => editNote(meetingId, note.id, { category: e.target.value as NoteCategory }, { immediate: true })}
          aria-label="笔记类别"
          className={`cursor-pointer rounded-full border-0 py-0.5 pl-2.5 pr-6 text-xs font-medium ${CAT_TONE[note.category]}`}
        >
          {NOTE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {note.timestampMs !== null && (
          <button className="inline-flex items-center gap-1 font-mono text-muted hover:text-primary" onClick={() => jumpToTime(note.timestampMs!)} title="跳到对应的转录位置">
            <Clock className="h-3 w-3" />
            {fmtClock(note.timestampMs)}
          </button>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          <button className={`btn-icon !h-7 !w-7 ${note.isImportant ? 'text-warn' : ''}`} aria-pressed={note.isImportant} aria-label={note.isImportant ? '取消重点' : '标为重点'} onClick={() => editNote(meetingId, note.id, { isImportant: !note.isImportant }, { immediate: true })}>
            <Star className="h-3.5 w-3.5" fill={note.isImportant ? 'currentColor' : 'none'} />
          </button>
          {confirmDel ? (
            <>
              <button className="rounded px-1.5 py-0.5 text-xs text-danger hover:bg-danger-soft" onClick={() => void removeNote(meetingId, note.id).catch(() => toast.error('删除失败'))}>
                确认删除
              </button>
              <button className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-sunken" onClick={() => setConfirmDel(false)}>
                取消
              </button>
            </>
          ) : (
            <button className="btn-icon !h-7 !w-7 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label="删除笔记" onClick={() => setConfirmDel(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
      <AutoTextarea className="mt-1.5 text-[0.97rem]" value={note.content} onChange={(v) => editNote(meetingId, note.id, { content: v })} label="笔记内容" />
    </li>
  );
});

export function NotesPanel({ meetingId }: { meetingId: string }) {
  const notes = useWorkspace((s) => s.notes);
  const [category, setCategory] = useState<NoteCategory>('general');
  const [draftId, setDraftId] = useState(newId);
  const [text, setText] = useState('');
  const listEnd = useRef<HTMLDivElement>(null);
  const prevCount = useRef(notes.length);

  // The note being typed is already saved as soon as there is content; "添加" just starts the next one.
  const onType = (v: string) => {
    setText(v);
    const pos = useWorkspace.getState().rec.positionMs;
    const exists = useWorkspace.getState().notes.some((n) => n.id === draftId);
    if (!v.trim() && !exists) return;
    editNote(meetingId, draftId, { content: v, category }, { timestampMs: pos > 0 ? pos : null });
  };
  const changeCategory = (c: NoteCategory) => {
    setCategory(c);
    if (useWorkspace.getState().notes.some((n) => n.id === draftId)) editNote(meetingId, draftId, { category: c }, { immediate: true });
  };
  const commit = () => {
    if (!text.trim()) return;
    editNote(meetingId, draftId, { content: text, category }, { immediate: true });
    setDraftId(newId());
    setText('');
  };

  useEffect(() => {
    if (notes.length > prevCount.current) listEnd.current?.scrollIntoView({ block: 'nearest' });
    prevCount.current = notes.length;
  }, [notes.length]);

  const listed = notes.filter((n) => n.id !== draftId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="人工笔记">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="panel-title">人工笔记</h2>
        <span className="text-xs text-muted">{listed.length} 条 · 自动保存</span>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {listed.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xs px-4 text-center text-sm text-muted">
            <p className="font-serif text-base text-ink-soft">在这里写下您自己的观察</p>
            <p className="mt-2 leading-relaxed">转录进行时也可以随时输入。笔记由您撰写，不会被 AI 改写。</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {listed.map((n) => (
              <NoteCard key={n.id} note={n} meetingId={meetingId} />
            ))}
          </ul>
        )}
        <div ref={listEnd} />
      </div>
      <div className="border-t border-line bg-surface/70 p-3">
        <div className="mb-2 flex flex-wrap gap-1" role="radiogroup" aria-label="笔记类别">
          {NOTE_CATEGORIES.map((c) => (
            <button
              key={c.value}
              role="radio"
              aria-checked={category === c.value}
              onClick={() => changeCategory(c.value)}
              title={c.hint}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${category === c.value ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink-soft hover:bg-sunken'}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-line-strong bg-surface p-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
          <AutoTextarea
            value={text}
            onChange={onType}
            placeholder={`写${noteCategoryLabel(category)}…（${navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter 添加）`}
            label="新笔记"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commit();
              }
            }}
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-muted">{text.trim() ? '正在自动保存' : '输入后自动保存'}</span>
            <Button size="sm" variant="primary" onClick={commit} disabled={!text.trim()} data-testid="btn-add-note">
              添加
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
