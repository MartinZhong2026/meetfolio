import { asc, desc, eq } from 'drizzle-orm';
import { noteCategoryLabel } from '../ai/evidence.js';
import { meetingTypeLabel } from '../ai/render.js';
import { manualNotes, meetingParticipants, meetings, meetingSummaries, transcriptGaps, transcriptSegments } from '../db/schema.js';
import type { AppContext } from '../lib/context.js';
import { fmtDateZh, fmtDuration, fmtMs } from '../lib/time.js';

export interface Run {
  text: string;
  bold?: boolean;
  italics?: boolean;
}
export type Block =
  | { t: 'title'; text: string }
  | { t: 'h2' | 'h3'; text: string }
  | { t: 'p'; runs: Run[] }
  | { t: 'bullet'; runs: Run[] }
  | { t: 'quote'; runs: Run[] }
  | { t: 'transcript'; time: string; speaker: string; text: string; important: boolean; edited: boolean }
  | { t: 'note'; time: string | null; category: string; text: string; important: boolean }
  | { t: 'gap'; text: string };

export interface ExportDoc {
  title: string;
  filenameBase: string;
  blocks: Block[];
}

export type ExportPart = 'transcript' | 'notes' | 'summary';

const stripLinks = (s: string) => s.replace(/\[([^\]]+)\]\(#[^)]*\)/g, '[$1]');

export function inlineRuns(line: string): Run[] {
  const runs: Run[] = [];
  const re = /\*\*([^*]+)\*\*|_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const s = stripLinks(line);
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true });
    else runs.push({ text: m[2]!, italics: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs.length ? runs : [{ text: '' }];
}

/** Converts the (restricted) Markdown produced by the summary renderer into export blocks. */
export function markdownToBlocks(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (line.startsWith('# ')) continue; // the document title is emitted separately
    if (line.startsWith('### ')) out.push({ t: 'h3', text: line.slice(4) });
    else if (line.startsWith('## ')) out.push({ t: 'h2', text: line.slice(3) });
    else if (/^\s*[-*] /.test(line)) out.push({ t: 'bullet', runs: inlineRuns(line.replace(/^\s*[-*] /, '')) });
    else if (line.startsWith('> ')) out.push({ t: 'quote', runs: inlineRuns(line.slice(2)) });
    else out.push({ t: 'p', runs: inlineRuns(line.trim()) });
  }
  return out;
}

export async function buildExportDoc(ctx: AppContext, meetingId: string, parts: ExportPart[]): Promise<ExportDoc> {
  const { db } = ctx;
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!m) throw new Error('meeting not found');
  const [participants, segments, notes, gaps, summaries] = await Promise.all([
    db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId)).orderBy(asc(meetingParticipants.position)),
    db.select().from(transcriptSegments).where(eq(transcriptSegments.meetingId, meetingId)).orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.seq)),
    db.select().from(manualNotes).where(eq(manualNotes.meetingId, meetingId)).orderBy(asc(manualNotes.createdAt)),
    db.select().from(transcriptGaps).where(eq(transcriptGaps.meetingId, meetingId)).orderBy(asc(transcriptGaps.startMs)),
    db.select().from(meetingSummaries).where(eq(meetingSummaries.meetingId, meetingId)).orderBy(desc(meetingSummaries.version)),
  ]);

  const blocks: Block[] = [{ t: 'title', text: m.title }];
  const meta: string[] = [`日期：${fmtDateZh(m.meetingDate)}`, `类型：${meetingTypeLabel(m.type)}`];
  const dur = Math.max(m.durationMs, m.recordedMs);
  if (dur) meta.push(`时长：${fmtDuration(dur)}`);
  if (m.location) meta.push(`地点：${m.location}`);
  if (m.organizer) meta.push(`组织者：${m.organizer}`);
  if (participants.length) meta.push(`参与者：${participants.map((p) => p.name + (p.role === 'interviewer' ? '（访谈员）' : p.role === 'interviewee' ? '（受访者）' : '')).join('、')}`);
  for (const line of meta) blocks.push({ t: 'p', runs: [{ text: line }] });
  if (m.researchContext.trim()) blocks.push({ t: 'p', runs: [{ text: '研究背景：', bold: true }, { text: m.researchContext.trim() }] });

  if (parts.includes('summary')) {
    const s = summaries.find((x) => x.status === 'ready');
    blocks.push({ t: 'h2', text: 'AI 纪要' });
    if (s) {
      blocks.push({ t: 'p', runs: [{ text: s.editedMd ? '（含研究者修订）' : '（AI 生成，未经修订）', italics: true }] });
      blocks.push(...markdownToBlocks(s.editedMd ?? s.generatedMd));
    } else blocks.push({ t: 'p', runs: [{ text: '尚未生成 AI 纪要。', italics: true }] });
  }

  if (parts.includes('notes')) {
    blocks.push({ t: 'h2', text: '人工笔记' });
    const ns = notes.filter((n) => n.content.trim());
    if (!ns.length) blocks.push({ t: 'p', runs: [{ text: '（无）', italics: true }] });
    for (const n of ns) blocks.push({ t: 'note', time: n.timestampMs !== null ? fmtMs(n.timestampMs) : null, category: noteCategoryLabel(n.category), text: n.content.trim(), important: n.isImportant });
  }

  if (parts.includes('transcript')) {
    blocks.push({ t: 'h2', text: '转录文本' });
    blocks.push({ t: 'p', runs: [{ text: '转录由语音识别自动生成，可能存在错误；标注“已修订”的段落经研究者更正，原始识别文本保存在系统中。', italics: true }] });
    type Item = { at: number; seq: number; block: Block };
    const items: Item[] = [
      ...segments.map((s) => ({
        at: s.startMs,
        seq: s.seq,
        block: { t: 'transcript', time: fmtMs(s.startMs), speaker: s.speakerLabel ?? '', text: s.editedText ?? s.originalText, important: s.isImportant, edited: s.editedText !== null } as Block,
      })),
      ...gaps
        .filter((g) => g.status !== 'recovered')
        .map((g) => ({
          at: g.startMs,
          seq: -1,
          block: {
            t: 'gap',
            text: `[${fmtMs(g.startMs)}${g.endMs !== null ? `–${fmtMs(g.endMs)}` : ''}] ${g.status === 'partial' ? '该时间段仅部分补录，部分内容缺失' : g.status === 'unrecoverable' ? '该时间段内容未能记录' : '该时间段转录缺失（尚未补录）'}`,
          } as Block,
        })),
    ].sort((a, b) => a.at - b.at || a.seq - b.seq);
    if (!items.length) blocks.push({ t: 'p', runs: [{ text: '（无转录内容）', italics: true }] });
    for (const i of items) blocks.push(i.block);
  }

  const safe = m.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'meeting';
  return { title: m.title, filenameBase: `${safe}_${m.meetingDate.toISOString().slice(0, 10)}`, blocks };
}
