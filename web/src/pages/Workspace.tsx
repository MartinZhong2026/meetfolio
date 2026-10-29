import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FlaskConical, NotebookPen, ScrollText, BookOpen } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NotesPanel } from '../components/workspace/NotesPanel';
import { ReferencePanel } from '../components/workspace/ReferencePanel';
import { RecorderControls, StatusBadge, Timer, type Controls } from '../components/workspace/RecorderControls';
import { TranscriptPanel } from '../components/workspace/TranscriptPanel';
import { WorkspaceHeader } from '../components/workspace/WorkspaceHeader';
import { Button, ConfirmDialog, Notice, Spinner, toast, useDocumentTitle } from '../components/ui';
import { useLiveSession } from '../hooks/useLiveSession';
import { api, ApiError } from '../lib/api';
import { useWorkspace, flushAllNotes, restoreNoteDrafts, patchSegment } from '../store/workspace';

type Tab = 'ref' | 'transcript' | 'notes';

function useMediaQuery(q: string) {
  const [m, setM] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(q).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    h();
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}

export default function Workspace() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const bundle = useQuery({ queryKey: ['bundle', id], queryFn: () => api.bundle(id), staleTime: 0, gcTime: 0, refetchOnMount: 'always' });
  const loaded = useWorkspace((s) => s.loaded && s.meetingId === id);
  const meeting = useWorkspace((s) => s.meeting);
  useDocumentTitle(meeting?.title ?? '会议');

  useEffect(() => {
    if (bundle.data && useWorkspace.getState().meetingId !== id) {
      useWorkspace.getState().init(bundle.data);
      restoreNoteDrafts(id);
    }
  }, [bundle.data, id]);
  useEffect(
    () => () => {
      void flushAllNotes(id);
      useWorkspace.getState().reset();
    },
    [id],
  );

  if (bundle.isError) {
    const e = bundle.error as ApiError;
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card max-w-sm p-6 text-center">
          <h1 className="font-serif text-xl font-semibold">{e.status === 404 ? '找不到这场会议' : '无法载入会议'}</h1>
          <p className="mt-2 text-sm text-muted">{e.status === 404 ? '它可能已被删除，或不属于当前账户。' : e.message}</p>
          <Button className="mt-4" variant="primary" onClick={() => nav('/meetings')}>
            返回我的会议
          </Button>
        </div>
      </div>
    );
  }
  if (!loaded || !meeting) {
    return (
      <div className="grid min-h-screen place-items-center text-muted">
        <span className="inline-flex items-center gap-2">
          <Spinner /> 正在载入工作台…
        </span>
      </div>
    );
  }
  return <WorkspaceView meetingId={id} />;
}

function WorkspaceView({ meetingId }: { meetingId: string }) {
  const nav = useNavigate();
  const live = useLiveSession(meetingId);
  const meeting = useWorkspace((s) => s.meeting)!;
  const recState = useWorkspace((s) => s.rec.state);
  const gaps = useWorkspace((s) => s.gaps);
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 5 * 60_000 });
  const wide = useMediaQuery('(min-width: 1200px)');
  const medium = useMediaQuery('(min-width: 768px)');
  const [tab, setTab] = useState<Tab>('transcript');
  const [sideTab, setSideTab] = useState<'ref' | 'notes'>('notes');
  const [refCollapsed, setRefCollapsed] = useState(() => localStorage.getItem('mf:ref-collapsed') === '1');
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  const isLive = recState === 'recording' || recState === 'connecting' || recState === 'reconnecting' || recState === 'paused';
  const demo = meeting.isDemo;
  const blocked = !demo && config.data && !config.data.asrConfigured;

  const controls: Controls = {
    canStart: !blocked,
    startBlockedReason: blocked ? '语音识别服务尚未配置' : undefined,
    start: async () => {
      if (meeting.endedAt || meeting.transcriptStatus === 'complete') await api.reopenMeeting(meetingId).then((r) => useWorkspace.getState().patchMeeting(r.meeting));
      await live.start();
    },
    resume: async () => {
      if (meeting.endedAt || meeting.transcriptStatus === 'complete') {
        const r = await api.reopenMeeting(meetingId);
        useWorkspace.getState().patchMeeting(r.meeting);
        await live.start();
        return;
      }
      await live.resume();
    },
    pause: () => live.pause(),
    end: async () => {
      try {
        await live.end();
        toast.success('转录已保存');
        nav(`/meetings/${meetingId}`);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : '结束失败，请重试');
      }
    },
    mark: () => {
      const { segments, rec } = useWorkspace.getState();
      const last = [...segments].reverse().find((s) => s.startMs <= rec.positionMs + 1000);
      if (!last) return toast.info('还没有可标记的转录内容');
      void patchSegment(meetingId, last.id, { isImportant: true }).then(() => toast.success('已标记为重点')).catch(() => toast.error('标记失败'));
    },
  };

  const leave = useCallback(
    (to: string) => {
      if (isLive) setLeaveTo(to);
      else {
        void flushAllNotes(meetingId).then(() => nav(to));
      }
    },
    [isLive, meetingId, nav],
  );

  const toggleRef = (v: boolean) => {
    setRefCollapsed(v);
    localStorage.setItem('mf:ref-collapsed', v ? '1' : '0');
  };

  const reviewHref = `/meetings/${meetingId}`;
  const openGaps = gaps.filter((g) => g.status === 'open' && g.endMs !== null);

  const banner = (
    <>
      {demo && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warn-line bg-warn-soft px-4 py-1.5 text-sm text-warn" data-testid="demo-banner">
          <FlaskConical className="h-4 w-4" />
          <b>演示模式</b>
          <span>以下文字是模拟的转录，不使用麦克风，也不会调用语音识别服务。</span>
          {isLive && (
            <span className="ml-auto flex gap-1">
              <Button size="sm" onClick={() => live.demoDropProvider()}>
                模拟语音服务断线
              </Button>
              <Button size="sm" onClick={() => live.simulateNetworkLoss()}>
                模拟网络中断
              </Button>
            </span>
          )}
        </div>
      )}
      {blocked && (
        <div className="px-4 pt-2">
          <Notice kind="warn">语音识别服务尚未配置（需要在服务器设置 DASHSCOPE_API_KEY 与 DASHSCOPE_WORKSPACE_ID），暂时不能开始真实转录。您仍可以整理资料、记笔记，或创建演示会议体验流程。</Notice>
        </div>
      )}
      {openGaps.length > 0 && !isLive && (
        <div className="px-4 pt-2">
          <Notice kind="warn" action={<Button size="sm" onClick={() => void live.recoverGaps()}>尝试补录</Button>}>
            有 {openGaps.length} 个时间段的转录缺失。若这台设备仍保存着当时的录音，可以补录。
          </Notice>
        </div>
      )}
    </>
  );

  const header = <WorkspaceHeader onLeave={leave} reviewHref={reviewHref} />;

  const panels = {
    ref: <ReferencePanel meetingId={meetingId} onCollapse={wide ? () => toggleRef(true) : undefined} />,
    transcript: <TranscriptPanel controls={controls} meetingId={meetingId} hideControls={!wide && !medium} />,
    notes: <NotesPanel meetingId={meetingId} />,
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-bg" data-testid="workspace">
      {header}
      {banner}

      {wide ? (
        // Desktop: reference | transcript | notes, all usable at once.
        <div className="grid min-h-0 flex-1 gap-3 p-3" style={{ gridTemplateColumns: `${refCollapsed ? '44px' : 'minmax(280px,22%)'} minmax(0,1fr) minmax(320px,26%)` }}>
          {refCollapsed ? (
            <button className="card flex flex-col items-center gap-3 py-3 text-ink-soft hover:bg-sunken" onClick={() => toggleRef(false)} aria-label="展开参考资料">
              <ChevronRight className="h-4 w-4" />
              <span className="font-serif text-sm" style={{ writingMode: 'vertical-rl' }}>
                参考资料
              </span>
            </button>
          ) : (
            <div className="card min-h-0 overflow-hidden" data-testid="panel-ref">{panels.ref}</div>
          )}
          <div className="card min-h-0 overflow-hidden" data-testid="panel-transcript">{panels.transcript}</div>
          <div className="card min-h-0 overflow-hidden" data-testid="panel-notes">{panels.notes}</div>
        </div>
      ) : medium ? (
        // Tablet: transcript beside a switchable materials / notes panel.
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(300px,1fr)] gap-3 p-3">
          <div className="card min-h-0 overflow-hidden" data-testid="panel-transcript">{panels.transcript}</div>
          <div className="card flex min-h-0 flex-col overflow-hidden">
            <div className="flex border-b border-line" role="tablist" aria-label="侧栏">
              {(
                [
                  ['notes', '人工笔记'],
                  ['ref', '参考资料'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={sideTab === k} className={`flex-1 py-2.5 text-sm ${sideTab === k ? 'border-b-2 border-primary font-medium text-primary' : 'text-muted'}`} onClick={() => setSideTab(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1" data-testid={sideTab === 'notes' ? 'panel-notes' : 'panel-ref'}>
              {sideTab === 'notes' ? panels.notes : panels.ref}
            </div>
          </div>
        </div>
      ) : (
        // Phone: one panel at a time, with the recorder always within reach.
        <>
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2">
            <span className="inline-flex items-center gap-2">
              <StatusBadge />
              <Timer />
            </span>
          </div>
          <div className="border-b border-line bg-surface px-3 py-2">
            <RecorderControls controls={controls} compact />
          </div>
          <div className="min-h-0 flex-1 bg-surface" data-testid={`panel-${tab === 'ref' ? 'ref' : tab}`}>
            {panels[tab]}
          </div>
          <nav className="grid grid-cols-3 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]" role="tablist" aria-label="工作台面板">
            {(
              [
                ['ref', '参考资料', BookOpen],
                ['transcript', '实时转录', ScrollText],
                ['notes', '人工笔记', NotebookPen],
              ] as const
            ).map(([k, label, Icon]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex flex-col items-center gap-0.5 py-2 text-xs ${tab === k ? 'text-primary' : 'text-muted'}`}>
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </nav>
        </>
      )}

      <ConfirmDialog
        open={!!leaveTo}
        onOpenChange={(o) => !o && setLeaveTo(null)}
        title="转录仍在进行"
        description="离开此页面会停止录音。已确认的转录与笔记都已保存；稍后可以回到这场会议点击“继续”。"
        confirmLabel="离开"
        onConfirm={async () => {
          const to = leaveTo!;
          setLeaveTo(null);
          await live.pause();
          await flushAllNotes(meetingId);
          nav(to);
        }}
      />
    </div>
  );
}
