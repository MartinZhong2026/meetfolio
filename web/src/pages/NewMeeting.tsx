import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Plus, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, PageContainer } from '../components/AppShell';
import { Button, Field, toast, useDocumentTitle } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/auth';
import { toDatetimeLocal } from '../lib/format';
import type { MeetingType, Participant } from '../lib/types';
import { MEETING_TYPES } from '../lib/zh';

export default function NewMeeting() {
  useDocumentTitle('新建会议');
  const nav = useNavigate();
  const { user } = useSession();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(toDatetimeLocal(new Date()));
  const [type, setType] = useState<MeetingType>('academic_interview');
  const [more, setMore] = useState(false);
  const [location, setLocation] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [context, setContext] = useState('');
  const [people, setPeople] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.createMeeting({
        title: title.trim(),
        meetingDate: date ? new Date(date).toISOString() : undefined,
        type,
        location: location.trim() || undefined,
        organizer: (organizer || user?.name || '').trim() || undefined,
        researchContext: context.trim() || undefined,
        participants: people.filter((p) => p.name.trim()).map((p) => ({ ...p, name: p.name.trim() })),
      }),
    onSuccess: ({ meeting }) => nav(`/meetings/${meeting.id}/live`),
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : '创建失败，请重试');
      toast.error('创建失败');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('请输入会议标题');
    setError(null);
    create.mutate();
  };

  return (
    <AppShell>
      <PageContainer narrow>
        <h1 className="font-serif text-3xl font-semibold">新建会议</h1>
        <p className="mt-1 text-sm text-muted">只需要一个标题就可以开始，其他信息随时可以补充。</p>
        <form onSubmit={submit} className="card mt-6 space-y-5 p-5 sm:p-6" noValidate>
          <Field label="会议标题" htmlFor="title" error={error}>
            <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：社区养老服务专题访谈" maxLength={200} autoFocus required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="会议类型" htmlFor="type">
              <select id="type" className="input" value={type} onChange={(e) => setType(e.target.value as MeetingType)}>
                {MEETING_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="日期与时间" htmlFor="date">
              <input id="date" className="input" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <button type="button" className="inline-flex items-center gap-1 text-sm text-primary" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            <ChevronDown className={`h-4 w-4 transition-transform ${more ? 'rotate-180' : ''}`} /> 更多信息（可选）
          </button>

          {more && (
            <div className="space-y-5 border-t border-line pt-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="地点" htmlFor="loc">
                  <input id="loc" className="input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
                </Field>
                <Field label="组织者" htmlFor="org">
                  <input id="org" className="input" value={organizer} onChange={(e) => setOrganizer(e.target.value)} placeholder={user?.name} maxLength={120} />
                </Field>
              </div>
              <div>
                <span className="label">参与者</span>
                <div className="space-y-2">
                  {people.map((p, i) => (
                    <div key={i} className="flex gap-2">
                      <input className="input" placeholder="姓名" aria-label={`参与者 ${i + 1} 姓名`} value={p.name} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <select className="input w-32 shrink-0" aria-label={`参与者 ${i + 1} 角色`} value={p.role} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, role: e.target.value as Participant['role'] } : x)))}>
                        <option value="interviewer">访谈员</option>
                        <option value="interviewee">受访者</option>
                        <option value="other">其他</option>
                      </select>
                      <button type="button" className="btn-icon shrink-0" aria-label="移除参与者" onClick={() => setPeople(people.filter((_, j) => j !== i))}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button type="button" size="sm" className="mt-2" onClick={() => setPeople([...people, { name: '', role: 'interviewee' }])}>
                  <Plus className="h-3.5 w-3.5" /> 添加参与者
                </Button>
              </div>
              <Field label="研究背景" htmlFor="ctx" hint="研究问题、访谈对象等。仅作为背景供 AI 参考，不会被当作发言内容。">
                <textarea id="ctx" className="input min-h-[96px]" value={context} onChange={(e) => setContext(e.target.value)} maxLength={20000} />
              </Field>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
            <p className="text-xs leading-relaxed text-muted">录音前，请告知参与者并取得必要的许可。</p>
            <Button type="submit" variant="primary" loading={create.isPending}>
              创建并进入工作台
            </Button>
          </div>
        </form>
      </PageContainer>
    </AppShell>
  );
}
