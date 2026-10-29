import { effectiveText, fmtClock } from '../lib/format';
import { noteCategoryLabel } from './englishNotes';
import type { Interview, Notebook } from './model';
export function exportText(i: Interview, markdown = false) {
  const h = (s: string) => (markdown ? '## ' + s : s);
  return (
    [
      markdown ? '# ' + (i.title || 'Untitled interview') : i.title || 'Untitled interview',
      i.synthetic
        ? 'DEMO / synthetic — Fictional content; no real speech recognition or AI.'
        : 'Local research record — Review manually; ASR and manual segments are distinguished.',
      `Participant: ${i.participant}`,
      h('Transcript and edits'),
      ...i.segments.map(
        (s) =>
          `${markdown ? `<a id="seg-${s.seq}"></a>\n` : ''}[${fmtClock(s.startMs)}] ${s.speakerLabel || 'Unlabeled'} (${s.source})${s.isImportant ? ' ★' : ''}：${effectiveText(s)}${s.editedText !== null ? `\nOriginal text: ${s.originalText}` : ''}`,
      ),
      i.manualDraft ? `Unfinished manual transcript draft: ${i.manualDraft}` : '',
      h('Researcher notes'),
      ...i.notes.map(
        (n) =>
          `${markdown ? `<a id="note-${n.id}"></a>\n` : ''}[${fmtClock(n.timestampMs ?? 0)}] ${noteCategoryLabel(n.category)}${n.isImportant ? ' ★' : ''}：${n.content}`,
      ),
      i.draftNote ? `Unfinished note draft: ${i.draftNote}` : '',
      markdown ? h('Manually marked evidence index') : '',
      markdown
        ? i.segments
            .filter((s) => s.isImportant)
            .map((s) => `- [${fmtClock(s.startMs)}](#seg-${s.seq})`)
            .join('\n')
        : '',
      h('Researcher review notes'),
      i.reviewText,
      h('Reference material (not participant speech)'),
      i.reference,
      ...(i.referenceFiles ?? []).map(f => `[${f.name}] (background reference, not interview speech)\n${f.text}`),
      i.interruption ? `Interruption and gaps: ${i.interruption}` : '',
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}
export async function downloadBlob(blob: Blob, name: string): Promise<void> {
  if (window.meetfolioDesktop?.saveExport) {
    const saved = await window.meetfolioDesktop.saveExport(name, new Uint8Array(await blob.arrayBuffer()));
    if (!saved) throw new Error('Export cancelled; interview unchanged.');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportInterview(
  i: Interview,
  format: 'txt' | 'md' | 'docx',
) {
  const text = exportText(i, format === 'md');
  let blob: Blob;
  if (format === 'docx') {
    const { Document, Packer, Paragraph, TextRun } = await import('docx');
    blob = await Packer.toBlob(
      new Document({
        sections: [
          {
            children: exportText(i)
              .split('\n')
              .map(
                (t) =>
                  new Paragraph({
                    children: [
                      new TextRun({ text: t, font: 'Microsoft YaHei' }),
                    ],
                  }),
              ),
          },
        ],
      }),
    );
  } else
    blob = new Blob([text], {
      type:
        format === 'md'
          ? 'text/markdown;charset=utf-8'
          : 'text/plain;charset=utf-8',
    });
  await downloadBlob(
    blob,
    `Meetfolio-${i.synthetic ? 'DEMO-' : ''}${i.id}.${format}`,
  );
}
export async function backup(book: Notebook) {
  await downloadBlob(
    new Blob([JSON.stringify(book, null, 2)], { type: 'application/json' }),
    'Meetfolio-local-backup.json',
  );
}
