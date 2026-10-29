import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui';
import { RequireAuth } from './lib/auth';
import { ForgotPassword, Login, Register, ResetPassword } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Landing from './pages/Landing';
import NewMeeting from './pages/NewMeeting';

// The workspace and review screens carry the heavy dependencies (Markdown renderer, audio pipeline); load them on demand.
const DesktopApp = lazy(() => import('./desktop/DesktopApp'));
const Review = lazy(() => import('./pages/Review'));
const Settings = lazy(() => import('./pages/Settings'));
const Workspace = lazy(() => import('./pages/Workspace'));

export default function App() {
  return (
    <>
      <Suspense fallback={<div className="grid min-h-screen place-items-center text-muted">载入中…</div>}>
      <Routes>
        <Route path="/desktop/*" element={<DesktopApp />} />
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/meetings" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/meetings/new" element={<RequireAuth><NewMeeting /></RequireAuth>} />
        <Route path="/meetings/:id/live" element={<RequireAuth><Workspace /></RequireAuth>} />
        <Route path="/meetings/:id" element={<RequireAuth><Review /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}
