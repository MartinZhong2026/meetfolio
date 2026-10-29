import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseGuide } from '../src/lib/guide.js';
import { api, createMeeting, makeEnv, register, type TestEnv } from './helpers.js';
import { makeDocx, makePdf, multipart } from './fixtures.js';

let env: TestEnv;
beforeAll(async () => (env = await makeEnv()));
afterAll(() => env.close());
beforeEach(() => env.reset());

describe('manual notes (autosave semantics)', () => {
  it('upserts idempotently by client id, preserving the original timestamp and category edits', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    const id = crypto.randomUUID();
    const a = await api(env, s).put(`/api/meetings/${m.id}/notes/${id}`, { content: '受访者提到流动率很高', category: 'quote', timestampMs: 62000 });
    expect(a.status).toBe(200);
    // Autosave fires repeatedly with growing content and no timestamp: must not create duplicates or lose the time.
    await api(env, s).put(`/api/meetings/${m.id}/notes/${id}`, { content: '受访者提到流动率很高，需要核实原因', category: 'quote' });
    await api(env, s).put(`/api/meetings/${m.id}/notes/${id}`, { content: '受访者提到流动率很高，需要核实原因', category: 'finding', isImportant: true });
    const b = (await api(env, s).get(`/api/meetings/${m.id}`)).json();
    expect(b.notes).toHaveLength(1);
    expect(b.notes[0]).toMatchObject({ content: '受访者提到流动率很高，需要核实原因', category: 'finding', isImportant: true, timestampMs: 62000 });
  });

  it('survives a reload (read back from the database) and can be deleted', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    const id = crypto.randomUUID();
    await api(env, s).put(`/api/meetings/${m.id}/notes/${id}`, { content: '现场观察：犹豫', category: 'observation' });
    expect((await api(env, s).get(`/api/meetings/${m.id}`)).json().notes[0].content).toBe('现场观察：犹豫');
    await api(env, s).del(`/api/meetings/${m.id}/notes/${id}`);
    expect((await api(env, s).get(`/api/meetings/${m.id}`)).json().notes).toHaveLength(0);
  });

  it('rejects invalid categories and oversize content', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    expect((await api(env, s).put(`/api/meetings/${m.id}/notes/${crypto.randomUUID()}`, { content: 'x', category: 'weird' })).status).toBe(400);
    expect((await api(env, s).put(`/api/meetings/${m.id}/notes/${crypto.randomUUID()}`, { content: 'x'.repeat(20_001), category: 'general' })).status).toBe(400);
    expect((await api(env, s).put(`/api/meetings/${m.id}/notes/not-a-uuid`, { content: 'x', category: 'general' })).status).toBe(400);
  });
});

describe('interview guide', () => {
  it('parses Chinese and numbered question formats', () => {
    const r = parseGuide('研究主题：养老护理员职业发展\n\n问题一：目前护理人员最主要的工作困难是什么？\n问题二：您认为护理人员的专业培训是否充分？\n3. 人工智能技术可能如何改变护理工作？\n- 追问：流动率\nQ5: english question');
    expect(r.topic).toBe('养老护理员职业发展');
    expect(r.questions).toEqual(['目前护理人员最主要的工作困难是什么？', '您认为护理人员的专业培训是否充分？', '人工智能技术可能如何改变护理工作？', '追问：流动率', 'english question']);
  });

  it('imports a guide, sets the topic, toggles completion and supports follow-ups added during the interview', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    const imp = await api(env, s).post(`/api/meetings/${m.id}/guide/import`, { text: '研究主题：养老护理员职业发展\n问题一：困难是什么？\n问题二：培训是否充分？' });
    expect(imp.status).toBe(200);
    const qs = imp.json().questions;
    expect(qs).toHaveLength(2);
    await api(env, s).put(`/api/meetings/${m.id}/questions/${qs[0].id}`, { text: qs[0].text, done: true });
    const fid = crypto.randomUUID();
    await api(env, s).put(`/api/meetings/${m.id}/questions/${fid}`, { text: '培训有考核吗？', isFollowup: true });
    const b = (await api(env, s).get(`/api/meetings/${m.id}`)).json();
    expect(b.meeting.guideTopic).toBe('养老护理员职业发展');
    expect(b.questions.map((q: { text: string; done: boolean; isFollowup: boolean }) => [q.text, q.done, q.isFollowup])).toEqual([
      ['困难是什么？', true, false],
      ['培训是否充分？', false, false],
      ['培训有考核吗？', false, true],
    ]);
  });
});

describe('reference documents', () => {
  it('extracts text from TXT (UTF-8 and GB18030), Markdown, DOCX and PDF', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    const up = async (name: string, data: Buffer) => {
      const mp = multipart(name, data);
      const r = await env.app.inject({ method: 'POST', url: `/api/meetings/${m.id}/documents`, payload: mp.body, headers: { ...mp.headers, cookie: s.cookie } });
      return { status: r.statusCode, body: r.json() };
    };
    const txt = await up('guide.txt', Buffer.from('问题一：养老护理的困难？\n问题二：培训？', 'utf8'));
    expect(txt.status).toBe(200);
    expect(txt.body.document).toMatchObject({ title: 'guide', extractionStatus: 'ok' });


    const md = await up('notes.md', Buffer.from('# 背景\n访谈对象为护理员', 'utf8'));
    expect(md.status).toBe(200);

    const docx = await up('background.docx', await makeDocx(['研究背景：社区养老', '访谈对象：护理员']));
    expect(docx.status).toBe(200);
    const pdf = await up('paper.pdf', await makePdf('Aging care interview guide'));
    expect(pdf.status).toBe(200);

    const bundle = (await api(env, s).get(`/api/meetings/${m.id}`)).json();
    expect(bundle.documents).toHaveLength(4);
    const text = async (title: string) => {
      const d = bundle.documents.find((x: { title: string }) => x.title === title);
      return (await api(env, s).get(`/api/meetings/${m.id}/documents/${d.id}`)).json().text as string;
    };
    expect(await text('guide')).toContain('养老护理的困难');
    expect(await text('notes')).toContain('访谈对象为护理员');
    expect(await text('background')).toContain('研究背景：社区养老');
    expect(await text('paper')).toContain('Aging care interview guide');
  });

  it('decodes GB18030 text files', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    // "养老护理" in GB18030
    const gb = Buffer.from([0xd1, 0xf8, 0xc0, 0xcf, 0xbb, 0xa4, 0xc0, 0xed]);
    const mp = multipart('gbk.txt', gb);
    const r = await env.app.inject({ method: 'POST', url: `/api/meetings/${m.id}/documents`, payload: mp.body, headers: { ...mp.headers, cookie: s.cookie } });
    expect(r.statusCode).toBe(200);
    const id = r.json().document.id;
    expect((await api(env, s).get(`/api/meetings/${m.id}/documents/${id}`)).json().text).toBe('养老护理');
  });

  it('rejects unsupported types, spoofed extensions and oversize files', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    const post = (name: string, data: Buffer) => {
      const mp = multipart(name, data);
      return env.app.inject({ method: 'POST', url: `/api/meetings/${m.id}/documents`, payload: mp.body, headers: { ...mp.headers, cookie: s.cookie } });
    };
    expect((await post('evil.exe', Buffer.from('MZ...'))).statusCode).toBe(400);
    expect((await post('fake.pdf', Buffer.from('this is not a pdf'))).statusCode).toBe(400);
    expect((await post('fake.docx', Buffer.from('plain text'))).statusCode).toBe(400);
    expect((await post('bin.txt', Buffer.from([1, 2, 0, 3]))).statusCode).toBe(400);
    const small = await makeEnv({ env: { MAX_UPLOAD_MB: '1' } });
    try {
      const s2 = await register(small);
      const m2 = await createMeeting(small, s2);
      const mp = multipart('big.txt', Buffer.alloc(1.5 * 1024 * 1024, 'a'));
      const r = await small.app.inject({ method: 'POST', url: `/api/meetings/${m2.id}/documents`, payload: mp.body, headers: { ...mp.headers, cookie: s2.cookie } });
      expect([400, 413]).toContain(r.statusCode);
    } finally {
      await small.close();
    }
  });

  it('keeps files private: other users get 404 for text and original file; owner can download', async () => {
    const alice = await register(env);
    const bob = await register(env);
    const m = await createMeeting(env, alice);
    const mp = multipart('private.txt', Buffer.from('保密的访谈提纲'));
    const up = await env.app.inject({ method: 'POST', url: `/api/meetings/${m.id}/documents`, payload: mp.body, headers: { ...mp.headers, cookie: alice.cookie } });
    const docId = up.json().document.id;
    expect([...env.storage.files.keys()][0]).toContain(`u/${alice.user.id}/m/${m.id}/`);
    expect((await api(env, bob).get(`/api/meetings/${m.id}/documents/${docId}`)).status).toBe(404);
    expect((await api(env, bob).get(`/api/meetings/${m.id}/documents/${docId}/file`)).status).toBe(404);
    expect((await api(env).get(`/api/meetings/${m.id}/documents/${docId}/file`)).status).toBe(401);
    const dl = await api(env, alice).get(`/api/meetings/${m.id}/documents/${docId}/file`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.body).toBe('保密的访谈提纲');
    // Deleting the document removes the stored object.
    await api(env, alice).del(`/api/meetings/${m.id}/documents/${docId}`);
    expect(env.storage.files.size).toBe(0);
  });

  it('pasted background text is stored as a document and is editable; uploaded text is not', async () => {
    const s = await register(env);
    const m = await createMeeting(env, s);
    const p = await api(env, s).post(`/api/meetings/${m.id}/documents/paste`, { title: '研究背景', text: '本研究关注……' });
    expect(p.status).toBe(200);
    const id = p.json().document.id;
    const e = await api(env, s).patch(`/api/meetings/${m.id}/documents/${id}`, { text: '修订后的背景' });
    expect(e.status).toBe(200);
    expect((await api(env, s).get(`/api/meetings/${m.id}/documents/${id}`)).json().text).toBe('修订后的背景');
    const mp = multipart('a.txt', Buffer.from('原文'));
    const up = await env.app.inject({ method: 'POST', url: `/api/meetings/${m.id}/documents`, payload: mp.body, headers: { ...mp.headers, cookie: s.cookie } });
    expect((await api(env, s).patch(`/api/meetings/${m.id}/documents/${up.json().document.id}`, { text: 'x' })).status).toBe(400);
  });
});

describe('transcript corrections', () => {
  async function seed() {
    const s = await register(env);
    const m = await createMeeting(env, s);
    await env.ctx.db.$client.query(`insert into transcript_segments (meeting_id, seq, dedupe_key, start_ms, end_ms, original_text) values ($1, 1, 'k1', 0, 2000, '我觉得最大的困难是护理人员不足')`, [m.id]);
    await env.ctx.db.$client.query('update meetings set next_seq = 2 where id = $1', [m.id]);
    const seg = (await api(env, s).get(`/api/meetings/${m.id}`)).json().segments[0];
    return { s, m, seg };
  }

  it('keeps the original ASR text when the user edits, and reverts cleanly', async () => {
    const { s, m, seg } = await seed();
    const r = await api(env, s).patch(`/api/meetings/${m.id}/segments/${seg.id}`, { editedText: '我觉得最大的困难是护理员不足', speakerLabel: '受访者', isImportant: true });
    expect(r.json().segment).toMatchObject({ originalText: '我觉得最大的困难是护理人员不足', editedText: '我觉得最大的困难是护理员不足', speakerLabel: '受访者', isImportant: true });
    // Typing the original back counts as "no edit".
    const back = await api(env, s).patch(`/api/meetings/${m.id}/segments/${seg.id}`, { editedText: '我觉得最大的困难是护理人员不足' });
    expect(back.json().segment.editedText).toBeNull();
    const { rows } = await env.ctx.db.$client.query('select original_text from transcript_segments where id = $1', [seg.id]);
    expect(rows[0].original_text).toBe('我觉得最大的困难是护理人员不足');
  });

  it('only manually added passages can be deleted; recognised text cannot', async () => {
    const { s, m, seg } = await seed();
    expect((await api(env, s).del(`/api/meetings/${m.id}/segments/${seg.id}`)).status).toBe(400);
    const added = await api(env, s).post(`/api/meetings/${m.id}/segments`, { startMs: 5000, text: '手动补记的内容', speakerLabel: '访谈员' });
    expect(added.status).toBe(200);
    expect(added.json().segment.seq).toBe(2);
    expect((await api(env, s).del(`/api/meetings/${m.id}/segments/${added.json().segment.id}`)).status).toBe(200);
  });
});
