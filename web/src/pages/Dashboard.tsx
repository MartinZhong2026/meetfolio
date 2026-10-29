import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FolderOpen, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell, PageContainer } from '../components/AppShell';
import { Menu, MenuItem } from '../components/Menu';
import { Button, ConfirmDialog, Modal, Spinner, toast, useDocumentTitle } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { fmtDateLong, fmtDuration, fmtRelative } from '../lib/format';
import type { Meeting } from '../lib/types';
import { meetingTypeLabel, summaryStatusLabel, transcriptStatusLabel } from '../lib/zh';

export const meetingPath = (m: Pick<Meeting, 'id' | 'transcriptStatus'>) => (m.transcriptStatus === 'complete' ? `/meetings/${m.id}` : `/meetings/${m.id}/live`);

function StatusChip({ kind, label, tone }: { kind: string; label: string; tone: 'ok' | 'warn' | 'live' | 'idle' | 'bad' }) {
  const cls = {
    ok: 'border-primary-ring bg-primary-soft text-primary-hover',
    warn: 'border-warn-line bg-warn-soft text-warn',
    live: 'border-primary-ring bg-primary-soft text-primary-hover',
    idle: 'border-line bg-sunken text-muted',
    bad: 'border-danger-line bg-danger-soft text-danger',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      <span className="opacity-70">{kind}</span>
      {label}
    </span>
  );
}

function MeetingRow({ m, onRename, onDelete }: { m: Meeting; onRename(m: Meeting): void; onDelete(m: Meeting): void }) {
  const t = m.transcriptStatus;
  const s = m.summaryStatus;
  return (
    <li className="card flex items-stretch gap-2 transition-shadow hover:shadow-pop">
      <Link to={meetingPath(m)} className="min-w-0 flex-1 rounded-xl2 px-4 py-4 sm:px-5" data-testid="meeting-link">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="truncate font-serif text-[1.08rem] font-semibold">{m.title}</h2>
          {m.isDemo && <span className="chip border-warn-line bg-warn-soft text-warn">演示</span>}
        </div>
        <p className="mt-1 text-sm text-muted">
          {fmtDateLong(m.meetingDate)} · {meetingTypeLabel(m.type)}
          {m.location ? ` · ${m.location}` : ''}
          {m.durationMs ? ` · ${fmtDuration(m.durationMs)}` : ''}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <StatusChip kind="转录" label={transcriptStatusLabel(m)} tone={t === 'complete' ? 'ok' : t === 'in_progress' ? 'live' : t === 'interrupted' ? 'warn' : 'idle'} />
          <StatusChip kind="纪要" label={summaryStatusLabel(m)} tone={s === 'ready' ? 'ok' : s === 'failed' ? 'bad' : s === 'generating' ? 'live' : 'idle'} />
          <span className="text-xs text-muted">修改于 {fmtRelative(m.updatedAt)}</span>
        </div>
      </Link>
      <div className="flex items-start p-2">
        <Menu label={`“${m.title}”的更多操作`} trigger={<MoreHorizontal className="h-5 w-5" />}>
          {(close) => (
            <>
              <MenuItem href={meetingPath(m)} onClick={close}>
                <FolderOpen className="h-4 w-4" /> 打开
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  onRename(m);
                }}
              >
                <Pencil className="h-4 w-4" /> 重命名
              </MenuItem>
              <div className="my-1 border-t border-line" />
              <p className="px-3 pb-1 pt-1.5 text-xs text-muted">导出</p>
              <MenuItem href={api.exportUrl(m.id, 'docx')} onClick={close}>
                <Download className="h-4 w-4" /> Word (.docx)
              </MenuItem>
              <MenuItem href={api.exportUrl(m.id, 'md')} onClick={close}>
                <Download className="h-4 w-4" /> Markdown
              </MenuItem>
              <MenuItem href={api.exportUrl(m.id, 'txt')} onClick={close}>
                <Download className="h-4 w-4" /> 纯文本
              </MenuItem>
              <div className="my-1 border-t border-line" />
              <MenuItem
                danger
                onClick={() => {
                  close();
                  onDelete(m);
                }}
              >
                <Trash2 className="h-4 w-4" /> 删除
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </li>
  );
}

export default function Dashboard() {
  useDocumentTitle('我的会议');
  const nav = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const list = useQuery({ queryKey: ['meetings', q], queryFn: () => api.meetings(q), placeholderData: (prev) => prev });
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 5 * 60_000 });
  const [renaming, setRenaming] = useState<Meeting | null>(null);
  const [title, setTitle] = useState('');
  const [deleting, setDeleting] = useState<Meeting | null>(null);

  const rename = useMutation({
    mutationFn: () => api.updateMeeting(renaming!.id, { title: title.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      setRenaming(null);
      toast.success('已重命名');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '重命名失败'),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteMeeting(deleting!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      setDeleting(null);
      toast.success('会议已删除');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '删除失败'),
  });
  const demo = useMutation({
    mutationFn: () => api.createMeeting({ title: '演示：养老护理员访谈', type: 'academic_interview', demo: true, guideTopic: '养老护理员职业发展' }),
    onSuccess: async ({ meeting }) => {
      await api.importGuide(meeting.id, '研究主题：养老护理员职业发展\n问题一：目前护理人员最主要的工作困难是什么？\n问题二：您认为护理人员的专业培训是否充分？\n问题三：人工智能技术可能如何改变护理工作？');
      nav(`/meetings/${meeting.id}/live`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '创建失败'),
  });

  const meetings = list.data?.meetings ?? [];
  return (
    <AppShell>
      <PageContainer>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-semibold">我的会议</h1>
            <p className="mt-1 text-sm text-muted">您的访谈与会议笔记本，所有设备同步。</p>
          </div>
          <Link to="/meetings/new" className="btn-primary">
            <Plus className="h-4 w-4" /> 新建会议
          </Link>
        </div>

        <div className="relative mt-6">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="input pl-9" type="search" placeholder="搜索标题、地点、参与者或转录内容" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="搜索会议" />
        </div>

        <div className="mt-5">
          {list.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-muted">
              <Spinner /> 载入中…
            </div>
          ) : list.isError ? (
            <div className="card p-8 text-center text-sm text-danger">无法载入会议列表，请检查网络后<button className="underline" onClick={() => list.refetch()}>重试</button>。</div>
          ) : meetings.length === 0 ? (
            <div className="card px-6 py-14 text-center">
              {q ? (
                <p className="text-ink-soft">没有找到与“{q}”相关的会议。</p>
              ) : (
                <>
                  <h2 className="font-serif text-xl font-semibold">还没有会议</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">新建一场会议只需要一个标题。资料、提纲与参与者都可以稍后再补充。</p>
                  <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <Link to="/meetings/new" className="btn-primary">
                      <Plus className="h-4 w-4" /> 新建会议
                    </Link>
                    {config.data?.demoEnabled && (
                      <Button onClick={() => demo.mutate()} loading={demo.isPending}>
                        体验演示会议
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <ul className="space-y-3" aria-label="会议列表">
              {meetings.map((m) => (
                <MeetingRow
                  key={m.id}
                  m={m}
                  onRename={(x) => {
                    setRenaming(x);
                    setTitle(x.title);
                  }}
                  onDelete={setDeleting}
                />
              ))}
            </ul>
          )}
          {config.data?.demoEnabled && meetings.length > 0 && !q && (
            <p className="mt-6 text-center text-sm text-muted">
              想先试试？ <button className="text-primary underline underline-offset-2 hover:no-underline" onClick={() => demo.mutate()}>创建演示会议</button>（使用模拟转录，不调用语音服务）
            </p>
          )}
        </div>
      </PageContainer>

      <Modal open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)} title="重命名会议">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) rename.mutate();
          }}
          className="space-y-4"
        >
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus aria-label="会议标题" />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button type="submit" variant="primary" loading={rename.isPending} disabled={!title.trim()}>
              保存
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="删除这场会议？"
        description={`“${deleting?.title ?? ''}”的转录、笔记、资料和纪要将被永久删除，无法恢复。建议先导出备份。`}
        confirmLabel="永久删除"
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </AppShell>
  );
}
