import path from 'node:path';

export type DocKind = 'pdf' | 'docx' | 'txt' | 'md';

const EXT: Record<string, DocKind> = { '.pdf': 'pdf', '.docx': 'docx', '.txt': 'txt', '.md': 'md', '.markdown': 'md' };

export function detectKind(filename: string, buf: Buffer): DocKind | null {
  const kind = EXT[path.extname(filename).toLowerCase()];
  if (!kind) return null;
  // Validate magic bytes rather than trusting the extension / client-supplied MIME.
  if (kind === 'pdf') return buf.subarray(0, 5).toString('latin1') === '%PDF-' ? kind : null;
  if (kind === 'docx') return buf[0] === 0x50 && buf[1] === 0x4b ? kind : null; // zip container
  if (buf.includes(0)) return null; // binary data masquerading as text
  return kind;
}

export const MIME: Record<DocKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};

function decodeText(buf: Buffer): string {
  // UTF-8 (with/without BOM) first; fall back to GB18030, which common Chinese .txt files use.
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  try {
    return new TextDecoder('gb18030').decode(buf);
  } catch {
    return utf8;
  }
}

export function normalizeText(s: string) {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u0000/g, '')
    .trim();
}

export async function extractText(kind: DocKind, buf: Buffer): Promise<string> {
  switch (kind) {
    case 'txt':
    case 'md':
      return normalizeText(decodeText(buf));
    case 'docx': {
      const mammoth = (await import('mammoth')).default;
      const res = await mammoth.extractRawText({ buffer: buf });
      return normalizeText(res.value);
    }
    case 'pdf': {
      const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
      // Copy into an exact ArrayBuffer: pdf.js takes ownership of (and may detach) the memory it is given.
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await pdfText(pdf, { mergePages: true });
      return normalizeText(Array.isArray(text) ? text.join('\n') : text);
    }
  }
}
