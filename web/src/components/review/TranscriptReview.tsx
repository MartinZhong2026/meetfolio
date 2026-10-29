import { ChevronDown, ChevronUp, Plus, Search, Star, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { effectiveText, fmtClock } from '../../lib/format';
import { countMatches } from '../../lib/highlight';
import type { Gap, Segment } from '../../lib/types';
import { useWorkspace } from '../../store/workspace';
import { Button, Modal, toast } from '../ui';
import { SegmentRow } from '../workspace/SegmentRow';
import { GapMarker } from '../workspace/TranscriptPanel';

type Item = { kind: 'seg'; at: number; seg: Segment } | { kind: 'gap'; at: number; gap: Gap };

export function TranscriptReview({ meetingId }: { meetingId: string }) {
  const segments = useWorkspace((s) => s.segments);
  const gaps = useWorkspace((s) => s.gaps);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const [onlyImportant, setOnlyImportant] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [addText, setAddText] = useState('');
  const [addAt, setAddAt] = useState('');

  const items = useMemo<Item[]>(() => {
    const list: Item[] = segments.filter((s) => !onlyImportant || s.isImportant).map((seg) => ({ kind: 'seg', at: seg.startMs, seg }));
    if (!onlyImportant) for (const g of gaps) list.push({ kind: 'gap', at: g.startMs, gap: g });
    return list.sort((a, b) => a.at - b.at || (a.kind === 'gap' ? -1 : 1));
  }, [segments, gaps, onlyImportant]);

  const total = useMemo(() => (term ? segments.reduce((n, s) => n + countMatches(effectiveText(s), term), 0) : 0), [segments, term]);
  useEffect(() => setActive(0), [term]);
  useEffect(() => {
    if (term) document.querySelector(`[data-review-transcript] [data-match="${active}"]`)?.scrollIntoView({ block: 'center' });
  }, [active, term, total]);

  useEffect(() => {
    const h = (e: Event) => {
      const { seq } = (e as CustomEvent<{ seq: number }>).detail;
      setOnlyImportant(false);
      setTimeout(() => {
        document.getElementById(`seg-${seq}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setFlash(seq);
        setTimeout(() => setFlash((s) => (s === seq ? null : s)), 2400);
      }, 60);
    };
    window.addEventListener('mf:jump-seg', h);
    return () => window.removeEventListener('mf:jump-seg', h);
  }, []);

  const counter = { n: 0 };
  const addSegment = async () => {
    const parts = addAt.split(':').map(Number);
    const ms = parts.length === 3 && parts.every((n) => !Number.isNaN(n)) ? ((parts[0]! * 60 + parts[1]!) * 60 + parts[2]!) * 1000 : 0;
    try {
      const { segment } = await api.addSegment(meetingId, { startMs: ms, text: addText.trim() });
      useWorkspace.getState().upsertSegment(segment);
      setAdding(false);
      setAddText('');
      toast.success('已添加手动补记');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '添加失败');
    }
  };

  return (
    <div data-review-transcript>
      <div className="sticky top-14 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-bg/95 px-1 py-2 backdrop-blur">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9 pr-28" placeholder="在转录中搜索" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="在转录中搜索" />
          {term && (
            <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 text-xs text-muted">
              {total ? `${active + 1}/${total}` : '无结果'}
              <button className="btn-icon !h-7 !w-7" aria-label="上一个" disabled={!total} onClick={() => setActive((a) => (a - 1 + total) % total)}>
                <ChevronUp className="h-4 w-4" />
              </button>
              <button className="btn-icon !h-7 !w-7" aria-label="下一个" disabled={!total} onClick={() => setActive((a) => (a + 1) % total)}>
                <ChevronDown className="h-4 w-4" />
              </button>
              <button className="btn-icon !h-7 !w-7" aria-label="清除" onClick={() => setTerm('')}>
                <X className="h-4 w-4" />
              </button>
            </span>
          )}
        </div>
        <button className={`btn-secondary btn-sm ${onlyImportant ? '!border-warn-line !bg-warn-soft !text-warn' : ''}`} aria-pressed={onlyImportant} onClick={() => setOnlyImportant((v) => !v)}>
          <Star className="h-3.5 w-3.5" fill={onlyImportant ? 'currentColor' : 'none'} /> 仅看重点
        </button>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> 手动补记
        </Button>
      </div>
      <p className="mb-2 px-1 text-xs text-muted">转录由语音识别自动生成，可能有误。点击文字旁的铅笔即可校对；原始识别文字会一直保留，可随时恢复。</p>
      <div className="card px-1 py-2" data-testid="review-transcript">
        {items.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted">{onlyImportant ? '还没有标记为重点的内容。' : '这场会议还没有转录内容。'}</p>
        ) : (
          items.map((it) =>
            it.kind === 'gap' ? (
              <div key={`g${it.gap.id}`} className="px-2">
                <GapMarker gap={it.gap} meetingId={meetingId} />
              </div>
            ) : (
              <SegmentRow key={it.seg.id} seg={it.seg} meetingId={meetingId} term={term} activeMatch={active} matchCounter={term ? counter : undefined} flash={flash === it.seg.seq} />
            ),
          )
        )}
      </div>
      <Modal open={adding} onOpenChange={setAdding} title="手动补记" description="用于补上无法找回的时间段。补记内容会标注为“手动补记”，不会与语音识别结果混淆。">
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="at">
              时间（时:分:秒）
            </label>
            <input id="at" className="input" placeholder="00:12:30" value={addAt} onChange={(e) => setAddAt(e.target.value)} />
          </div>
          <textarea className="input min-h-[120px]" placeholder="补记内容" value={addText} onChange={(e) => setAddText(e.target.value)} aria-label="补记内容" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setAdding(false)}>取消</Button>
          <Button variant="primary" disabled={!addText.trim()} onClick={() => void addSegment()}>
            添加
          </Button>
        </div>
      </Modal>
      <span className="sr-only">{fmtClock(0)}</span>
    </div>
  );
}
