import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildExportDoc, type ExportPart } from '../export/model.js';
import { renderDocx, renderMarkdown, renderText } from '../export/render.js';
import { badRequest } from '../lib/errors.js';
import type { AppContext } from '../lib/context.js';
import { getOwnedMeeting } from '../lib/owned.js';

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
} as const;

export async function exportRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Params: { id: string }; Querystring: { format?: string; parts?: string } }>('/api/meetings/:id/export', async (req, reply) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const q = z
      .object({
        format: z.enum(['docx', 'md', 'txt']),
        parts: z.string().optional(),
      })
      .safeParse(req.query);
    if (!q.success) throw badRequest('不支持的导出格式');
    const allowed: ExportPart[] = ['transcript', 'notes', 'summary'];
    const parts = (q.data.parts ? q.data.parts.split(',') : allowed).filter((p): p is ExportPart => (allowed as string[]).includes(p));
    if (!parts.length) throw badRequest('请选择要导出的内容');
    const doc = await buildExportDoc(ctx, m.id, parts);
    const body = q.data.format === 'docx' ? await renderDocx(doc) : q.data.format === 'md' ? renderMarkdown(doc) : renderText(doc);
    reply
      .header('Content-Type', MIME[q.data.format])
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.filenameBase)}.${q.data.format}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store');
    return reply.send(body);
  });
}
