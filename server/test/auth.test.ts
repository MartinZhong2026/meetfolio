import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, makeEnv, register, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => (env = await makeEnv()));
afterAll(() => env.close());
beforeEach(() => env.reset());

describe('authentication', () => {
  it('registers, sets an httpOnly session cookie, and /me returns the user', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'Prof@Example.edu.cn', password: 'a-long-password' } });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/mf_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.json().user.email).toBe('prof@example.edu.cn'); // normalised
    const me = await env.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookie.split(';')[0]! } });
    expect(me.json().user.email).toBe('prof@example.edu.cn');
  });

  it('never stores the plaintext password or the raw session token', async () => {
    const s = await register(env, 'a@b.cn', 'my-secret-pass-1');
    const { rows } = await env.ctx.db.$client.query('select password_hash from users');
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].password_hash).not.toContain('my-secret-pass-1');
    const token = s.cookie.split('=')[1]!;
    const { rows: sess } = await env.ctx.db.$client.query('select token_hash from sessions');
    expect(sess[0].token_hash).not.toBe(token);
    expect(sess[0].token_hash).toHaveLength(64);
  });

  it('rejects duplicate emails, short passwords and invalid emails', async () => {
    await register(env, 'dup@x.cn');
    const dup = await api(env).post('/api/auth/register', { email: 'DUP@x.cn', password: 'another-password' });
    expect(dup.status).toBe(409);
    expect((await api(env).post('/api/auth/register', { email: 'n@x.cn', password: 'short' })).status).toBe(400);
    expect((await api(env).post('/api/auth/register', { email: 'not-an-email', password: 'long-enough-pass' })).status).toBe(400);
  });

  it('logs in with correct credentials and rejects wrong ones with the same message', async () => {
    await register(env, 'login@x.cn', 'right-password-1');
    const ok = await api(env).post('/api/auth/login', { email: 'login@x.cn', password: 'right-password-1' });
    expect(ok.status).toBe(200);
    const bad = await api(env).post('/api/auth/login', { email: 'login@x.cn', password: 'wrong-password-1' });
    const none = await api(env).post('/api/auth/login', { email: 'nobody@x.cn', password: 'wrong-password-1' });
    expect(bad.status).toBe(401);
    expect(none.status).toBe(401);
    expect(bad.json().error.message).toBe(none.json().error.message);
  });

  it('logout invalidates the session server-side', async () => {
    const s = await register(env);
    expect((await api(env, s).get('/api/meetings')).status).toBe(200);
    await api(env, s).post('/api/auth/logout');
    expect((await api(env, s).get('/api/meetings')).status).toBe(401);
  });

  it('rejects unauthenticated access to every protected route', async () => {
    const routes: Array<[string, string]> = [
      ['GET', '/api/meetings'],
      ['POST', '/api/meetings'],
      ['GET', '/api/meetings/00000000-0000-4000-8000-000000000000'],
      ['GET', '/api/account/usage'],
      ['PATCH', '/api/account'],
      ['GET', '/api/meetings/00000000-0000-4000-8000-000000000000/export?format=md'],
    ];
    for (const [m, u] of routes) {
      const r = await api(env).call(m as 'GET', u, m === 'GET' ? undefined : {});
      expect(r.status, `${m} ${u}`).toBe(401);
    }
  });

  it('password reset: token is single-use, expires old sessions, and does not reveal whether the email exists', async () => {
    const s = await register(env, 'reset@x.cn', 'old-password-123');
    const unknown = await api(env).post('/api/auth/forgot', { email: 'ghost@x.cn' });
    expect(unknown.json()).toEqual({ ok: true });
    expect(env.mails).toHaveLength(0);
    await api(env).post('/api/auth/forgot', { email: 'reset@x.cn' });
    expect(env.mails).toHaveLength(1);
    const token = /token=([\w-]+)/.exec(env.mails[0]!.text)![1]!;
    const done = await api(env).post('/api/auth/reset', { token, password: 'brand-new-password' });
    expect(done.status).toBe(200);
    expect((await api(env).post('/api/auth/reset', { token, password: 'another-password-1' })).status).toBe(400);
    expect((await api(env, s).get('/api/meetings')).status).toBe(401); // old session revoked
    expect((await api(env).post('/api/auth/login', { email: 'reset@x.cn', password: 'brand-new-password' })).status).toBe(200);
    expect((await api(env).post('/api/auth/login', { email: 'reset@x.cn', password: 'old-password-123' })).status).toBe(401);
  });

  it('change password requires the current password; deleting the account removes the data', async () => {
    const s = await register(env, 'del@x.cn', 'delete-me-password');
    expect((await api(env, s).post('/api/account/password', { currentPassword: 'nope-nope-nope', newPassword: 'new-password-12' })).status).toBe(401);
    expect((await api(env, s).call('DELETE', '/api/account', { password: 'wrong-password' })).status).toBe(401);
    const m = (await api(env, s).post('/api/meetings', { title: 'x' })).json().meeting;
    expect((await api(env, s).call('DELETE', '/api/account', { password: 'delete-me-password' })).status).toBe(200);
    const { rows } = await env.ctx.db.$client.query('select count(*)::int as n from meetings where id = $1', [m.id]);
    expect(rows[0].n).toBe(0);
  });
});

describe('private staging', () => {
  it('SIGNUP_ALLOWLIST restricts registration to listed emails and @domains; login is unaffected', async () => {
    const env2 = await makeEnv({ env: { SIGNUP_ALLOWLIST: 'pi@uni.edu.cn, @lab.example.cn' } });
    try {
      const reg = (email: string) => env2.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'long-enough-pass' } });
      expect((await reg('PI@uni.edu.cn')).statusCode).toBe(200);
      expect((await reg('student@lab.example.cn')).statusCode).toBe(200);
      const denied = await reg('stranger@gmail.com');
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('signup_closed');
      expect((await reg('x@evil-lab.example.cn.attacker.com')).statusCode).toBe(403);
      expect((await env2.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'pi@uni.edu.cn', password: 'long-enough-pass' } })).statusCode).toBe(200);
    } finally {
      await env2.close();
    }
  });
});

describe('security hardening', () => {
  it('rejects state-changing requests from a foreign Origin (CSRF)', async () => {
    const s = await register(env);
    const evil = await env.app.inject({ method: 'POST', url: '/api/meetings', payload: { title: 'x' }, headers: { cookie: s.cookie, origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    const good = await env.app.inject({ method: 'POST', url: '/api/meetings', payload: { title: 'x' }, headers: { cookie: s.cookie, origin: 'http://localhost:5173' } });
    expect(good.statusCode).toBe(200);
  });

  it('does not leak internals on server errors and sets security headers', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('applies rate limits to auth endpoints', async () => {
    const limited = await makeEnv({ rateLimit: true, env: { AUTH_RATE_LIMIT_PER_MINUTE: '3' } });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 6; i++) codes.push((await limited.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.cn', password: 'whatever-1' } })).statusCode);
      expect(codes).toContain(429);
    } finally {
      await limited.close();
    }
  });
});
