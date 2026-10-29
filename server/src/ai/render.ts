import { fmtDateZh, fmtDuration, fmtMs } from '../lib/time.js';
import { noteCategoryLabel } from './evidence.js';
import type { SummaryInput, SummaryJson } from './types.js';

const TYPE_ZH: Record<string, string> = {
  academic_interview: '学术访谈',
  fieldwork: '田野调查',
  research_group: '研究组会',
  seminar: '专题研讨',
  user_interview: '用户访谈',
  general: '普通会议',
  other: '其他',
};
export const meetingTypeLabel = (t: string) => TYPE_ZH[t] ?? t;

/** `[00:02:15](#seg-12)` style links so the UI (and exported Markdown) can point back to evidence. */
function cite(j: SummaryJson, sources: string[]) {
  const out: string[] = [];
  for (const s of sources) {
    const r = j.refs[s];
    if (!r) continue;
    if (r.kind === 'segment') out.push(`[${fmtMs(r.startMs ?? 0)}](#seg-${r.seq})`);
    else if (r.kind === 'note') out.push(`[笔记${s.slice(1)}](#note-${r.id})`);
    else out.push(`[资料：${r.title}](#doc-${r.id})`);
  }
  return out.length ? ` ${out.join(' ')}` : '';
}

/**
 * Renders the editable Markdown report. Sections 一 and the "研究者笔记" parts are produced from stored
 * data, never by the model, so human-written content is reproduced verbatim and clearly labelled.
 */
export function renderSummaryMarkdown(input: SummaryInput, j: SummaryJson, opts: { interim?: boolean } = {}): string {
  const m = input.meeting;
  const notes = [...input.notes].filter((n) => n.content.trim()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const byCat = (c: string) => notes.filter((n) => n.category === c);
  const noteLine = (n: (typeof notes)[number]) => `- ${n.timestampMs !== null ? `[${fmtMs(n.timestampMs)}] ` : ''}${n.content.trim().replace(/\n+/g, '\n  ')}${n.isImportant ? ' ★' : ''}`;
  const L: string[] = [];

  L.push(`# ${m.title}${opts.interim ? '（中期纪要）' : ''}`, '');
  L.push('> 说明：本纪要由 AI 根据转录与笔记整理。**“受访者观点”仅来自转录；“研究者笔记”为人工记录原文；标注“AI 推断/AI 建议”的内容是模型的解释，并非参与者所说。** 点击时间戳可定位到转录原文。', '');

  L.push('## 一、会议基本信息', '');
  L.push(`- 标题：${m.title}`, `- 日期：${fmtDateZh(m.meetingDate)}`, `- 类型：${meetingTypeLabel(m.type)}`);
  if (m.location) L.push(`- 地点：${m.location}`);
  if (m.organizer) L.push(`- 组织者：${m.organizer}`);
  if (input.participants.length) L.push(`- 参与者：${input.participants.map((p) => p.name + (p.role === 'interviewer' ? '（访谈员）' : p.role === 'interviewee' ? '（受访者）' : '')).join('、')}`);
  const dur = Math.max(m.durationMs, m.recordedMs);
  if (dur) L.push(`- 录音时长：${fmtDuration(dur)}`);
  L.push('');

  L.push('## 二、访谈背景与研究目的', '');
  L.push(j.background.text ? `${j.background.text}${cite(j, j.background.sources)}` : '（未提供背景材料）', '');
  if (j.background.text) L.push('_以上背景来自研究者填写的信息与参考资料，不是会议中的发言。_', '');

  L.push('## 三、核心讨论主题', '');
  if (j.themes.length) for (const t of j.themes) L.push(`### ${t.title}`, '', `${t.text}${cite(j, t.sources)}`, '');
  else L.push('（转录内容不足以归纳主题）', '');

  L.push('## 四、受访者主要观点', '');
  if (j.participantViews.length) for (const v of j.participantViews) L.push(`- **${v.speaker}**：${v.text}${cite(j, v.sources)}`);
  else L.push('（暂无）');
  L.push('');

  L.push('## 五、重要原话与时间定位', '');
  if (j.quotes.length) for (const q of j.quotes) L.push(`> “${q.text}” —— ${q.speaker}${cite(j, [q.source])}`, '');
  else L.push('（暂无已核实的原话）', '');
  const quoteNotes = byCat('quote');
  if (quoteNotes.length) L.push('**研究者记录的受访者原话（人工笔记）**', '', ...quoteNotes.map(noteLine), '');

  L.push('## 六、研究者现场观察', '');
  const obs = byCat('observation');
  L.push(...(obs.length ? ['_以下为研究者的人工笔记原文，未经 AI 改写。_', '', ...obs.map(noteLine)] : ['（研究者尚未记录现场观察）']), '');

  L.push('## 七、值得关注的研究发现', '');
  const found = byCat('finding');
  if (found.length) L.push('**研究者记录的重要发现（人工笔记）**', '', ...found.map(noteLine), '');
  if (j.findings.length) {
    L.push('**AI 推断（需研究者核实，不代表参与者所说）**', '');
    for (const f of j.findings) L.push(`- ${f.text}${cite(j, f.sources)}`);
    L.push('');
  } else if (!found.length) L.push('（暂无）', '');

  L.push('## 八、尚未解决的问题', '');
  if (j.openQuestions.length) for (const q of j.openQuestions) L.push(`- ${q.text}${cite(j, q.sources)}`);
  else L.push('（暂无）');
  L.push('');

  L.push('## 九、建议继续追问的问题', '');
  const fu = byCat('followup');
  if (fu.length) L.push('**研究者记录的追问（人工笔记）**', '', ...fu.map(noteLine), '');
  if (j.suggestedFollowups.length) {
    L.push('**AI 建议**', '');
    for (const f of j.suggestedFollowups) L.push(`- ${f.text}${cite(j, f.sources)}`);
    L.push('');
  } else if (!fu.length) L.push('（暂无）', '');

  L.push('## 十、后续行动事项', '');
  const todo = byCat('todo');
  if (todo.length) L.push('**研究者记录的待办（人工笔记）**', '', ...todo.map(noteLine), '');
  if (j.actionItems.length) {
    L.push('**AI 建议的行动项**', '');
    for (const a of j.actionItems) L.push(`- ${a.text}${cite(j, a.sources)}`);
    L.push('');
  } else if (!todo.length) L.push('（暂无）', '');

  const general = byCat('general');
  if (general.length) L.push('## 附：其他笔记（人工）', '', ...general.map(noteLine), '');

  void noteCategoryLabel;
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
