import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { Block, ExportDoc, Run } from './model.js';

const runsText = (rs: Run[]) => rs.map((r) => r.text).join('');
const mdRuns = (rs: Run[]) => rs.map((r) => (r.bold ? `**${r.text}**` : r.italics ? `_${r.text}_` : r.text)).join('');

export function renderMarkdown(doc: ExportDoc): string {
  const L: string[] = [];
  for (const b of doc.blocks) {
    switch (b.t) {
      case 'title':
        L.push(`# ${b.text}`, '');
        break;
      case 'h2':
        L.push('', `## ${b.text}`, '');
        break;
      case 'h3':
        L.push(`### ${b.text}`, '');
        break;
      case 'p':
        L.push(mdRuns(b.runs), '');
        break;
      case 'bullet':
        L.push(`- ${mdRuns(b.runs)}`);
        break;
      case 'quote':
        L.push(`> ${mdRuns(b.runs)}`, '');
        break;
      case 'note':
        L.push(`- ${b.time ? `**[${b.time}]** ` : ''}*${b.category}*${b.important ? ' ★' : ''}：${b.text.replace(/\n+/g, '\n  ')}`);
        break;
      case 'transcript':
        L.push(`**[${b.time}]**${b.speaker ? ` ${b.speaker}：` : ' '}${b.text}${b.important ? ' ★' : ''}${b.edited ? ' _（已修订）_' : ''}`, '');
        break;
      case 'gap':
        L.push(`> ⚠ ${b.text}`, '');
        break;
    }
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function renderText(doc: ExportDoc): string {
  const L: string[] = [];
  for (const b of doc.blocks) {
    switch (b.t) {
      case 'title':
        L.push(b.text, '='.repeat(Math.min(40, [...b.text].length * 2)), '');
        break;
      case 'h2':
        L.push('', `【${b.text}】`, '');
        break;
      case 'h3':
        L.push(`■ ${b.text}`);
        break;
      case 'p':
        L.push(runsText(b.runs));
        break;
      case 'bullet':
        L.push(`  · ${runsText(b.runs)}`);
        break;
      case 'quote':
        L.push(`  “${runsText(b.runs).replace(/^“|”$/g, '')}”`);
        break;
      case 'note':
        L.push(`  · ${b.time ? `[${b.time}] ` : ''}(${b.category})${b.important ? ' ★' : ''} ${b.text}`);
        break;
      case 'transcript':
        L.push(`[${b.time}]${b.speaker ? ` ${b.speaker}：` : ' '}${b.text}${b.important ? ' ★' : ''}${b.edited ? '（已修订）' : ''}`, '');
        break;
      case 'gap':
        L.push(`  !! ${b.text}`, '');
        break;
    }
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const FONT = { ascii: 'Calibri', eastAsia: 'Microsoft YaHei', hAnsi: 'Calibri' };

const tr = (r: Run, extra: { italics?: boolean } = {}) => new TextRun({ text: r.text, bold: r.bold, italics: extra.italics ?? r.italics, font: FONT });

function docxBlock(b: Block): Paragraph[] {
  switch (b.t) {
    case 'title':
      return [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: b.text, font: FONT, bold: true })], spacing: { after: 240 } })];
    case 'h2':
      return [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: b.text, font: FONT, bold: true })], spacing: { before: 360, after: 160 } })];
    case 'h3':
      return [new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: b.text, font: FONT, bold: true })], spacing: { before: 200, after: 100 } })];
    case 'p':
      return [new Paragraph({ children: b.runs.map((r) => tr(r)), spacing: { after: 100, line: 340 } })];
    case 'bullet':
      return [new Paragraph({ bullet: { level: 0 }, children: b.runs.map((r) => tr(r)), spacing: { after: 60, line: 340 } })];
    case 'quote':
      return [new Paragraph({ children: b.runs.map((r) => tr(r, { italics: true })), indent: { left: 360 }, border: { left: { style: 'single' as never, size: 12, color: '9DB5A8', space: 8 } }, spacing: { after: 100, line: 340 } })];
    case 'note':
      return [
        new Paragraph({
          bullet: { level: 0 },
          children: [
            ...(b.time ? [new TextRun({ text: `[${b.time}] `, bold: true, font: FONT })] : []),
            new TextRun({ text: `${b.category}${b.important ? ' ★' : ''}：`, italics: true, font: FONT }),
            new TextRun({ text: b.text, font: FONT }),
          ],
          spacing: { after: 60, line: 340 },
        }),
      ];
    case 'transcript':
      return [
        new Paragraph({
          children: [
            new TextRun({ text: `[${b.time}] `, bold: true, font: FONT, color: '355F52' }),
            ...(b.speaker ? [new TextRun({ text: `${b.speaker}：`, bold: true, font: FONT })] : []),
            new TextRun({ text: b.text, font: FONT }),
            ...(b.important ? [new TextRun({ text: ' ★', font: FONT, color: 'B7791F' })] : []),
            ...(b.edited ? [new TextRun({ text: '（已修订）', italics: true, font: FONT, color: '79857E' })] : []),
          ],
          spacing: { after: 100, line: 340 },
        }),
      ];
    case 'gap':
      return [new Paragraph({ children: [new TextRun({ text: `⚠ ${b.text}`, italics: true, font: FONT, color: 'B7791F' })], spacing: { after: 100 }, alignment: AlignmentType.LEFT })];
  }
}

export async function renderDocx(doc: ExportDoc): Promise<Buffer> {
  const d = new Document({
    creator: 'Meetfolio',
    title: doc.title,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ children: doc.blocks.flatMap(docxBlock) }],
  });
  return Packer.toBuffer(d);
}
