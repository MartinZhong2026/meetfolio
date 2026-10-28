import { type ReactNode, useEffect, useRef, useState } from 'react';

export function Menu({ trigger, label, children, align = 'right', triggerClass = 'btn-icon' }: { trigger: ReactNode; label: string; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; triggerClass?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" className={triggerClass} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div role="menu" className={`absolute z-30 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-pop ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, href, danger }: { children: ReactNode; onClick?: () => void; href?: string; danger?: boolean }) {
  const cls = `flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-sunken ${danger ? 'text-danger' : 'text-ink'}`;
  return href ? (
    <a role="menuitem" href={href} className={cls} onClick={onClick}>
      {children}
    </a>
  ) : (
    <button role="menuitem" type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}
