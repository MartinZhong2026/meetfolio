import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect } from 'react';
import { create } from 'zustand';

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} aria-hidden />;
}

export function Button({
  variant = 'secondary',
  size,
  loading,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm'; loading?: boolean }) {
  const cls = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'btn-danger' }[variant];
  return (
    <button {...rest} disabled={rest.disabled || loading} className={`${cls} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[1px]" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl2 border border-line bg-surface p-6 shadow-pop ${wide ? 'max-w-2xl' : 'max-w-md'}`}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-serif text-lg font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="btn-icon -mr-2 -mt-1" aria-label="关闭">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认',
  danger,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm(): void;
  loading?: boolean;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// --- Toasts --------------------------------------------------------------------------------------------------------

interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}
interface ToastState {
  toasts: Toast[];
  push(kind: Toast['kind'], text: string): void;
  dismiss(id: number): void;
}
let toastId = 0;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push(kind, text) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
export const toast = {
  info: (t: string) => useToasts.getState().push('info', t),
  success: (t: string) => useToasts.getState().push('success', t),
  error: (t: string) => useToasts.getState().push('error', t),
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-pop ${
            t.kind === 'error' ? 'border-danger-line bg-danger-soft text-danger' : t.kind === 'success' ? 'border-primary-ring bg-primary-soft text-primary-hover' : 'border-line bg-surface text-ink'
          }`}
        >
          {t.kind === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{t.text}</span>
          <button className="ml-1 opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)} aria-label="关闭提示">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Notice({ kind = 'info', children, action }: { kind?: 'info' | 'warn' | 'danger'; children: ReactNode; action?: ReactNode }) {
  const cls = { info: 'border-line bg-surface text-ink-soft', warn: 'border-warn-line bg-warn-soft text-warn', danger: 'border-danger-line bg-danger-soft text-danger' }[kind];
  return (
    <div role={kind === 'info' ? 'note' : 'alert'} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
      {kind === 'info' ? <Info className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · Meetfolio` : 'Meetfolio · Every conversation, thoughtfully captured.';
    return () => {
      document.title = prev;
    };
  }, [title]);
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-serif text-lg font-semibold tracking-wide text-ink ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#355F52" />
        <path d="M8 22V10.5l8 8.2 8-8.2V22" fill="none" stroke="#F8F7F4" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Meetfolio
    </span>
  );
}
