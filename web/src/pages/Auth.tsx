import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Field, Logo, useDocumentTitle } from '../components/ui';
import { api, ApiError } from '../lib/api';

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex justify-center">
          <Logo />
        </Link>
        <div className="card p-6 sm:p-7">
          <h1 className="font-serif text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <p className="mt-5 text-center text-sm text-muted">{footer}</p>}
      </div>
    </div>
  );
}

function useAfterAuth() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  return (user: unknown) => {
    qc.setQueryData(['me'], user);
    const next = params.get('next');
    nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/meetings', { replace: true });
  };
}

export function Login() {
  useDocumentTitle('登录');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const after = useAfterAuth();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      after((await api.login({ email, password })).user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout
      title="登录"
      footer={
        <>
          还没有账户？ <Link to="/register" className="text-primary underline underline-offset-2 hover:no-underline">免费注册</Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="邮箱" htmlFor="email">
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="密码" htmlFor="password" error={error}>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          登录
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="text-muted underline underline-offset-2 hover:text-primary">
            忘记密码？
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function Register() {
  useDocumentTitle('注册');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const after = useAfterAuth();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('密码至少需要 8 位');
    setBusy(true);
    setError(null);
    try {
      after((await api.register({ email, password, name: name || undefined })).user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout
      title="创建账户"
      subtitle="用邮箱注册，即可在任何设备上访问您的会议记录。"
      footer={
        <>
          已有账户？ <Link to="/login" className="text-primary underline underline-offset-2 hover:no-underline">登录</Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="姓名（可选）" htmlFor="name">
          <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="邮箱" htmlFor="email">
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="密码" htmlFor="password" hint="至少 8 位" error={error}>
          <input id="password" className="input" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          注册并开始
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  useDocumentTitle('找回密码');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.forgot(email);
    } catch {
      /* the endpoint never reveals whether an account exists */
    }
    setSent(true);
    setBusy(false);
  };
  return (
    <AuthLayout title="找回密码" footer={<Link to="/login" className="text-primary underline underline-offset-2 hover:no-underline">返回登录</Link>}>
      {sent ? (
        <p className="text-sm leading-relaxed text-ink-soft">如果该邮箱已注册，我们已发送一封包含重置链接的邮件（1 小时内有效）。没有收到？请检查垃圾邮件，或联系管理员协助重置。</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="注册邮箱" htmlFor="email">
            <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            发送重置邮件
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  useDocumentTitle('重置密码');
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const token = params.get('token') ?? '';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.reset(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '重置失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="设置新密码">
      {done ? (
        <div className="space-y-4 text-sm">
          <p className="text-ink-soft">密码已更新，请使用新密码登录。</p>
          <Link to="/login" className="btn-primary w-full">
            去登录
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="新密码" htmlFor="password" hint="至少 8 位" error={error}>
            <input id="password" className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!token}>
            保存新密码
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
