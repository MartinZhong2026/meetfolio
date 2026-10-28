import { AlertTriangle, ArrowDown, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { localAudioCoverage, recoverGapFromLocalAudio } from '../../audio/gapRecovery';
import { api } from '../../lib/api';
import { fmtClock } from '../../lib/format';
import { countMatches } from '../../lib/highlight';
import type { Gap, Segment } from '../../lib/types';
import { GAP_REASON, GAP_STATUS } from '../../lib/zh';
import { useWorkspace } from '../../store/workspace';
import { Button, Spinner, toast } from '../ui';
import { RecorderControls, type Controls } from './RecorderControls';
import { SegmentRow } from './SegmentRow';
import { effectiveText } from '../../lib/format';

/** Requests the transcript to scroll to (and briefly highlight) a segment, from anywhere in the page. */
export function jumpToSegment(seq: number) {
  window.dispatchEvent(new CustomEvent('mf:jump-seg', { detail: { seq } }));
}
export function jumpToTime(ms: number) {
  const segs = useWorkspace.getState().segments;
  let best: Segment | undefined;
  for (const s of segs) if (s.startMs <= ms) best = s;
  best ??= segs[0];
  if (best) jumpToSegment(best.seq);
}

export const GapMarker = memo(function GapMarker({ gap, meetingId, readOnly }: { gap: Gap; meetingId: string; readOnly?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<number | null>(null);
  const setGaps = useWorkspace((s) => s.setGaps);
  useEffect(() => {
    let alive = true;
    if (gap.status === 'open') void localAudioCoverage(meetingId, gap).then((c) => alive && setLocal(c));
    return () => {
      alive = false;
    };
  }, [gap, meetingId]);
  const refresh = async () => {
    const { gaps } = await api.gaps(meetingId);
    setGaps(gaps);
    const b = await api.bundle(meetingId);
    useWorkspace.getState().setSegments(b.segments);
  };
  // While the server re-transcribes, poll for completion.
  useEffect(() => {
    if (gap.status !== 'recovering') return;
    const t = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap.status, gap.id]);
  const recover = async () => {
    setBusy(true);
    try {
      const r = await recoverGapFromLocalAudio(meetingId, gap);
      if (r === 'no_local_audio') toast.error('这台设备上没有该时间段的录音缓存，无法补录。');
      else if (r === 'failed') toast.error('补录请求失败，请稍后重试（语音服务可能仍不可用）。');
      else toast.info('已提交补录，稍候将自动出现在转录中。');
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const giveUp = async () => {
    setBusy(true);
    try {
      const { gap: g } = await api.markGapUnrecoverable(meetingId, gap.id);
      setGaps(useWorkspace.getState().gaps.map((x) => (x.id === g.id ? g : x)));
    } finally {
      setBusy(false);
    }
  };
  const resolved = gap.status === 'recovered';
  const range = `${fmtClock(gap.startMs)}${gap.endMs !== null ? ` – ${fmtClock(gap.endMs)}` : ''}`;
  return (
    <div
      role="note"
      data-testid="gap-marker"
      className={`my-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm ${resolved ? 'border-line bg-sunken text-muted' : 'border-warn-line bg-warn-soft text-warn'}`}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="font-mono text-xs">{range}</span>
      <span>
        {gap.endMs === null
          ? '此处曾中断，中断期间的内容未能记录'
          : gap.status === 'recovered'
            ? '这一时段曾中断，已从本机录音补录'
            : gap.status === 'partial'
              ? '这一时段仅部分补录，其余内容缺失'
              : gap.status === 'unrecoverable'
                ? '这一时段的内容无法找回'
                : `这一时段的转录缺失（${GAP_REASON[gap.reason] ?? '中断'}）`}
      </span>
      <span className="chip border-current bg-transparent py-0">{gap.endMs === null ? '已标记' : GAP_STATUS[gap.status]}</span>
      {gap.status === 'recovering' && <Spinner />}
      {gap.status === 'open' && (
        <span className="ml-auto flex items-center gap-1">
          {local !== null && local > 0 && (
            <Button size="sm" variant="secondary" onClick={() => void recover()} loading={busy}>
              补录（本机有 {Math.round(local / 1000)} 秒录音）
            </Button>
          )}
          {local === 0 && !readOnly && (
            <Button size="sm" variant="ghost" onClick={() => void giveUp()} loading={busy} title="这台设备上没有该时段的录音">
              标记为无法找回
            </Button>
          )}
        </span>
      )}
    </div>
  );
});

function InterimLine() {
  const interim = useWorkspace((s) => s.interim);
  if (!interim) return null;
  return (
    <div className="mx-1 mt-1 rounded-lg border border-dashed border-primary-ring bg-primary-soft/40 px-3 py-2.5" data-testid="interim" aria-live="off">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-mono">[{fmtClock(interim.startMs)}]</span>
        <span className="inline-flex items-center gap-1 text-primary">
          <span className="rec-dot h-1.5 w-1.5 rounded-full bg-primary" /> 识别中…
        </span>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-ink-soft">{interim.text}</p>
    </div>
  );
}

type Item = { kind: 'seg'; at: number; seg: Segment } | { kind: 'gap'; at: number; gap: Gap };

export function TranscriptPanel({ controls, hideControls, meetingId }: { controls: Controls; hideControls?: boolean; meetingId: string }) {
  const segments = useWorkspace((s) => s.segments);
  const gaps = useWorkspace((s) => s.gaps);
  const recState = useWorkspace((s) => s.rec.state);
  const hasInterim = useWorkspace((s) => !!s.interim);
  const rec = useWorkspace((s) => s.rec);
  const [term, setTerm] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = segments.map((seg) => ({ kind: 'seg', at: seg.startMs, seg }));
    for (const g of gaps) if (g.status !== 'recovered' || g.recoveredMs >= 0) list.push({ kind: 'gap', at: g.startMs, gap: g });
    return list.sort((a, b) => a.at - b.at || (a.kind === 'gap' ? -1 : 1));
  }, [segments, gaps]);

  const total = useMemo(() => (term ? segments.reduce((n, s) => n + countMatches(effectiveText(s), term), 0) : 0), [segments, term]);
  useEffect(() => setActive(0), [term]);

  // --- auto-scroll that never fights the reader ---------------------------------------------------------------------
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = atBottom;
    setShowJump(!atBottom && (recState === 'recording' || recState === 'reconnecting'));
  }, [recState]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    stick.current = true;
    setShowJump(false);
  }, []);

  useEffect(() => {
    if (stick.current) requestAnimationFrame(() => scrollToBottom());
    else if (recState === 'recording') setShowJump(true);
  }, [segments.length, hasInterim, scrollToBottom, recState]);

  // Initial position: show the newest content when opening an existing meeting.
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom, meetingId]);

  useEffect(() => {
    const h = (e: Event) => {
      const { seq } = (e as CustomEvent<{ seq: number }>).detail;
      const el = document.getElementById(`seg-${seq}`);
      if (!el) return;
      stick.current = false;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlashSeq(null);
      requestAnimationFrame(() => setFlashSeq(seq));
      setTimeout(() => setFlashSeq((s) => (s === seq ? null : s)), 2400);
    };
    window.addEventListener('mf:jump-seg', h);
    return () => window.removeEventListener('mf:jump-seg', h);
  }, []);

  useEffect(() => {
    if (!term) return;
    document.querySelector(`[data-match="${active}"]`)?.scrollIntoView({ block: 'center' });
  }, [active, term, total]);

  const counter = { n: 0 };
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="实时转录">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="panel-title">实时转录</h2>
          <button className="btn-icon !h-8 !w-8" aria-label="搜索转录" aria-pressed={searchOpen} onClick={() => setSearchOpen((o) => !o)}>
            <Search className="h-4 w-4" />
          </button>
        </div>
      </div>
      {!hideControls && (
        <div className="border-b border-line bg-surface/60 px-4 py-2.5">
          <RecorderControls controls={controls} />
        </div>
      )}
      {recState === 'idle' && segments.length === 0 && !useWorkspace.getState().meeting?.isDemo && (
        <p className="border-b border-line bg-sunken/50 px-4 py-1 text-xs text-muted">录音前，请告知参与者并取得必要的许可。</p>
      )}
      {(recState === 'recording' || recState === 'reconnecting') && (
        <p className="border-b border-line bg-sunken/50 px-4 py-1 text-xs text-muted">录音需要保持本页面打开，设备请勿休眠；关闭页面或休眠期间无法录音。</p>
      )}
      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <input className="input !min-h-0 py-1.5" placeholder="在转录中查找" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus aria-label="在转录中查找" />
          <span className="whitespace-nowrap text-xs text-muted">{term ? (total ? `${active + 1}/${total}` : '无结果') : ''}</span>
          <button className="btn-icon !h-8 !w-8" aria-label="上一个" disabled={!total} onClick={() => setActive((a) => (a - 1 + total) % total)}>
            <ChevronUp className="h-4 w-4" />
          </button>
          <button className="btn-icon !h-8 !w-8" aria-label="下一个" disabled={!total} onClick={() => setActive((a) => (a + 1) % total)}>
            <ChevronDown className="h-4 w-4" />
          </button>
          <button className="btn-icon !h-8 !w-8" aria-label="关闭搜索" onClick={() => (setSearchOpen(false), setTerm(''))}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {rec.error && rec.error.fatal && (
        <div role="alert" className="border-b border-danger-line bg-danger-soft px-4 py-2 text-sm text-danger">
          {rec.error.message}
        </div>
      )}
      {rec.state === 'reconnecting' && (
        <div role="status" className="border-b border-warn-line bg-warn-soft px-4 py-2 text-sm text-warn">
          {rec.connectionFailed ? '暂时连接不上服务器，仍在重试。' : '网络波动，正在重新连接。'}
          麦克风仍在录音，内容已暂存在本机，连上后会自动补全缺失的部分。
        </div>
      )}
      {!rec.storageOk && (
        <div role="alert" className="border-b border-warn-line bg-warn-soft px-4 py-2 text-sm text-warn">
          本机录音缓存不可用（可能是隐私模式或存储空间不足）：转录仍然有效，但断线后无法补录缺失的部分。
        </div>
      )}
      {!rec.persistOk && (
        <div role="alert" className="border-b border-danger-line bg-danger-soft px-4 py-2 text-sm text-danger">
          转录内容暂时无法写入数据库，正在重试……请保持页面打开。
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="scroll-quiet h-full overflow-y-auto px-2 py-3" data-testid="transcript-scroll" tabIndex={0} aria-label="转录内容">
          {items.length === 0 && !hasInterim ? (
            <div className="mx-auto mt-16 max-w-xs px-4 text-center text-sm text-muted">
              <p className="font-serif text-base text-ink-soft">转录将显示在这里</p>
              <p className="mt-2 leading-relaxed">点击“开始转录”，说话的内容会实时出现，确认后的每一句都会自动保存。</p>
            </div>
          ) : (
            items.map((it) =>
              it.kind === 'gap' ? (
                <GapMarker key={`g-${it.gap.id}`} gap={it.gap} meetingId={meetingId} />
              ) : (
                <SegmentRow key={it.seg.id} seg={it.seg} meetingId={meetingId} term={term} activeMatch={active} matchCounter={term ? counter : undefined} flash={flashSeq === it.seg.seq} />
              ),
            )
          )}
          <InterimLine />
        </div>
        {showJump && (
          <button className="btn-secondary btn-sm absolute bottom-3 left-1/2 -translate-x-1/2 shadow-pop" onClick={() => scrollToBottom(true)}>
            <ArrowDown className="h-3.5 w-3.5" /> 回到最新
          </button>
        )}
      </div>
    </section>
  );
}
