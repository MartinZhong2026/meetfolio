import { ArrowLeft, Check, CloudOff, FileText, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDateLong } from '../../lib/format';
import { useWorkspace } from '../../store/workspace';
import { toast } from '../ui';
import { StatusBadge, Timer } from './RecorderControls';

export function SaveIndicator() {
  const save = useWorkspace((s) => s.save);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);
  if (save.failed) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-warn" role="status" data-testid="save-status">
        <CloudOff className="h-3.5 w-3.5" /> 保存遇到问题，正在重试
      </span>
    );
  }
  if (save.pending > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted" role="status" data-testid="save-status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 保存中…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-sm text-primary" role="status" data-testid="save-status">
      <Check className="h-3.5 w-3.5" /> 已自动保存
    </span>
  );
}

export function WorkspaceHeader({ onLeave, reviewHref }: { onLeave(to: string): void; reviewHref: string }) {
  const meeting = useWorkspace((s) => s.meeting)!;
  const patchMeeting = useWorkspace((s) => s.patchMeeting);
  const [title, setTitle] = useState<string | null>(null);
  const saveTitle = async () => {
    const v = (title ?? meeting.title).trim();
    setTitle(null);
    if (!v || v === meeting.title) return;
    patchMeeting({ title: v });
    try {
      await api.updateMeeting(meeting.id, { title: v });
    } catch {
      patchMeeting({ title: meeting.title });
      toast.error('重命名失败');
    }
  };
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-surface px-3 py-2 sm:px-4">
      <Link to="/meetings" className="btn-icon shrink-0" aria-label="返回我的会议" onClick={(e) => (e.preventDefault(), onLeave('/meetings'))}>
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <div className="min-w-0 flex-1">
        <input
          className="w-full min-w-[8rem] truncate rounded border border-transparent bg-transparent px-1 font-serif text-[1.08rem] font-semibold leading-tight hover:border-line focus:border-primary focus:bg-surface focus:outline-none"
          value={title ?? meeting.title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="会议标题"
          maxLength={200}
        />
        <p className="px-1 text-xs text-muted">{fmtDateLong(meeting.meetingDate)}</p>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <span className="hidden items-center gap-2 sm:inline-flex">
          <StatusBadge />
          <Timer className="text-ink !text-lg" />
        </span>
        <SaveIndicator />
        <a href={reviewHref} aria-label="复盘与纪要" className="btn-secondary btn-sm" onClick={(e) => (e.preventDefault(), onLeave(reviewHref))}>
          <FileText className="h-3.5 w-3.5" /> <span className="hidden sm:inline">复盘与纪要</span>
        </a>
      </div>
    </header>
  );
}
