import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { detectKind, extractText, MIME } from '../docs/extract.js';
import { docKey } from '../docs/files.js';
import { interviewQuestions, manualNotes, meetings, NOTE_CATEGORIES, referenceDocuments, transcriptSegments } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { AppContext } from '../lib/context.js';
import { parseGuide } from '../lib/guide.js';
import { getOwnedMeeting, isUuid } from '../lib/owned.js';
import { serializeDoc, serializeNote, serializeQuestion, serializeSegment } from './meetings.js';

const MAX_TEXT_CHARS = 1_000_000;

const noteBody = z.object({
  category: z.enum(NOTE_CATEGORIES).default('general'),
  content: z.string().max(20_000),
  isImportant: z.boolean().default(false),
  timestampMs: z.number().int().min(0).nullable().optional(),
});

const questionBody = z.object({
  text: z.string().trim().min(1).max(1000),
  done: z.boolean().default(false),
  isFollowup: z.boolean().default(false),
  position: z.number().int().min(0).optional(),
});

const segmentPatch = z.object({
  editedText: z.string().max(5000).nullable().optional(),
  speakerLabel: z.string().trim().max(40).nullable().optional(),
  isImportant: z.boolean().optional(),
});

export async function contentRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  // --- Notes (idempotent upserts keyed by a client-generated id → safe autosave) -------------
  app.put<{ Params: { id: string; noteId: string } }>('/api/meetings/:id/notes/:noteId', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    if (!isUuid(req.params.noteId)) throw badRequest('笔记编号无效');
    const b = noteBody.safeParse(req.body);
    if (!b.success) throw badRequest('笔记内容无效');
    const now = new Date();
    const [row] = await db
      .insert(manualNotes)
      .values({ id: req.params.noteId, meetingId: m.id, ...b.data, timestampMs: b.data.timestampMs ?? null })
      .onConflictDoUpdate({
        target: manualNotes.id,
        set: {
          category: b.data.category,
          content: b.data.content,
          isImportant: b.data.isImportant,
          // Preserve the original timestamp unless the client explicitly sent one.
          ...(b.data.timestampMs !== undefined ? { timestampMs: b.data.timestampMs } : {}),
          updatedAt: now,
        },
        // Never let a client take over a note id that belongs to another meeting.
        setWhere: eq(manualNotes.meetingId, m.id),
      })
      .returning();
    if (!row) throw notFound('笔记不存在');
    await db.update(meetings).set({ updatedAt: now }).where(eq(meetings.id, m.id));
    return { note: serializeNote(row) };
  });

  app.delete<{ Params: { id: string; noteId: string } }>('/api/meetings/:id/notes/:noteId', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    if (!isUuid(req.params.noteId)) throw notFound('笔记不存在');
    await db.delete(manualNotes).where(and(eq(manualNotes.id, req.params.noteId), eq(manualNotes.meetingId, m.id)));
    return { ok: true };
  });

  // --- Interview guide ----------------------------------------------------------------------
  app.put<{ Params: { id: string; qid: string } }>('/api/meetings/:id/questions/:qid', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    if (!isUuid(req.params.qid)) throw badRequest('问题编号无效');
    const b = questionBody.safeParse(req.body);
    if (!b.success) throw badRequest('请输入问题内容');
    let position = b.data.position;
    if (position === undefined) {
      const [r] = await db
        .select({ max: sql<number>`coalesce(max(${interviewQuestions.position}), -1)` })
        .from(interviewQuestions)
        .where(eq(interviewQuestions.meetingId, m.id));
      position = (r?.max ?? -1) + 1;
    }
    const now = new Date();
    const [row] = await db
      .insert(interviewQuestions)
      .values({ id: req.params.qid, meetingId: m.id, text: b.data.text, done: b.data.done, isFollowup: b.data.isFollowup, position, doneAt: b.data.done ? now : null })
      .onConflictDoUpdate({
        target: interviewQuestions.id,
        set: { text: b.data.text, done: b.data.done, doneAt: b.data.done ? now : null, updatedAt: now },
        setWhere: eq(interviewQuestions.meetingId, m.id),
      })
      .returning();
    if (!row) throw notFound('问题不存在');
    return { question: serializeQuestion(row) };
  });

  app.delete<{ Params: { id: string; qid: string } }>('/api/meetings/:id/questions/:qid', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    if (!isUuid(req.params.qid)) throw notFound('问题不存在');
    await db.delete(interviewQuestions).where(and(eq(interviewQuestions.id, req.params.qid), eq(interviewQuestions.meetingId, m.id)));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/meetings/:id/guide/import', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const b = z.object({ text: z.string().min(1).max(50_000), replace: z.boolean().default(false) }).safeParse(req.body);
    if (!b.success) throw badRequest('请粘贴访谈提纲内容');
    const parsed = parseGuide(b.data.text);
    if (!parsed.questions.length && !parsed.topic) throw badRequest('没有识别到问题，请每行写一个问题');
    const questions = await db.transaction(async (tx) => {
      if (b.data.replace) await tx.delete(interviewQuestions).where(and(eq(interviewQuestions.meetingId, m.id), eq(interviewQuestions.isFollowup, false)));
      const [r] = await tx
        .select({ max: sql<number>`coalesce(max(${interviewQuestions.position}), -1)` })
        .from(interviewQuestions)
        .where(eq(interviewQuestions.meetingId, m.id));
      const start = (r?.max ?? -1) + 1;
      if (parsed.questions.length) {
        await tx.insert(interviewQuestions).values(parsed.questions.map((text, i) => ({ id: randomUUID(), meetingId: m.id, text: text.slice(0, 1000), position: start + i })));
      }
      if (parsed.topic) await tx.update(meetings).set({ guideTopic: parsed.topic, updatedAt: new Date() }).where(eq(meetings.id, m.id));
      return tx.select().from(interviewQuestions).where(eq(interviewQuestions.meetingId, m.id)).orderBy(asc(interviewQuestions.position));
    });
    return { questions: questions.map(serializeQuestion), topic: parsed.topic };
  });

  // --- Reference documents --------------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/api/meetings/:id/documents', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const file = await req.file();
    if (!file) throw badRequest('请选择要上传的文件');
    const maxBytes = ctx.config.MAX_UPLOAD_MB * 1024 * 1024;
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      throw badRequest(`文件过大，请上传不超过 ${ctx.config.MAX_UPLOAD_MB} MB 的文件`, 'file_too_large');
    }
    if (file.file.truncated || buf.length > maxBytes) throw badRequest(`文件过大，请上传不超过 ${ctx.config.MAX_UPLOAD_MB} MB 的文件`, 'file_too_large');
    if (!buf.length) throw badRequest('文件是空的');
    // Browsers send multipart filenames as latin1-decoded UTF-8 in some cases; keep display name sane.
    const filename = path.basename(file.filename || 'document').slice(0, 200);
    const kind = detectKind(filename, buf);
    if (!kind) throw badRequest('仅支持 PDF、DOCX、TXT、Markdown 文件', 'unsupported_file');
    let text = '';
    let status: 'ok' | 'empty' | 'failed' | 'truncated' = 'ok';
    try {
      text = await extractText(kind, buf);
      if (!text) status = 'empty';
      else if (text.length > MAX_TEXT_CHARS) {
        text = text.slice(0, MAX_TEXT_CHARS);
        status = 'truncated';
      }
    } catch (err) {
      ctx.logger.warn({ meetingId: m.id, kind, err: (err as Error).message }, 'document text extraction failed');
      status = 'failed';
    }
    const id = randomUUID();
    const key = docKey(m.userId, m.id, id, path.extname(filename).toLowerCase());
    await ctx.storage.put(key, buf, MIME[kind]);
    const [row] = await db
      .insert(referenceDocuments)
      .values({
        id,
        meetingId: m.id,
        kind: 'upload',
        title: filename.replace(/\.[^.]+$/, ''),
        filename,
        mimeType: MIME[kind],
        sizeBytes: buf.length,
        storageKey: key,
        extractedText: text,
        extractionStatus: status,
      })
      .returning();
    return { document: serializeDoc(row!) };
  });

  app.post<{ Params: { id: string } }>('/api/meetings/:id/documents/paste', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const b = z.object({ title: z.string().trim().min(1).max(200), text: z.string().min(1).max(MAX_TEXT_CHARS) }).safeParse(req.body);
    if (!b.success) throw badRequest('请输入标题和内容');
    const [row] = await db
      .insert(referenceDocuments)
      .values({ meetingId: m.id, kind: 'pasted', title: b.data.title, extractedText: b.data.text, sizeBytes: Buffer.byteLength(b.data.text) })
      .returning();
    return { document: serializeDoc(row!), text: row!.extractedText };
  });

  const loadDoc = async (meetingId: string, docId: string) => {
    if (!isUuid(docId)) throw notFound('资料不存在');
    const [d] = await db.select().from(referenceDocuments).where(and(eq(referenceDocuments.id, docId), eq(referenceDocuments.meetingId, meetingId))).limit(1);
    if (!d) throw notFound('资料不存在');
    return d;
  };

  app.get<{ Params: { id: string; docId: string } }>('/api/meetings/:id/documents/:docId', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const d = await loadDoc(m.id, req.params.docId);
    return { document: serializeDoc(d), text: d.extractedText };
  });

  app.patch<{ Params: { id: string; docId: string } }>('/api/meetings/:id/documents/:docId', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const d = await loadDoc(m.id, req.params.docId);
    const b = z.object({ title: z.string().trim().min(1).max(200).optional(), text: z.string().max(MAX_TEXT_CHARS).optional() }).safeParse(req.body);
    if (!b.success) throw badRequest('内容无效');
    if (b.data.text !== undefined && d.kind !== 'pasted') throw badRequest('上传文件的提取文本不可修改', 'immutable');
    const [row] = await db
      .update(referenceDocuments)
      .set({ ...(b.data.title ? { title: b.data.title } : {}), ...(b.data.text !== undefined ? { extractedText: b.data.text, sizeBytes: Buffer.byteLength(b.data.text) } : {}), updatedAt: new Date() })
      .where(eq(referenceDocuments.id, d.id))
      .returning();
    return { document: serializeDoc(row!) };
  });

  app.delete<{ Params: { id: string; docId: string } }>('/api/meetings/:id/documents/:docId', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const d = await loadDoc(m.id, req.params.docId);
    await db.delete(referenceDocuments).where(eq(referenceDocuments.id, d.id));
    if (d.storageKey) await ctx.storage.delete(d.storageKey).catch(() => {});
    return { ok: true };
  });

  app.get<{ Params: { id: string; docId: string } }>('/api/meetings/:id/documents/:docId/file', async (req, reply) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const d = await loadDoc(m.id, req.params.docId);
    if (!d.storageKey) throw notFound('该资料没有原始文件');
    const data = await ctx.storage.get(d.storageKey);
    reply
      .header('Content-Type', d.mimeType ?? 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.filename ?? 'document')}`)
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(data);
  });

  // --- Transcript segment corrections -----------------------------------------------------------
  app.patch<{ Params: { id: string; sid: string } }>('/api/meetings/:id/segments/:sid', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    if (!isUuid(req.params.sid)) throw notFound('转录片段不存在');
    const b = segmentPatch.safeParse(req.body);
    if (!b.success) throw badRequest('内容无效');
    const [seg] = await db.select().from(transcriptSegments).where(and(eq(transcriptSegments.id, req.params.sid), eq(transcriptSegments.meetingId, m.id))).limit(1);
    if (!seg) throw notFound('转录片段不存在');
    const set: Partial<typeof transcriptSegments.$inferInsert> = { updatedAt: new Date() };
    if (b.data.editedText !== undefined) {
      // Original ASR text is never touched; clearing the edit (or typing the original back) reverts.
      const next = b.data.editedText;
      set.editedText = next === null || next === seg.originalText ? null : next;
      set.editedAt = set.editedText === null ? null : new Date();
    }
    if (b.data.speakerLabel !== undefined) set.speakerLabel = b.data.speakerLabel || null;
    if (b.data.isImportant !== undefined) set.isImportant = b.data.isImportant;
    const [row] = await db.update(transcriptSegments).set(set).where(eq(transcriptSegments.id, seg.id)).returning();
    return { segment: serializeSegment(row!) };
  });

  /** Manually typed passage, e.g. to fill a gap that could not be recovered. */
  app.post<{ Params: { id: string } }>('/api/meetings/:id/segments', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const b = z
      .object({ startMs: z.number().int().min(0), text: z.string().trim().min(1).max(5000), speakerLabel: z.string().trim().max(40).optional() })
      .safeParse(req.body);
    if (!b.success) throw badRequest('内容无效');
    const row = await db.transaction(async (tx) => {
      const [mm] = await tx.update(meetings).set({ nextSeq: sql`${meetings.nextSeq} + 1` }).where(eq(meetings.id, m.id)).returning({ seq: meetings.nextSeq });
      const seq = mm!.seq - 1;
      const [s] = await tx
        .insert(transcriptSegments)
        .values({
          meetingId: m.id,
          seq,
          dedupeKey: `manual:${randomUUID()}`,
          startMs: b.data.startMs,
          endMs: b.data.startMs,
          originalText: b.data.text,
          speakerLabel: b.data.speakerLabel ?? null,
          source: 'manual',
        })
        .returning();
      return s!;
    });
    return { segment: serializeSegment(row) };
  });

  app.delete<{ Params: { id: string; sid: string } }>('/api/meetings/:id/segments/:sid', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    if (!isUuid(req.params.sid)) throw notFound('转录片段不存在');
    // Only manually typed passages may be removed; recognised text is evidence and stays.
    const res = await db
      .delete(transcriptSegments)
      .where(and(eq(transcriptSegments.id, req.params.sid), eq(transcriptSegments.meetingId, m.id), eq(transcriptSegments.source, 'manual')))
      .returning({ id: transcriptSegments.id });
    if (!res.length) throw badRequest('只能删除手动添加的段落', 'not_deletable');
    return { ok: true };
  });
}
