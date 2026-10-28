import type { Gap, Meeting, MeetingType, NoteCategory } from './types';

export const MEETING_TYPES: Array<{ value: MeetingType; label: string }> = [
  { value: 'academic_interview', label: '学术访谈' },
  { value: 'fieldwork', label: '田野调查' },
  { value: 'research_group', label: '研究组会' },
  { value: 'seminar', label: '专题研讨' },
  { value: 'user_interview', label: '用户访谈' },
  { value: 'general', label: '普通会议' },
  { value: 'other', label: '其他' },
];
export const meetingTypeLabel = (t: MeetingType) => MEETING_TYPES.find((x) => x.value === t)?.label ?? t;

export const NOTE_CATEGORIES: Array<{ value: NoteCategory; label: string; hint: string }> = [
  { value: 'general', label: '普通笔记', hint: '随手记录' },
  { value: 'quote', label: '客户/受访者原话', hint: '记下对方的原话' },
  { value: 'observation', label: '研究者观察', hint: '神态、环境、氛围' },
  { value: 'finding', label: '重要发现', hint: '值得深入的线索' },
  { value: 'followup', label: '追问问题', hint: '稍后想追问的' },
  { value: 'todo', label: '待办事项', hint: '会后要做的事' },
];
export const noteCategoryLabel = (c: NoteCategory) => NOTE_CATEGORIES.find((x) => x.value === c)?.label ?? c;

export const transcriptStatusLabel = (m: Pick<Meeting, 'transcriptStatus'>) =>
  ({ none: '未开始', in_progress: '进行中', interrupted: '已中断', complete: '已完成' })[m.transcriptStatus];
export const summaryStatusLabel = (m: Pick<Meeting, 'summaryStatus'>) =>
  ({ none: '未生成', generating: '生成中', ready: '已生成', failed: '生成失败' })[m.summaryStatus];

export const GAP_REASON: Record<string, string> = {
  network: '网络中断',
  provider: '语音服务暂时不可用',
  capture_stopped: '录音暂停',
  page_reload: '页面刷新或关闭',
  server_restart: '服务重启',
};
export const GAP_STATUS: Record<Gap['status'], string> = {
  open: '待补录',
  recovering: '补录中…',
  recovered: '已补录',
  partial: '部分补录',
  unrecoverable: '无法找回',
};

export const ERROR_HINTS: Record<string, string> = {
  asr_not_configured: '语音识别服务尚未配置。请联系管理员设置 DASHSCOPE_API_KEY，或使用演示模式体验。',
  another_session: '您有另一场会议正在转录，请先结束它。',
  asr_daily_limit: '今日转录时长已达上限。',
  asr_fatal: '语音识别服务暂不可用，已保留本机录音，稍后可补录。',
  asr_unreachable: '暂时无法连接语音识别服务，仍在重试；录音已保留。',
  replaced: '已在另一个窗口继续转录，本窗口已停止。',
  persist_failed: '部分转录内容未能保存，请检查网络。',
};
