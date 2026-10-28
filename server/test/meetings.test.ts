import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMeeting, makeEnv, register, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => (env = await makeEnv()));
afterAll(() => env.close());
beforeEach(() => env.reset());

describe('meetings', () => {
  it('creates a meeting with only a title and applies sensible defaults', async () => {
    const s = await register(env);
    const r = await api(env, s).post('/api/meetings', { title: '快速访谈' });
    expect(r.status).toBe(200);
    const m = r.json().meeting;
    expect(m.type).toBe('general');
    expect(m.transcriptStatus).toBe('none');
    expect(m.summaryStatus).toBe('none');
    expect(m.isDemo).toBe(false);
  });

  it('requires a title and validates the type', async () => {
    const s = await register(env);
    expect((await api(env, s).post('/api/meetings', { title: '   ' })).status).toBe(400);
    expect((await api(env, s).post('/api/meetings', { title: 'x', type: 'nonsense' })).status).toBe(400);
  });

  it('persists full metadata and participants, and returns them in the bundle', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s, {
      title: '社区养老服务专题访谈',
      type: 'academic_interview',
      location: '杭州市某社区',
      organizer: '张教授',
      researchContext: '关注护理员职业发展',
      participants: [{ name: '李女士', role: 'interviewee' }, { name: '王同学', role: 'interviewer' }],
    });
    const b = (await api(env, s).get(`/api/meetings/${m.id}`)).json();
    expect(b.meeting.location).toBe('杭州市某社区');
    expect(b.participants.map((p: { name: string }) => p.name)).toEqual(['李女士', '王同学']);
  });

  it('edits and renames a meeting; updates persist across reads', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    const p = await api(env, s).patch(`/api/meetings/${m.id}`, { title: '新标题', location: '会议室A', participants: [{ name: 'A', role: 'other' }] });
    expect(p.json().meeting.title).toBe('新标题');
    const b = (await api(env, s).get(`/api/meetings/${m.id}`)).json();
    expect(b.meeting.title).toBe('新标题');
    expect(b.participants).toHaveLength(1);
  });

  it('lists newest first and searches title, location, participants and transcript text', async () => {
    const s = await register(env);
    const a = await createMeeting(env, s, { title: '护理员访谈', meetingDate: '2026-01-01T00:00:00Z' });
    const b = await createMeeting(env, s, { title: '组会', location: '西湖', meetingDate: '2026-02-01T00:00:00Z', participants: [{ name: '赵老师', role: 'other' }] });
    const list = (await api(env, s).get('/api/meetings')).json().meetings;
    expect(list.map((x: { id: string }) => x.id)).toEqual([b.id, a.id]);
    const find = async (q: string) => (await api(env, s).get(`/api/meetings?q=${encodeURIComponent(q)}`)).json().meetings.map((x: { id: string }) => x.id);
    expect(await find('护理')).toEqual([a.id]);
    expect(await find('西湖')).toEqual([b.id]);
    expect(await find('赵老师')).toEqual([b.id]);
    await env.ctx.db.$client.query(`insert into transcript_segments (meeting_id, seq, dedupe_key, start_ms, end_ms, original_text) values ($1, 1, 'k', 0, 1000, '工资偏低是主要原因')`, [a.id]);
    expect(await find('工资偏低')).toEqual([a.id]);
    expect(await find('%')).toEqual([]); // LIKE wildcards are escaped
  });

  it('deletes a meeting and everything attached to it', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    await api(env, s).put(`/api/meetings/${m.id}/notes/${crypto.randomUUID()}`, { content: '笔记', category: 'general' });
    expect((await api(env, s).del(`/api/meetings/${m.id}`)).status).toBe(200);
    expect((await api(env, s).get(`/api/meetings/${m.id}`)).status).toBe(404);
    const { rows } = await env.ctx.db.$client.query('select count(*)::int as n from manual_notes');
    expect(rows[0].n).toBe(0);
  });

  it('end marks the transcript complete and keeps the duration', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    await env.ctx.db.$client.query('update meetings set recorded_ms = 125000 where id = $1', [m.id]);
    const r = (await api(env, s).post(`/api/meetings/${m.id}/end`)).json().meeting;
    expect(r.transcriptStatus).toBe('complete');
    expect(r.durationMs).toBe(125000);
    expect(r.endedAt).toBeTruthy();
  });

  it('demo meetings can only be created when demo mode is enabled', async () => {
    const off = await makeEnv({ env: { DEMO_MODE: 'false' } });
    try {
      const s = await register(off);
      expect((await api(off, s).post('/api/meetings', { title: 'd', demo: true })).status).toBe(400);
      expect((await api(env, await register(env)).post('/api/meetings', { title: 'd', demo: true })).status).toBe(200);
    } finally {
      await off.close();
    }
  });
});

describe('data isolation between users', () => {
  it('returns 404 (not 403) for every route on another user’s meeting', async () => {
    const alice = await register(env);
    const bob = await register(env);
    const m = await createMeeting(env, alice);
    const nid = crypto.randomUUID();
    await api(env, alice).put(`/api/meetings/${m.id}/notes/${nid}`, { content: 'secret', category: 'general' });
    const bobApi = api(env, bob);
    const probes: Array<[string, string, unknown?]> = [
      ['GET', `/api/meetings/${m.id}`],
      ['PATCH', `/api/meetings/${m.id}`, { title: 'hacked' }],
      ['DELETE', `/api/meetings/${m.id}`],
      ['POST', `/api/meetings/${m.id}/end`, {}],
      ['PUT', `/api/meetings/${m.id}/notes/${crypto.randomUUID()}`, { content: 'x', category: 'general' }],
      ['PUT', `/api/meetings/${m.id}/notes/${nid}`, { content: 'overwrite', category: 'general' }],
      ['DELETE', `/api/meetings/${m.id}/notes/${nid}`],
      ['GET', `/api/meetings/${m.id}/export?format=md`],
      ['GET', `/api/meetings/${m.id}/gaps`],
      ['POST', `/api/meetings/${m.id}/summary`, {}],
      ['POST', `/api/meetings/${m.id}/documents/paste`, { title: 't', text: 'x' }],
      ['POST', `/api/meetings/${m.id}/guide/import`, { text: '1. q' }],
    ];
    for (const [method, url, body] of probes) {
      const r = await bobApi.call(method as 'GET', url, body);
      expect(r.status, `${method} ${url}`).toBe(404);
    }
    // Bob's own list is empty and Alice's data is untouched.
    expect((await bobApi.get('/api/meetings')).json().meetings).toEqual([]);
    const b = (await api(env, alice).get(`/api/meetings/${m.id}`)).json();
    expect(b.meeting.title).toBe('养老护理员访谈');
    expect(b.notes[0].content).toBe('secret');
  });

  it('a note id cannot be hijacked across meetings of the same user either', async () => {
    const s = await register(env);
    const m1 = await createMeeting(env, s);
    const m2 = await createMeeting(env, s);
    const nid = crypto.randomUUID();
    await api(env, s).put(`/api/meetings/${m1.id}/notes/${nid}`, { content: 'one', category: 'general' });
    const r = await api(env, s).put(`/api/meetings/${m2.id}/notes/${nid}`, { content: 'two', category: 'general' });
    expect(r.status).toBe(404);
    expect((await api(env, s).get(`/api/meetings/${m1.id}`)).json().notes[0].content).toBe('one');
  });
});
