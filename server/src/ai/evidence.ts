import { fmtMs } from '../lib/time.js';
import type { RefInfo, SummaryInput } from './types.js';

export const effectiveText = (s: { editedText: string | null; originalText: string }) => s.editedText ?? s.originalText;

const NOTE_LABEL: Record<string, string> = {
  quote: '受访者原话(研究者记录)',
  observation: '研究者观察',
  finding: '重要发现',
  followup: '追问问题',
  todo: '待办事项',
  general: '普通笔记',
};
export const noteCategoryLabel = (c: string) => NOTE_LABEL[c] ?? c;

export interface Evidence {
  refs: Record<string, RefInfo>;
  /** One entry per transcript segment, already formatted for prompts. */
  transcriptLines: Array<{ ref: string; line: string }>;
  noteBlock: string;
  docBlock: string;
  guideBlock: string;
  metaBlock: string;
  truncatedDocs: Array<{ title: string; includedChars: number; totalChars: number }>;
  docsIncluded: number;
}

const DOC_TOTAL_BUDGET = 30_000;
const DOC_MIN_PER_DOC = 2_000;

export function buildEvidence(input: SummaryInput): Evidence {
  const refs: Record<string, RefInfo> = {};
  const segs = [...input.segments].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);

  const transcriptLines = segs.map((s) => {
    const ref = `T${s.seq}`;
    refs[ref] = { kind: 'segment', id: s.id, seq: s.seq, startMs: s.startMs };
    const who = s.speakerLabel?.trim() || '未标注';
    const star = s.isImportant ? '★' : '';
    return { ref, line: `[${ref} ${fmtMs(s.startMs)} 发言者:${who}${star}] ${effectiveText(s).replace(/\s+/g, ' ')}` };
  });

  const notes = [...input.notes].filter((n) => n.content.trim()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const noteLines = notes.map((n, i) => {
    const ref = `N${i + 1}`;
    refs[ref] = { kind: 'note', id: n.id, startMs: n.timestampMs ?? undefined };
    const t = n.timestampMs !== null ? ` ${fmtMs(n.timestampMs)}` : '';
    return `[${ref}${t} ${noteCategoryLabel(n.category)}${n.isImportant ? '★' : ''}] ${n.content.trim().replace(/\n+/g, ' / ')}`;
  });

  // Reference documents: split a fixed budget across documents, and report any truncation explicitly.
  const docs = input.docs.filter((d) => d.extractedText.trim());
  const totalChars = docs.reduce((n, d) => n + d.extractedText.length, 0);
  const truncatedDocs: Evidence['truncatedDocs'] = [];
  const docParts: string[] = [];
  docs.forEach((d, i) => {
    const ref = `D${i + 1}`;
    refs[ref] = { kind: 'doc', id: d.id, title: d.title };
    const share = totalChars <= DOC_TOTAL_BUDGET ? d.extractedText.length : Math.max(DOC_MIN_PER_DOC, Math.floor((d.extractedText.length / totalChars) * DOC_TOTAL_BUDGET));
    const text = d.extractedText.slice(0, share);
    const cut = text.length < d.extractedText.length;
    if (cut) truncatedDocs.push({ title: d.title, includedChars: text.length, totalChars: d.extractedText.length });
    docParts.push(`<doc id="${ref}" title="${d.title.replace(/"/g, "'")}"${cut ? ` truncated="仅包含前${text.length}字，共${d.extractedText.length}字"` : ''}>\n${text}\n</doc>`);
  });

  const m = input.meeting;
  const people = input.participants.map((p) => `${p.name}${p.role === 'interviewer' ? '(访谈员)' : p.role === 'interviewee' ? '(受访者)' : ''}`).join('、');
  const metaBlock = [
    `标题：${m.title}`,
    `日期：${m.meetingDate.toISOString().slice(0, 10)}`,
    `类型：${m.type}`,
    m.location && `地点：${m.location}`,
    m.organizer && `组织者：${m.organizer}`,
    people && `参与者（元数据，不代表发言）：${people}`,
    m.researchContext.trim() && `研究背景（研究者填写，非会议发言）：${m.researchContext.trim()}`,
  ]
    .filter(Boolean)
    .join('\n');

  const guideBlock = input.questions.length
    ? [m.guideTopic && `研究主题：${m.guideTopic}`, ...input.questions.map((q, i) => `${i + 1}. ${q.text}${q.done ? '（已问）' : '（未标记已问）'}${q.isFollowup ? '[现场追加]' : ''}`)].filter(Boolean).join('\n')
    : m.guideTopic
      ? `研究主题：${m.guideTopic}`
      : '';

  return { refs, transcriptLines, noteBlock: noteLines.join('\n'), docBlock: docParts.join('\n'), guideBlock, metaBlock, truncatedDocs, docsIncluded: docs.length };
}

/** Normalises text for quote matching: strips whitespace and punctuation, lowercases. */
export function normForMatch(s: string) {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}
