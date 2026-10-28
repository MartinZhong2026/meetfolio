import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LlmError } from '../src/ai/llm.js';
import { chunkLines } from '../src/ai/summarize.js';
import { api, createMeeting, defaultSummaryJson, makeEnv, register, type Session, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => (env = await makeEnv()));
afterAll(() => env.close());
beforeEach(() => env.reset());

async function seedMeeting(s: Session, n = 3) {
  const m = await createMeeting(env, s, { title: '养老护理员访谈', researchContext: '研究背景：社区养老护理' });
  const texts = ['我觉得最大的困难还是护理人员不足，而且专业培训也不够。', '工资偏低，夜班多，所以流动率很高。', '人工智能可以帮忙监测，但不能代替人。'];
  for (let i = 0; i < n; i++) {
    await env.ctx.db.$client.query(
      `insert into transcript_segments (meeting_id, seq, dedupe_key, start_ms, end_ms, original_text, speaker_label) values ($1, $2, $3, $4, $5, $6, $7)`,
      [m.id, i + 1, `k${i}`, i * 5000, i * 5000 + 4000, texts[i % 3], i % 2 === 0 ? '受访者' : null],
    );
  }
  await env.ctx.db.$client.query('update meetings set next_seq = $2 where id = $1', [m.id, n + 1]);
  return m;
}

async function waitFor<T>(fn: () => Promise<T | null | false>, ms = 5000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const latest = async (s: Session, id: string) => (await api(env, s).get(`/api/meetings/${id}`)).json().summary;

describe('AI summaries', () => {
  it('generates, stores and exposes a structured summary; the dashboard status flips to ready', async () => {
    const s = await register(env);
    const m = await seedMeeting(s);
    const r = await api(env, s).post(`/api/meetings/${m.id}/summary`, { mode: 'standard' });
    expect(r.status).toBe(202);
    const sum = await waitFor(async () => {
      const x = await latest(s, m.id);
      return x?.status === 'ready' ? x : null;
    });
    expect(sum.generatedMd).toContain('## 一、会议基本信息');
    expect(sum.generatedMd).toContain('## 十、后续行动事项');
    expect(sum.model).toBe(env.ctx.config.LLM_MODEL_STANDARD);
    expect(sum.stats.passes).toBe('single');
    const list = (await api(env, s).get('/api/meetings')).json().meetings;
    expect(list[0].summaryStatus).toBe('ready');
  });

  it('keeps research integrity: unsupported claims, fabricated quotes and bogus citations are removed', async () => {
    const s = await register(env);
    const m = await seedMeeting(s);
    await api(env, s).post(`/api/meetings/${m.id}/summary`, {});
    const sum = await waitFor(async () => {
      const x = await latest(s, m.id);
      return x?.status === 'ready' ? x : null;
    });
    expect(sum.stats.droppedQuotes).toBe(1);
    expect(sum.stats.droppedUnsupported).toBe(1);
    expect(sum.generatedJson.quotes).toHaveLength(1);
    expect(sum.generatedMd).not.toContain('从来没有人说过');
    expect(sum.generatedMd).not.toContain('没有任何依据的推断');
    // Quotes carry a deep link back to the supporting segment.
    expect(sum.generatedMd).toMatch(/\[00:00:00\]\(#seg-1\)/);
    // Participant claims remain attributable to the real label attached to the cited segment.
    expect(sum.generatedJson.participantViews[0].speaker).toBe('受访者');
    // AI inference is labelled and separated from participant statements.
    expect(sum.generatedMd).toContain('AI 推断');
  });

  it('puts transcript, notes and reference material in separate, labelled prompt sections', async () => {
    const s = await register(env);
    const m = await seedMeeting(s);
    await api(env, s).put(`/api/meetings/${m.id}/notes/${crypto.randomUUID()}`, { content: '现场观察：受访者谈到工资时犹豫', category: 'observation', timestampMs: 5000 });
    await api(env, s).post(`/api/meetings/${m.id}/documents/paste`, { title: '研究背景', text: '背景资料：这里提到“护理员月薪三千”但这不是访谈内容。' });
    await api(env, s).post(`/api/meetings/${m.id}/guide/import`, { text: '问题一：困难是什么？' });
    await api(env, s).post(`/api/meetings/${m.id}/summary`, {});
    await waitFor(async () => (await latest(s, m.id))?.status === 'ready');
    const prompt = env.llm.calls[0]!.messages.map((x) => x.content).join('\n');
    expect(env.llm.calls[0]!.messages[0]!.content).toContain('不是会议中说过的话');
    expect(prompt).toMatch(/<transcript[^>]*>[\s\S]*\[T1 00:00:00 发言者:受访者\]/);
    expect(prompt).toMatch(/<researcher_notes[^>]*>[\s\S]*\[N1 00:00:05 研究者观察\]/);
    expect(prompt).toMatch(/<reference_materials[^>]*>[\s\S]*<doc id="D1"/);
    expect(prompt).toContain('<guide>');
    // Reference text must never appear inside the transcript block.
    const transcriptBlock = /<transcript[^>]*>([\s\S]*?)<\/transcript>/.exec(prompt)![1]!;
    expect(transcriptBlock).not.toContain('月薪三千');
  });

  it('human notes appear verbatim and labelled in the rendered report, not rewritten by the model', async () => {
    const s = await register(env);
    const m = await seedMeeting(s);
    const note = '现场观察：受访者谈到工资问题时表现出明显犹豫。';
    await api(env, s).put(`/api/meetings/${m.id}/notes/${crypto.randomUUID()}`, { content: note, category: 'observation' });
    await api(env, s).post(`/api/meetings/${m.id}/summary`, {});
    const sum = await waitFor(async () => {
      const x = await latest(s, m.id);
      return x?.status === 'ready' ? x : null;
    });
    expect(sum.generatedMd).toContain(note);
    expect(sum.generatedMd).toMatch(/研究者的人工笔记原文，未经 AI 改写/);
  });

  it('regenerating creates a new version and keeps the old one; edits are saved separately from generated text', async () => {
    const s = await register(env);
    const m = await seedMeeting(s);
    await api(env, s).post(`/api/meetings/${m.id}/summary`, {});
    const v1 = await waitFor(async () => {
      const x = await latest(s, m.id);
      return x?.status === 'ready' ? x : null;
    });
    const edit = await api(env, s).patch(`/api/meetings/${m.id}/summaries/${v1.id}`, { editedMd: '# 我修改后的纪要\n内容' });
    expect(edit.json().summary.editedMd).toContain('我修改后的纪要');
    expect(edit.json().summary.generatedMd).toBe(v1.generatedMd); // generated text untouched
    await api(env, s).post(`/api/meetings/${m.id}/summary`, { mode: 'quality' });
    const v2 = await waitFor(async () => {
      const x = await latest(s, m.id);
      return x?.version === 2 && x.status === 'ready' ? x : null;
    });
    expect(v2.model).toBe(env.ctx.config.LLM_MODEL_QUALITY);
    const all = (await api(env, s).get(`/api/meetings/${m.id}/summaries`)).json().summaries;
    expect(all.map((x: { version: number }) => x.version)).toEqual([2, 1]);
    expect(all[1].editedMd).toContain('我修改后的纪要'); // old version and its edit preserved
  });

  it('falls back to the standard model if the quality model id is unavailable, and records it', async () => {
    const s = await register(env);
    const m = await seedMeeting(s);
    env.llm.respond = (req) => (req.model === env.ctx.config.LLM_MODEL_QUALITY ? new LlmError('llm_model_not_found', 'nope') : JSON.stringify({ themes: [], participantViews: [], quotes: [], findings: [] }));
    await api(env, s).post(`/api/meetings/${m.id}/summary`, { mode: 'quality' });
    const sum = await waitFor(async () => {
      const x = await latest(s, m.id);
      return x?.status === 'ready' ? x : null;
    });
    expect(sum.stats.fallbackFrom).toBe(env.ctx.config.LLM_MODEL_QUALITY);
    expect(sum.model).toBe(env.ctx.config.LLM_MODEL_STANDARD);
  });

  it('reports provider failures without losing the meeting, and recovers on retry', async () => {
    const s = await register(env);
    const m = await seedMeeting(s);
    env.llm.respond = () => new LlmError('llm_auth', 'bad key');
    await api(env, s).post(`/api/meetings/${m.id}/summary`, {});
    const failed = await waitFor(async () => {
      const x = await latest(s, m.id);
      return x?.status === 'failed' ? x : null;
    });
    expect(failed.errorCode).toBe('llm_auth');
    expect((await api(env, s).get('/api/meetings')).json().meetings[0].summaryStatus).toBe('failed');
    env.llm.respond = (req) => JSON.stringify({ themes: [], participantViews: [], quotes: [], findings: [] });
    expect((await api(env, s).post(`/api/meetings/${m.id}/summary`, {})).status).toBe(202);
    await waitFor(async () => (await latest(s, m.id))?.status === 'ready');
  });

  it('retries once when the model returns invalid JSON, and fails cleanly if it keeps doing so', async () => {
    const s = await register(env);
    const m = await seedMeeting(s);
    env.llm.respond = (_req, n) => (n === 1 ? '好的，这是纪要：（不是JSON）' : JSON.stringify({ themes: [], participantViews: [], quotes: [], findings: [] }));
    await api(env, s).post(`/api/meetings/${m.id}/summary`, {});
    await waitFor(async () => (await latest(s, m.id))?.status === 'ready');
    expect(env.llm.calls.length).toBe(2);

    env.llm.respond = () => 'still not json';
    await api(env, s).post(`/api/meetings/${m.id}/summary`, {});
    const f = await waitFor(async () => {
      const x = await latest(s, m.id);
      return x?.version === 2 && x.status === 'failed' ? x : null;
    });
    expect(f.errorCode).toBe('bad_model_output');
  });

  it('refuses to summarise an empty meeting and when the AI service is not configured', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    const r = await api(env, s).post(`/api/meetings/${m.id}/summary`, {});
    expect(r.status).toBe(400);
    expect(r.json().error.code).toBe('no_content');
    const off = await makeEnv({ env: { DASHSCOPE_API_KEY: '' } });
    try {
      off.llm.configured = false;
      const s2 = await register(off);
      const m2 = await seedMeetingIn(off, s2);
      const r2 = await api(off, s2).post(`/api/meetings/${m2}/summary`, {});
      expect(r2.status).toBe(400);
      expect(r2.json().error.code).toBe('llm_not_configured');
    } finally {
      await off.close();
    }
  });

  it('enforces the daily generation limit', async () => {
    const lim = await makeEnv({ env: { SUMMARY_DAILY_LIMIT: '1' } });
    try {
      const s = await register(lim);
      const mid = await seedMeetingIn(lim, s);
      expect((await api(lim, s).post(`/api/meetings/${mid}/summary`, {})).status).toBe(202);
      await waitFor(async () => (await api(lim, s).get(`/api/meetings/${mid}`)).json().summary?.status === 'ready');
      const again = await api(lim, s).post(`/api/meetings/${mid}/summary`, {});
      expect(again.status).toBe(429);
      expect(again.json().error.code).toBe('summary_daily_limit');
    } finally {
      await lim.close();
    }
  });

  it('long meetings use map-reduce without dropping segments, and ids still verify', async () => {
    const lim = await makeEnv({ env: { SUMMARY_SINGLE_PASS_CHAR_LIMIT: '400', SUMMARY_CHUNK_CHAR_LIMIT: '300' } });
    try {
      const s = await register(lim);
      const mid = await seedMeetingIn(lim, s, 12);
      // Chunk-level calls answer from their own transcript; the final reduce call echoes the merged extraction it was given.
      lim.llm.respond = (req) => {
        const prompt = req.messages.map((m) => m.content).join('\n');
        const merged = /合并后的提取结果\(JSON\)[^\n]*：\n(\{[\s\S]*?\})\n\nJSON 结构/.exec(prompt) ?? /合并后的提取结果\(JSON\)[^\n]*：\n(\[[\s\S]*\])\n\nJSON 结构/.exec(prompt);
        if (merged) {
          const parsed = JSON.parse(merged[1]!);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          return JSON.stringify({ themes: arr.flatMap((p) => p.themes ?? []), participantViews: [], quotes: [], findings: [] });
        }
        return defaultSummaryJson(req);
      };
      await api(lim, s).post(`/api/meetings/${mid}/summary`, {});
      const sum = await waitFor(async () => {
        const x = (await api(lim, s).get(`/api/meetings/${mid}`)).json().summary;
        return x?.status === 'ready' ? x : null;
      });
      expect(sum.stats.passes).toBe('map-reduce');
      expect(sum.stats.chunks).toBeGreaterThan(1);
      // Every transcript line was sent to the model in some chunk.
      const sent = lim.llm.calls.map((c) => c.messages.map((m) => m.content).join('\n')).join('\n');
      for (let i = 1; i <= 12; i++) expect(sent).toContain(`[T${i} `);
      expect(sum.generatedJson.themes.length).toBeGreaterThan(0);
    } finally {
      await lim.close();
    }
  });
});

async function seedMeetingIn(e: TestEnv, s: Session, n = 3) {
  const m = await createMeeting(e, s);
  for (let i = 0; i < n; i++) {
    await e.ctx.db.$client.query(`insert into transcript_segments (meeting_id, seq, dedupe_key, start_ms, end_ms, original_text) values ($1, $2, $3, $4, $5, $6)`, [m.id, i + 1, `k${i}`, i * 5000, i * 5000 + 4000, `第${i}段发言：护理人员不足而且培训不够，需要更多支持。`]);
  }
  await e.ctx.db.$client.query('update meetings set next_seq = $2 where id = $1', [m.id, n + 1]);
  return m.id;
}

describe('chunking', () => {
  it('never splits a line and respects the limit', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ line: `line-${i}-` + 'x'.repeat(50) }));
    const chunks = chunkLines(lines, 150);
    expect(chunks.flat()).toHaveLength(10);
    for (const c of chunks) expect(c.join('\n').length).toBeLessThanOrEqual(150 + 70);
    expect(chunks.length).toBeGreaterThan(2);
  });
});
