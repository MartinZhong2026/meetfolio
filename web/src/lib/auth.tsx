import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import type { User } from './types';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: async () => (await api.me()).user, staleTime: 60_000 });
}

export function useSession() {
  const q = useMe();
  return { user: q.data as User | null | undefined, loading: q.isLoading };
}

/** Redirects to /login when there is no session; also reacts to 401s from any API call. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const loc = useLocation();
  const qc = useQueryClient();
  const nav = useNavigate();
  useEffect(() => {
    const h = () => {
      qc.setQueryData(['me'], null);
      nav(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
    };
    window.addEventListener('mf:unauthorized', h);
    return () => window.removeEventListener('mf:unauthorized', h);
  }, [qc, nav]);
  if (loading) return <div className="grid min-h-screen place-items-center text-muted">载入中…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
