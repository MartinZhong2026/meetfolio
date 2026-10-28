import mammoth from 'mammoth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMeeting, makeEnv, register, type Session, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => (env = await makeEnv()));
afterAll(() => env.close());
beforeEach(() => env.reset());

async function seed(s: Session) {
  const m = await createMeeting(env, s, {
    title: '社区养老服务专题访谈',
    meetingDate: '2026-10-27T02:00:00Z',
    location: '杭州',
    organizer: '张教授',
    participants: [{ name: '李女士', role: 'interviewee' }],
  });
  const q = env.ctx.db.$client;
  await q.query(`insert into transcript_segments (meeting_id, seq, dedupe_key, start_ms, end_ms, original_text, edited_text, speaker_label, is_important) values
    ($1, 1, 'a', 135000, 140000, '您觉得社区养老服务最需要改善的是什么', null, '访谈员', false),
    ($1, 2, 'b', 144000, 150000, '我觉得最大的困难是护理人员不足', '我觉得最大的困难是护理员不足', '受访者', true)`, [m.id]);
  await q.query(`insert into transcript_gaps (meeting_id, start_ms, end_ms, reason, status) values ($1, 200000, 230000, 'network', 'open')`, [m.id]);
  await q.query('update meetings set recorded_ms = 1052000, duration_ms = 1052000 where id = $1', [m.id]);
  await api(env, s).put(`/api/meetings/${m.id}/notes/${crypto.randomUUID()}`, { content: '受访者提到护理员流动率很高', category: 'finding', isImportant: true, timestampMs: 150000 });
  await q.query(`insert into meeting_summaries (meeting_id, version, status, model, generated_md, edited_md) values ($1, 1, 'ready', 'm', '# 标题\n## 一、会议基本信息\n- 标题：x\n- **重点**：[00:02:24](#seg-2)', null)`, [m.id]);
  return m;
}

describe('exports', () => {
  it('Markdown contains metadata, timestamped transcript (edited text), notes, summary and an explicit gap marker', async () => {
    const s = await register(env);
    const m = await seed(s);
    const r = await api(env, s).get(`/api/meetings/${m.id}/export?format=md`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/markdown');
    expect(r.headers['content-disposition']).toContain("filename*=UTF-8''");
    const md = r.body;
    expect(md).toContain('# 社区养老服务专题访谈');
    expect(md).toContain('日期：2026年10月27日');
    expect(md).toContain('时长：17分32秒');
    expect(md).toContain('参与者：李女士（受访者）');
    expect(md).toContain('**[00:02:15]** 访谈员：您觉得社区养老服务最需要改善的是什么');
    expect(md).toContain('我觉得最大的困难是护理员不足'); // corrected text
    expect(md).not.toContain('护理人员不足'); // original ASR text is not what is exported
    expect(md).toContain('_（已修订）_');
    expect(md).toContain('受访者提到护理员流动率很高');
    expect(md).toContain('[00:03:20–00:03:50]');
    expect(md).toContain('转录缺失');
    expect(md).toContain('[00:02:24]'); // summary link kept as plain timestamp
    expect(md).not.toContain('(#seg-2)');
  });

  it('TXT is readable plain text; DOCX opens as a valid Word file with the same Chinese content', async () => {
    const s = await register(env);
    const m = await seed(s);
    const txt = await api(env, s).get(`/api/meetings/${m.id}/export?format=txt`);
    expect(txt.headers['content-type']).toContain('text/plain');
    expect(txt.body).toContain('【转录文本】');
    expect(txt.body).toContain('[00:02:24] 受访者：我觉得最大的困难是护理员不足 ★（已修订）');
    expect(txt.body).not.toMatch(/\*\*|^#/m);

    const docx = await api(env, s).get(`/api/meetings/${m.id}/export?format=docx`);
    expect(docx.status).toBe(200);
    expect(docx.headers['content-type']).toContain('wordprocessingml');
    expect(docx.raw.subarray(0, 2).toString()).toBe('PK');
    const { value } = await mammoth.extractRawText({ buffer: docx.raw });
    expect(value).toContain('社区养老服务专题访谈');
    expect(value).toContain('[00:02:15]');
    expect(value).toContain('我觉得最大的困难是护理员不足');
    expect(value).toContain('受访者提到护理员流动率很高');
    expect(value).toContain('AI 纪要');
  });

  it('prefers the user-edited summary and lets the caller choose which parts to export', async () => {
    const s = await register(env);
    const m = await seed(s);
    await env.ctx.db.$client.query(`update meeting_summaries set edited_md = '## 我改过的纪要\n正文' where meeting_id = $1`, [m.id]);
    const only = await api(env, s).get(`/api/meetings/${m.id}/export?format=md&parts=summary`);
    expect(only.body).toContain('我改过的纪要');
    expect(only.body).toContain('含研究者修订');
    expect(only.body).not.toContain('转录文本');
    expect(only.body).not.toContain('人工笔记');
  });

  it('rejects unknown formats and works for a meeting with no content', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    expect((await api(env, s).get(`/api/meetings/${m.id}/export?format=pdf`)).status).toBe(400);
    expect((await api(env, s).get(`/api/meetings/${m.id}/export?format=md&parts=bogus`)).status).toBe(400);
    const empty = await api(env, s).get(`/api/meetings/${m.id}/export?format=docx`);
    expect(empty.status).toBe(200);
  });
});
