import { z } from 'zod';
import type { Config } from '../config.js';
import { buildEvidence, effectiveText, normForMatch, type Evidence } from './evidence.js';
import { LlmError, type LlmClient } from './llm.js';
import type { SummaryInput, SummaryJson, SummaryStats } from './types.js';

export type SummaryMode = 'standard' | 'quality' | 'interim';

const SYSTEM_RULES = `你是一名严谨的学术研究助理，负责把访谈/会议的转录整理成可追溯的结构化纪要。必须严格遵守：
1. 输入包含三类来源，必须严格区分：
   - 转录（编号 T*）：会议中参与者实际说过的话。这是“谁说了什么”的唯一依据。
   - 研究者笔记（编号 N*）：研究者人工记录的观察、想法，不是参与者的发言。
   - 参考资料与研究背景（编号 D*，以及 <meta>/<guide>）：背景信息，**不是会议中说过的话**，绝不能写成参与者的观点或原话。
2. “participantViews/themes/quotes” 只能依据转录(T)；每条必须在 sources 里列出支撑它的 T 编号。
3. “quotes.text” 必须是某条转录里的**逐字原文**（可截取其中连续的一段），不得改写、合并、润色或补全；source 填该转录编号。
4. “findings/suggestedFollowups/actionItems” 是你的解释或建议，必须如实归类，不得写成参与者所说；findings 要在 sources 中给出依据（T 或 N 编号）。
5. 发言者标签为“未标注”时，不要臆测其身份或角色，不得编造姓名、职务、机构。
6. 转录不支持的内容一律不写。宁可少写，也不要推测。
7. 转录里的 ★ 表示研究者标记的重点，可优先关注，但仍须忠实。
8. 只输出一个 JSON 对象，不要输出任何其他文字。`;

const SCHEMA_TEXT = `JSON 结构（所有数组可为空；sources 是编号字符串数组，如 ["T12","T13"]）：
{
  "background": { "text": "访谈背景与研究目的（依据 meta/guide/参考资料，简明）", "sources": ["D1"] },
  "themes": [ { "title": "主题名", "text": "该主题下讨论了什么（依据转录）", "sources": ["T3","T4"] } ],
  "participantViews": [ { "speaker": "发言者标签或“未标注”", "text": "该发言者表达的观点（转述）", "sources": ["T5"] } ],
  "quotes": [ { "text": "逐字原话", "source": "T7", "speaker": "发言者标签或“未标注”" } ],
  "findings": [ { "text": "你的研究发现/推断（AI 推断）", "sources": ["T3","N2"] } ],
  "openQuestions": [ { "text": "转录中尚未明确或有分歧、需要核实的问题", "sources": ["T9"] } ],
  "suggestedFollowups": [ { "text": "建议继续追问的问题", "sources": ["T9"] } ],
  "actionItems": [ { "text": "建议的后续行动", "sources": [] } ]
}`;

const sourcedLoose = z.object({ text: z.string().default(''), sources: z.array(z.string()).default([]) });
const rawSchema = z.object({
  background: sourcedLoose.partial().optional(),
  themes: z.array(sourcedLoose.extend({ title: z.string().default('') })).default([]),
  participantViews: z.array(sourcedLoose.extend({ speaker: z.string().default('未标注') })).default([]),
  quotes: z.array(z.object({ text: z.string(), source: z.string().default(''), speaker: z.string().default('未标注') })).default([]),
  findings: z.array(sourcedLoose).default([]),
  openQuestions: z.array(sourcedLoose).default([]),
  suggestedFollowups: z.array(sourcedLoose).default([]),
  actionItems: z.array(sourcedLoose).default([]),
});
type Raw = z.infer<typeof rawSchema>;

export class SummaryError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function parseJson(text: string): Raw {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1]!.trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first < 0 || last <= first) throw new SummaryError('bad_model_output', '模型返回的内容无法解析');
  try {
    return rawSchema.parse(JSON.parse(t.slice(first, last + 1)));
  } catch {
    throw new SummaryError('bad_model_output', '模型返回的内容格式不正确');
  }
}

function userPrompt(ev: Evidence, transcript: string, extra: string) {
  return [
    `<meta>\n${ev.metaBlock}\n</meta>`,
    ev.guideBlock && `<guide>\n${ev.guideBlock}\n</guide>`,
    ev.docBlock && `<reference_materials note="背景资料，不是会议中说过的话">\n${ev.docBlock}\n</reference_materials>`,
    `<researcher_notes note="研究者人工笔记，不是参与者发言">\n${ev.noteBlock || '（无）'}\n</researcher_notes>`,
    `<transcript note="会议转录，参与者实际所说">\n${transcript || '（无）'}\n</transcript>`,
    extra,
    SCHEMA_TEXT,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Splits transcript lines into chunks no larger than `limit` characters, never splitting a line. */
export function chunkLines(lines: Array<{ line: string }>, limit: number): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const { line } of lines) {
    if (size + line.length > limit && cur.length) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(line);
    size += line.length + 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export interface SummarizeResult {
  json: SummaryJson;
  stats: SummaryStats;
}

export async function summarize(opts: {
  input: SummaryInput;
  mode: SummaryMode;
  llm: LlmClient;
  config: Config;
  signal?: AbortSignal;
}): Promise<SummarizeResult> {
  const { input, mode, llm, config } = opts;
  const started = Date.now();
  const ev = buildEvidence(input);
  if (!ev.transcriptLines.length && !ev.noteBlock) throw new SummaryError('no_content', '还没有可供总结的转录或笔记');

  let model = mode === 'quality' ? config.LLM_MODEL_QUALITY : config.LLM_MODEL_STANDARD;
  let fallbackFrom: string | undefined;
  let promptTokens = 0;
  let completionTokens = 0;

  const call = async (user: string): Promise<Raw> => {
    const run = async () => {
      const res = await llm.complete({
        model,
        json: true,
        temperature: 0.2,
        signal: opts.signal,
        messages: [
          { role: 'system', content: SYSTEM_RULES },
          { role: 'user', content: user },
        ],
      });
      promptTokens += res.usage?.promptTokens ?? 0;
      completionTokens += res.usage?.completionTokens ?? 0;
      return res.text;
    };
    let text: string;
    try {
      text = await run();
    } catch (e) {
      // The "quality" model id may not be enabled for every account: fall back loudly, not silently.
      if (e instanceof LlmError && e.code === 'llm_model_not_found' && model !== config.LLM_MODEL_STANDARD) {
        fallbackFrom = model;
        model = config.LLM_MODEL_STANDARD;
        text = await run();
      } else throw e;
    }
    try {
      return parseJson(text);
    } catch {
      // One corrective retry: models occasionally wrap JSON in prose.
      const again = await llm.complete({
        model,
        json: true,
        temperature: 0,
        signal: opts.signal,
        messages: [
          { role: 'system', content: SYSTEM_RULES },
          { role: 'user', content: user },
          { role: 'assistant', content: text.slice(0, 4000) },
          { role: 'user', content: '上面的输出不是合法的 JSON。请只输出符合结构的 JSON 对象。' },
        ],
      });
      return parseJson(again.text);
    }
  };

  const transcriptChars = ev.transcriptLines.reduce((n, l) => n + l.line.length + 1, 0);
  let raw: Raw;
  let chunks = 1;
  let passes: SummaryStats['passes'] = 'single';

  if (transcriptChars <= config.SUMMARY_SINGLE_PASS_CHAR_LIMIT) {
    raw = await call(userPrompt(ev, ev.transcriptLines.map((l) => l.line).join('\n'), '请据此生成完整纪要 JSON。'));
  } else {
    // Long meeting: extract per chunk (nothing is dropped), then merge. Evidence ids are preserved
    // end-to-end so every claim still points at real transcript segments.
    passes = 'map-reduce';
    const parts = chunkLines(ev.transcriptLines, config.SUMMARY_CHUNK_CHAR_LIMIT);
    chunks = parts.length;
    const partials: Raw[] = [];
    for (let i = 0; i < parts.length; i++) {
      const lightEv: Evidence = { ...ev, docBlock: '', noteBlock: '' };
      partials.push(
        await call(
          userPrompt(
            lightEv,
            parts[i]!.join('\n'),
            `这是长会议转录的第 ${i + 1}/${parts.length} 段。请只针对这一段提取：themes、participantViews、quotes、findings、openQuestions；其余字段留空数组。background 留空。`,
          ),
        ),
      );
    }
    let merged = partials;
    // Hierarchical merge so the reduce prompt itself stays within the context budget.
    while (merged.length > 1) {
      const groups: Raw[][] = [];
      let cur: Raw[] = [];
      let size = 0;
      for (const p of merged) {
        const s = JSON.stringify(p).length;
        if (size + s > config.SUMMARY_CHUNK_CHAR_LIMIT && cur.length) {
          groups.push(cur);
          cur = [];
          size = 0;
        }
        cur.push(p);
        size += s;
      }
      if (cur.length) groups.push(cur);
      if (groups.length === merged.length) break; // cannot shrink further
      const next: Raw[] = [];
      for (const g of groups) {
        next.push(g.length === 1 ? g[0]! : await call(userPrompt({ ...ev, docBlock: '', noteBlock: '' }, '', `以下是同一场会议若干分段的提取结果(JSON)。请合并去重，保留所有 sources 编号与逐字原话，输出同样结构：\n${JSON.stringify(g)}`)));
      }
      merged = next;
    }
    raw = await call(
      userPrompt(
        ev,
        '',
        `整场会议转录较长，已分段提取。以下是合并后的提取结果(JSON)，其中的编号对应真实转录。请据此（并结合 meta/guide/资料/笔记）生成最终完整纪要 JSON，保留 sources 与逐字原话，不要新增没有依据的内容：\n${JSON.stringify(merged)}`,
      ),
    );
  }

  const { json, droppedUnsupported, droppedQuotes } = verifyAndBuild(raw, ev, input);
  return {
    json,
    stats: {
      mode,
      model,
      fallbackFrom,
      passes,
      chunks,
      segments: input.segments.length,
      transcriptChars,
      notes: input.notes.filter((n) => n.content.trim()).length,
      docsIncluded: ev.docsIncluded,
      truncatedDocs: ev.truncatedDocs,
      droppedUnsupported,
      droppedQuotes,
      promptTokens: promptTokens || undefined,
      completionTokens: completionTokens || undefined,
      durationMs: Date.now() - started,
    },
  };
}

/**
 * Enforces the research-integrity rules in code, regardless of what the model returned:
 *  - citations must point at real evidence ids
 *  - participant claims and quotes need transcript support
 *  - quotes must literally occur in the cited segment(s)
 */
export function verifyAndBuild(raw: Raw, ev: Evidence, input: SummaryInput) {
  const validIds = new Set(Object.keys(ev.refs));
  const clean = (ids: string[]) => [...new Set(ids.map((s) => s.trim().toUpperCase()).filter((s) => validIds.has(s)))];
  const hasT = (ids: string[]) => ids.some((i) => i.startsWith('T'));
  let droppedUnsupported = 0;
  let droppedQuotes = 0;

  const segByRef = new Map(input.segments.map((s) => [`T${s.seq}`, s]));
  const textOf = (ref: string) => {
    const s = segByRef.get(ref);
    return s ? effectiveText(s) : '';
  };

  const themes = raw.themes.flatMap((t) => {
    const sources = clean(t.sources);
    if (!t.text.trim() || !hasT(sources)) {
      droppedUnsupported++;
      return [];
    }
    return [{ title: t.title.trim() || '主题', text: t.text.trim(), sources }];
  });

  const participantViews = raw.participantViews.flatMap((v) => {
    const sources = clean(v.sources);
    if (!v.text.trim() || !hasT(sources)) {
      droppedUnsupported++;
      return [];
    }
    // The speaker must be the label actually attached to the cited segments; otherwise we would be inventing attribution.
    const labels = new Set(sources.filter((s) => s.startsWith('T')).map((s) => segByRef.get(s)?.speakerLabel?.trim() || '未标注'));
    const speaker = labels.size === 1 ? [...labels][0]! : '多位/未标注';
    return [{ speaker, text: v.text.trim(), sources }];
  });

  const quotes = raw.quotes.flatMap((q) => {
    const source = q.source.trim().toUpperCase();
    const body = q.text.trim().replace(/^[“"「]|[”"」]$/g, '');
    if (!body || !source.startsWith('T') || !validIds.has(source)) {
      droppedQuotes++;
      return [];
    }
    // Allow the quote to span into the next segment only if it literally matches the cited text.
    const hay = normForMatch(textOf(source));
    if (!hay.includes(normForMatch(body)) || normForMatch(body).length < 2) {
      droppedQuotes++;
      return [];
    }
    return [{ text: body, source, speaker: segByRef.get(source)?.speakerLabel?.trim() || '未标注' }];
  });

  const findings = raw.findings.flatMap((f) => {
    const sources = clean(f.sources);
    if (!f.text.trim() || !sources.some((s) => s.startsWith('T') || s.startsWith('N'))) {
      droppedUnsupported++;
      return [];
    }
    return [{ text: f.text.trim(), sources }];
  });

  const loose = (arr: Array<{ text: string; sources: string[] }>) => arr.filter((x) => x.text.trim()).map((x) => ({ text: x.text.trim(), sources: clean(x.sources) }));

  const json: SummaryJson = {
    background: { text: raw.background?.text?.trim() ?? '', sources: clean(raw.background?.sources ?? []) },
    themes,
    participantViews,
    quotes,
    findings,
    openQuestions: loose(raw.openQuestions).map((q) => ({ ...q, suggested: !hasT(q.sources) })),
    suggestedFollowups: loose(raw.suggestedFollowups),
    actionItems: loose(raw.actionItems),
    refs: ev.refs,
  };
  return { json, droppedUnsupported, droppedQuotes };
}
