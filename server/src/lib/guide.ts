/**
 * Parses a pasted interview guide into a topic line and a list of questions.
 *
 * Understands the usual Chinese/Western list markers: "问题一：", "问题 1.", "1.", "1、", "（1）", "Q1:", "- ", "• ".
 * A line starting with "研究主题" / "主题" / "Topic" becomes the topic. Lines that do not start with a marker are
 * treated as continuation of the previous question if one exists, otherwise as an individual question.
 */
export function parseGuide(text: string): { topic: string | null; questions: string[] } {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim());
  let topic: string | null = null;
  const questions: string[] = [];
  const marker = /^(?:问题\s*[一二三四五六七八九十百\d]+\s*[：:.、）)]?|[（(]?\s*\d+\s*[)）.、:：]|[Qq]\s*\d+\s*[.:：、)]?|[-*•·]\s+)\s*/;
  const topicRe = /^(?:研究主题|访谈主题|主题|topic)\s*[：:]\s*(.+)$/i;
  for (const line of lines) {
    if (!line) continue;
    const t = topicRe.exec(line);
    if (t) {
      topic = t[1]!.trim();
      continue;
    }
    const m = marker.exec(line);
    if (m) {
      const rest = line.slice(m[0].length).trim();
      if (rest) questions.push(rest);
    } else if (questions.length && /^[\s　]/.test(lines[lines.indexOf(line)] ?? '')) {
      questions[questions.length - 1] += ' ' + line;
    } else {
      questions.push(line);
    }
  }
  return { topic, questions };
}
