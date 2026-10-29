import type { ReactNode } from 'react';

/** Wraps case-insensitive occurrences of `term` in <mark>. */
export function highlight(text: string, term: string, activeIndex = -1, counter?: { n: number }): ReactNode {
  if (!term) return text;
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  for (;;) {
    const j = lower.indexOf(t, i);
    if (j < 0) break;
    if (j > i) out.push(text.slice(i, j));
    const idx = counter ? counter.n++ : -1;
    out.push(
      <mark key={j} data-match={idx} className={`rounded px-0.5 ${idx === activeIndex ? 'bg-primary text-white' : 'bg-warn-soft text-ink'}`}>
        {text.slice(j, j + t.length)}
      </mark>,
    );
    i = j + t.length;
  }
  if (!out.length) return text;
  if (i < text.length) out.push(text.slice(i));
  return out;
}

export function countMatches(text: string, term: string) {
  if (!term) return 0;
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  let n = 0;
  for (let i = lower.indexOf(t); i >= 0; i = lower.indexOf(t, i + t.length)) n++;
  return n;
}
