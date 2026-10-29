import { useQuery } from '@tanstack/react-query';
import { Download, Mic, Pencil, Plus, Star, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Menu, MenuItem } from '../components/Menu';
import { SummaryView } from '../components/review/SummaryView';
import { TranscriptReview } from '../components/review/TranscriptReview';
import { Button, Field, Modal, Spinner, toast, useDocumentTitle } from '../components/ui';
import { NotesPanel } from '../components/workspace/NotesPanel';
import { ReferencePanel } from '../components/workspace/ReferencePanel';
import { jumpToSegment } from '../components/workspace/TranscriptPanel';
import { api, ApiError } from '../lib/api';
import { effectiveText, fmtClock, fmtDateLong, fmtDuration, toDatetimeLocal } from '../lib/format';
import type { MeetingType, Participant } from '../lib/types';
import { MEETING_TYPES, meetingTypeLabel, noteCategoryLabel, transcriptStatusLabel } from '../lib/zh';
import { flushAllNotes, restoreNoteDrafts, useWorkspace } from '../store/workspace';

type Tab = 'summary' | 'transcript' | 'highlights' | 'notes' | 'materials';

function EditMeetingModal({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const meeting = useWorkspace((s) => s.meeting)!;
  const participants = useWorkspace((s) => s.participants);
  const [f, setF] = useState({ title: '', date: '', type: 'general' as MeetingType, location: '', organizer: '', context: '' });
  const [people, setPeople] = useState<Participant[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setF({ title: meeting.title, date: toDatetimeLocal(meeting.meetingDate), type: meeting.type, location: meeting.location, organizer: meeting.organizer, context: meeting.researchContext });
      setPeople(participants.map((p) => ({ ...p })));
    }
  }, [open, meeting, participants]);
  const save = async () => {
    setBusy(true);
    try {
      const { meeting: m } = await api.updateMeeting(meeting.id, {
        title: f.title.trim(),
        meetingDate: new Date(f.date).toISOString(),
        type: f.type,
        location: f.location,
        organizer: f.organizer,
        researchContext: f.context,
        participants: people.filter((p) => p.name.trim()),
      });
      useWorkspace.setState({ meeting: m, participants: people.filter((p) => p.name.trim()) });
      onOpenChange(false);
      toast.success('已保存');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="编辑会议信息" wide>
      <div className="space-y-4">
        <Field label="标题" htmlFor="e-title">
          <input id="e-title" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="类型" htmlFor="e-type">
            <select id="e-type" className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as MeetingType })}>
              {MEETING_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="日期与时间" htmlFor="e-date">
            <input id="e-date" type="datetime-local" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="地点" htmlFor="e-loc">
            <input id="e-loc" className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
          </Field>
          <Field label="组织者" htmlFor="e-org">
            <input id="e-org" className="input" value={f.organizer} onChange={(e) => setF({ ...f, organizer: e.target.value })} />
          </Field>
        </div>
        <div>
          <span className="label">参与者</span>
          <div className="space-y-2">
            {people.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input className="input" aria-label={`参与者 ${i + 1}`} value={p.name} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <select className="input w-32 shrink-0" aria-label="角色" value={p.role} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, role: e.target.value as Participant['role'] } : x)))}>
                  <option value="interviewer">访谈员</option>
                  <option value="interviewee">受访者</option>
                  <option value="other">其他</option>
                </select>
                <button className="btn-icon shrink-0" aria-label="移除" onClick={() => setPeople(people.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-2" onClick={() => setPeople([...people, { name: '', role: 'interviewee' }])}>
            <Plus className="h-3.5 w-3.5" /> 添加参与者
          </Button>
        </div>
        <Field label="研究背景" htmlFor="e-ctx">
          <textarea id="e-ctx" className="input min-h-[96px]" value={f.context} onChange={(e) => setF({ ...f, context: e.target.value })} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>取消</Button>
        <Button variant="primary" loading={busy} disabled={!f.title.trim()} onClick={() => void save()}>
          保存
        </Button>
      </div>
    </Modal>
  );
}

function Highlights({ onOpen }: { onOpen(seq: number): void }) {
  const segments = useWorkspace((s) => s.segments);
  const notes = useWorkspace((s) => s.notes);
  const items = [
    ...segments.filter((s) => s.isImportant).map((s) => ({ at: s.startMs, kind: 'seg' as const, text: effectiveText(s), who: s.speakerLabel, seq: s.seq })),
    ...notes.filter((n) => n.isImportant && n.content.trim()).map((n) => ({ at: n.timestampMs ?? 0, kind: 'note' as const, text: n.content, who: noteCategoryLabel(n.category), seq: undefined as number | undefined })),
  ].sort((a, b) => a.at - b.at);
  if (!items.length) return <div className="card px-6 py-12 text-center text-sm text-muted">还没有重点。在转录中点星标，或用“标记重点”按钮，重要时刻会汇集在这里。</div>;
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="card flex gap-3 px-4 py-3">
          <Star className="mt-1 h-4 w-4 shrink-0 text-warn" fill="currentColor" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="font-mono">{fmtClock(it.at)}</span>
              <span className="chip py-0">{it.kind === 'seg' ? it.who || '转录' : `笔记 · ${it.who}`}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{it.text}</p>
          </div>
          {it.seq !== undefined && (
            <Button size="sm" variant="ghost" onClick={() => onOpen(it.seq!)}>
              查看原文
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function Review() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const bundle = useQuery({ queryKey: ['bundle-review', id], queryFn: () => api.bundle(id), staleTime: 0, gcTime: 0, refetchOnMount: 'always' });
  const loaded = useWorkspace((s) => s.loaded && s.meetingId === id);
  const meeting = useWorkspace((s) => s.meeting);
  const participants = useWorkspace((s) => s.participants);
  const segments = useWorkspace((s) => s.segments);
  const [tab, setTab] = useState<Tab>('summary');
  const [editing, setEditing] = useState(false);
  useDocumentTitle(meeting?.title ?? '会议复盘');

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
      <AppShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="font-serif text-xl font-semibold">{e.status === 404 ? '找不到这场会议' : '无法载入会议'}</h1>
          <p className="mt-2 text-sm text-muted">{e.status === 404 ? '它可能已被删除，或不属于当前账户。' : e.message}</p>
          <Button className="mt-4" variant="primary" onClick={() => nav('/meetings')}>
            返回我的会议
          </Button>
        </div>
      </AppShell>
    );
  }
  if (!loaded || !meeting) {
    return (
      <AppShell>
        <div className="flex items-center justify-center gap-2 py-32 text-muted">
          <Spinner /> 载入中…
        </div>
      </AppShell>
    );
  }

  const jump = (t: { kind: 'segment' | 'note' | 'doc'; seq?: number }) => {
    if (t.kind === 'segment' && t.seq !== undefined) {
      setTab('transcript');
      setTimeout(() => jumpToSegment(t.seq!), 120);
    } else setTab(t.kind === 'note' ? 'notes' : 'materials');
  };

  const tabs: Array<[Tab, string]> = [
    ['summary', 'AI 纪要'],
    ['transcript', '转录'],
    ['highlights', '重点'],
    ['notes', '笔记'],
    ['materials', '资料'],
  ];
  const peopleText = participants.map((p) => p.name + (p.role === 'interviewer' ? '（访谈员）' : p.role === 'interviewee' ? '（受访者）' : '')).join('、');

  return (
    <AppShell>
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-3xl font-semibold leading-tight" data-testid="review-title">
              {meeting.title}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {fmtDateLong(meeting.meetingDate)} · {meetingTypeLabel(meeting.type)}
              {meeting.location ? ` · ${meeting.location}` : ''} · 时长 {fmtDuration(Math.max(meeting.durationMs, meeting.recordedMs))} · 转录{transcriptStatusLabel(meeting)}
              {meeting.isDemo && <span className="chip ml-2 border-warn-line bg-warn-soft py-0 text-warn">演示</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> 编辑信息
            </Button>
            <Link to={`/meetings/${id}/live`} className="btn-secondary btn-sm">
              <Mic className="h-3.5 w-3.5" /> 回到工作台
            </Link>
            <Menu label="导出" triggerClass="btn-secondary btn-sm" trigger={<><Download className="h-3.5 w-3.5" /> 导出</>}>
              {(close) => (
                <>
                  <MenuItem href={api.exportUrl(id, 'docx')} onClick={close}>
                    Word (.docx)
                  </MenuItem>
                  <MenuItem href={api.exportUrl(id, 'md')} onClick={close}>
                    Markdown (.md)
                  </MenuItem>
                  <MenuItem href={api.exportUrl(id, 'txt')} onClick={close}>
                    纯文本 (.txt)
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>

        {(peopleText || meeting.organizer || meeting.researchContext) && (
          <dl className="card mt-5 grid gap-x-8 gap-y-2 p-4 text-sm sm:grid-cols-2">
            {meeting.organizer && (
              <div>
                <dt className="text-xs text-muted">组织者</dt>
                <dd>{meeting.organizer}</dd>
              </div>
            )}
            {peopleText && (
              <div>
                <dt className="text-xs text-muted">参与者</dt>
                <dd>{peopleText}</dd>
              </div>
            )}
            {meeting.researchContext && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted">研究背景</dt>
                <dd className="whitespace-pre-wrap text-ink-soft">{meeting.researchContext}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="sticky top-14 z-20 -mx-4 mt-6 border-b border-line bg-bg/95 px-4 backdrop-blur sm:-mx-6 sm:px-6" role="tablist" aria-label="复盘内容">
          <div className="scroll-quiet flex gap-1 overflow-x-auto">
            {tabs.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`tab-${k}`} className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm ${tab === k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-ink'}`}>
                {label}
                {k === 'transcript' && <span className="ml-1 text-xs text-muted">{segments.length}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          {tab === 'summary' && <SummaryView meetingId={id} onJump={jump} />}
          {tab === 'transcript' && <TranscriptReview meetingId={id} />}
          {tab === 'highlights' && <Highlights onOpen={(seq) => jump({ kind: 'segment', seq })} />}
          {tab === 'notes' && (
            <div className="card h-[70vh] overflow-hidden">
              <NotesPanel meetingId={id} />
            </div>
          )}
          {tab === 'materials' && (
            <div className="card h-[70vh] overflow-hidden">
              <ReferencePanel meetingId={id} />
            </div>
          )}
        </div>
      </main>
      <EditMeetingModal open={editing} onOpenChange={setEditing} />
    </AppShell>
  );
}
