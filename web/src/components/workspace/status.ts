import type { RecInfo } from '../../store/workspace';
import type { Meeting } from '../../lib/types';

export type Tone = 'idle' | 'live' | 'warn' | 'bad' | 'done';

/** The user-facing recording status. Wording follows the product spec (未开始 … 连接失败). */
export function statusInfo(rec: RecInfo, meeting: Pick<Meeting, 'transcriptStatus' | 'recordedMs'> | null): { label: string; tone: Tone; dot: boolean } {
  switch (rec.state) {
    case 'connecting':
      return { label: '正在连接', tone: 'warn', dot: false };
    case 'recording':
      if (rec.provider === 'reconnecting' || rec.provider === 'rotating') return { label: '语音服务重连中', tone: 'warn', dot: true };
      if (rec.provider === 'failed') return { label: '连接失败 · 仍在重试', tone: 'bad', dot: false };
      return { label: '转录中', tone: 'live', dot: true };
    case 'reconnecting':
      return rec.connectionFailed ? { label: '连接失败 · 仍在重试', tone: 'bad', dot: false } : { label: '重新连接中', tone: 'warn', dot: false };
    case 'paused':
      return { label: '已暂停', tone: 'idle', dot: false };
    case 'ended':
      return { label: '已结束', tone: 'done', dot: false };
    case 'failed':
      return { label: '连接失败', tone: 'bad', dot: false };
    default:
      if (meeting?.transcriptStatus === 'complete') return { label: '已结束', tone: 'done', dot: false };
      if (meeting?.transcriptStatus === 'interrupted') return { label: '已中断', tone: 'warn', dot: false };
      if (meeting && meeting.recordedMs > 0) return { label: '已暂停', tone: 'idle', dot: false };
      return { label: '未开始', tone: 'idle', dot: false };
  }
}

export const toneClasses: Record<Tone, string> = {
  idle: 'text-muted',
  live: 'text-primary-hover',
  warn: 'text-warn',
  bad: 'text-danger',
  done: 'text-ink-soft',
};
export const dotClasses: Record<Tone, string> = {
  idle: 'bg-muted',
  live: 'bg-rec',
  warn: 'bg-warn',
  bad: 'bg-danger',
  done: 'bg-muted',
};
