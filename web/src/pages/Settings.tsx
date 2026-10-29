import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, PageContainer } from '../components/AppShell';
import { Button, Field, Modal, toast, useDocumentTitle } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/auth';

export default function Settings() {
  useDocumentTitle('账户');
  const { user } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const usage = useQuery({ queryKey: ['usage'], queryFn: api.usage });
  const config = useQuery({ queryKey: ['config'], queryFn: api.config });
  const [name, setName] = useState(user?.name ?? '');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delError, setDelError] = useState<string | null>(null);

  const saveName = useMutation({
    mutationFn: () => api.updateName(name.trim()),
    onSuccess: ({ user: u }) => {
      qc.setQueryData(['me'], u);
      toast.success('已保存');
    },
    onError: () => toast.error('保存失败'),
  });
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    try {
      await api.changePassword(cur, next);
      setCur('');
      setNext('');
      toast.success('密码已更新，其他设备已退出登录');
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : '修改失败');
    }
  };
  const del = async () => {
    setDelError(null);
    try {
      await api.deleteAccount(delPw);
      qc.clear();
      nav('/');
    } catch (err) {
      setDelError(err instanceof ApiError ? err.message : '删除失败');
    }
  };
  const u = usage.data;

  return (
    <AppShell>
      <PageContainer narrow>
        <h1 className="font-serif text-3xl font-semibold">账户</h1>
        <p className="mt-1 text-sm text-muted">{user?.email}</p>

        <section className="card mt-6 space-y-4 p-5">
          <h2 className="font-serif text-lg font-semibold">个人信息</h2>
          <Field label="姓名" htmlFor="name">
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <Button variant="primary" onClick={() => saveName.mutate()} loading={saveName.isPending} disabled={!name.trim() || name.trim() === user?.name}>
            保存
          </Button>
        </section>

        <section className="card mt-4 p-5">
          <h2 className="font-serif text-lg font-semibold">修改密码</h2>
          <form onSubmit={changePw} className="mt-3 space-y-4">
            <Field label="当前密码" htmlFor="cur">
              <input id="cur" type="password" autoComplete="current-password" className="input" value={cur} onChange={(e) => setCur(e.target.value)} required />
            </Field>
            <Field label="新密码" htmlFor="new" hint="至少 8 位" error={pwError}>
              <input id="new" type="password" autoComplete="new-password" className="input" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required />
            </Field>
            <Button type="submit" variant="primary" disabled={!cur || next.length < 8}>
              更新密码
            </Button>
          </form>
        </section>

        <section className="card mt-4 p-5">
          <h2 className="font-serif text-lg font-semibold">用量</h2>
          <p className="mt-1 text-sm text-muted">仅供参考，帮助您了解自己的使用情况。</p>
          {u ? (
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">今日转录</dt>
                <dd className="text-lg font-semibold">
                  {u.today.asrMinutes} <span className="text-sm font-normal text-muted">/ {u.today.asrMinutesLimit} 分钟</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">今日 AI 纪要</dt>
                <dd className="text-lg font-semibold">
                  {u.today.aiSummaries} <span className="text-sm font-normal text-muted">/ {u.today.aiSummariesLimit} 次</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">近 30 天转录</dt>
                <dd>{u.last30Days.asrMinutes} 分钟</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">近 30 天连接异常</dt>
                <dd>{u.last30Days.providerErrors + u.last30Days.connectionFailures} 次</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted">载入中…</p>
          )}
        </section>

        <section className="card mt-4 p-5">
          <h2 className="font-serif text-lg font-semibold">数据与隐私</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
            <li>实时语音会通过加密连接发送给阿里云百炼（通义千问）进行识别；Meetfolio 默认不保存完整录音，只保存识别出的文字。</li>
            <li>转录、笔记、资料和纪要保存在 Meetfolio 的数据库中，仅您本人可访问。</li>
            <li>断线补录用的音频暂存在您当前浏览器的本地缓存里，确认转录后自动清理，最长保留 7 天。</li>
            <li>录音前请告知参与者并取得必要的许可。</li>
          </ul>
          {config.data && (
            <p className="mt-3 text-xs text-muted">
              语音识别服务：{config.data.asrConfigured ? '已配置' : '未配置'} · AI 纪要：{config.data.aiConfigured ? '已配置' : '未配置'} · 文件存储：{config.data.storageDriver}
            </p>
          )}
        </section>

        <section className="card mt-4 border-danger-line p-5">
          <h2 className="font-serif text-lg font-semibold text-danger">删除账户</h2>
          <p className="mt-1 text-sm text-ink-soft">将永久删除您的账户和所有会议、转录、笔记、资料与纪要，无法恢复。</p>
          <Button className="mt-3" variant="danger" onClick={() => setDeleting(true)}>
            删除我的账户
          </Button>
        </section>
      </PageContainer>
      <Modal open={deleting} onOpenChange={setDeleting} title="确认删除账户" description="请输入密码确认。此操作不可撤销。">
        <Field label="密码" htmlFor="dp" error={delError}>
          <input id="dp" type="password" className="input" value={delPw} onChange={(e) => setDelPw(e.target.value)} autoFocus />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setDeleting(false)}>取消</Button>
          <Button variant="danger" disabled={!delPw} onClick={() => void del()}>
            永久删除
          </Button>
        </div>
      </Modal>
    </AppShell>
  );
}
