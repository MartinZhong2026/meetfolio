import { Mic, Pause, Play, Square, Star } from 'lucide-react';
import { useState } from 'react';
import { fmtClock } from '../../lib/format';
import { useWorkspace } from '../../store/workspace';
import { Button, ConfirmDialog } from '../ui';
import { dotClasses, statusInfo, toneClasses } from './status';

export interface Controls {
  start(): Promise<void>;
  pause(): Promise<void> | void;
  resume(): Promise<void>;
  end(): Promise<void>;
  mark(): void;
  canStart: boolean;
  startBlockedReason?: string;
}

export function StatusBadge({ className = '' }: { className?: string }) {
  const rec = useWorkspace((s) => s.rec);
  const meeting = useWorkspace((s) => s.meeting);
  const info = statusInfo(rec, meeting);
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${toneClasses[info.tone]} ${className}`} data-testid="rec-status" role="status">
      <span className={`h-2 w-2 rounded-full ${dotClasses[info.tone]} ${info.dot ? 'rec-dot' : ''}`} aria-hidden />
      {info.label}
    </span>
  );
}

export function Timer({ className = '' }: { className?: string }) {
  const ms = useWorkspace((s) => s.rec.positionMs);
  return (
    <span className={`font-mono text-[1.05rem] tabular-nums tracking-tight ${className}`} data-testid="rec-timer" aria-label="已录制时长">
      {fmtClock(ms)}
    </span>
  );
}

function LevelMeter() {
  const level = useWorkspace((s) => s.rec.level);
  const w = Math.min(100, Math.round(Math.sqrt(level) * 220));
  return (
    <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-line sm:inline-block" aria-hidden title="麦克风音量">
      <span className="block h-full rounded-full bg-primary transition-[width] duration-100" style={{ width: `${w}%` }} />
    </span>
  );
}

export function RecorderControls({ controls, compact }: { controls: Controls; compact?: boolean }) {
  const state = useWorkspace((s) => s.rec.state);
  const meeting = useWorkspace((s) => s.meeting);
  const isDemo = meeting?.isDemo;
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const live = state === 'recording' || state === 'connecting' || state === 'reconnecting';
  const hasStarted = !!meeting && (meeting.recordedMs > 0 || meeting.transcriptStatus !== 'none');
  const label = isDemo ? '开始演示转录' : '开始转录';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : ''}`}>
      {!live && state !== 'paused' && (
        <Button variant="primary" onClick={() => run(hasStarted && !isDemo ? controls.resume : controls.start)} loading={busy} disabled={!controls.canStart} title={controls.startBlockedReason} data-testid="btn-start">
          <Mic className="h-4 w-4" />
          {hasStarted ? (meeting?.transcriptStatus === 'complete' ? '继续转录' : '继续') : label}
        </Button>
      )}
      {live && (
        <Button onClick={() => run(controls.pause)} loading={busy} data-testid="btn-pause">
          <Pause className="h-4 w-4" /> 暂停
        </Button>
      )}
      {state === 'paused' && (
        <Button variant="primary" onClick={() => run(controls.resume)} loading={busy} data-testid="btn-resume">
          <Play className="h-4 w-4" /> 继续
        </Button>
      )}
      {(live || state === 'paused') && (
        <Button onClick={() => setConfirmEnd(true)} data-testid="btn-end">
          <Square className="h-3.5 w-3.5" /> 结束
        </Button>
      )}
      <Button variant="ghost" onClick={controls.mark} disabled={!(live || state === 'paused')} title="把最近的一句话标记为重点（也会用于 AI 纪要）" data-testid="btn-mark">
        <Star className="h-4 w-4" /> 标记重点
      </Button>
      {(live || state === 'paused') && <LevelMeter />}
      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="结束这场转录？"
        description="结束后会保存最后一句话并进入复盘页。需要时，您仍可以回来“继续转录”。"
        confirmLabel="结束并保存"
        loading={busy}
        onConfirm={() => {
          setConfirmEnd(false);
          void run(controls.end);
        }}
      />
    </div>
  );
}
