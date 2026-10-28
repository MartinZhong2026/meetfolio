import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/auth';
import { Logo } from './ui';

export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const logout = async () => {
    await api.logout().catch(() => {});
    qc.clear();
    nav('/');
  };
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className={`mx-auto flex h-14 items-center justify-between gap-4 px-4 sm:px-6 ${wide ? 'max-w-[1500px]' : 'max-w-5xl'}`}>
          <Link to="/meetings" aria-label="Meetfolio 首页">
            <Logo />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink to="/meetings" className={({ isActive }) => `rounded-lg px-3 py-1.5 ${isActive ? 'bg-primary-soft text-primary' : 'text-ink-soft hover:bg-sunken'}`}>
              我的会议
            </NavLink>
            <NavLink to="/settings" aria-label="账户" className={({ isActive }) => `inline-flex items-center gap-1 rounded-lg px-3 py-1.5 ${isActive ? 'bg-primary-soft text-primary' : 'text-ink-soft hover:bg-sunken'}`}>
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">账户</span>
            </NavLink>
            <button onClick={logout} className="btn-ghost btn-sm ml-1" title={user?.email} aria-label="退出登录">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">退出</span>
            </button>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}

export function PageContainer({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <main className={`mx-auto px-4 pb-16 pt-8 sm:px-6 ${narrow ? 'max-w-2xl' : 'max-w-5xl'}`}>{children}</main>;
}
