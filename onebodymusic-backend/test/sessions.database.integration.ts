import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { hash } from 'argon2';
import { QueryTypes } from 'sequelize';
import { createDatabase } from '../src/database/connection';
import { User, UserStatus } from '../src/database/models';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Dedicated migrated TEST_DATABASE_URL required');
const cookie = (response: Response) => response.headers.getSetCookie().find((value) => value.startsWith('onebodymusic_session='))?.split(';')[0] || '';
test('persistent browser sessions: cookies, CSRF, rotation, replay, logout, expiry and suspension', async (t) => {
  const db = createDatabase(url); const email = `session-${randomUUID()}@example.org`; const password = randomBytes(24).toString('hex');
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const address = socket.address(); assert.ok(address && typeof address === 'object'); const port = address.port; await new Promise<void>((resolve) => socket.close(() => resolve()));
  const server = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, DATABASE_URL: url, PORT: String(port), MEDIA_ENABLED: 'false', NODE_ENV: 'test', JWT_SECRET: randomBytes(48).toString('hex'), CORS_ALLOWED_ORIGINS: 'http://localhost:5173', AUTH_LOGIN_MAX_ATTEMPTS: '100' }, stdio: 'ignore' }); const stopped = once(server, 'exit');
  const call = (path: string, sessionCookie = '', body: object = {}, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}/api/v1/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', 'X-Session-Request': '1', ...(sessionCookie ? { Cookie: sessionCookie } : {}), ...headers }, body: JSON.stringify(body) });
  const login = () => call('session', '', { email, password });
  let user: User | undefined;
  try {
    await db.authenticate(); user = await User.create({ name: 'Session Member', email, passwordHash: await hash(password), status: UserStatus.ACTIVE });
    let ready = false; for (let i = 0; i < 100; i++) { assert.equal(server.exitCode, null); try { ready = (await fetch(`http://127.0.0.1:${port}/api/v1/health`)).ok; } catch {} if (ready) break; await delay(100); } assert.ok(ready);
    await t.test('sets a scoped HttpOnly cookie, stores only its hash, and rotates it without exposing refresh tokens in JSON', async () => {
      const response = await login(); assert.equal(response.status, 200); const first = cookie(response); assert.ok(first);
      const header = response.headers.getSetCookie().join(';'); assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Lax/); assert.match(header, /Path=\/api\/v1\/auth/); assert.match(header, /Expires=/); assert.doesNotMatch(header, /; Secure/);
      const body = await response.json() as { accessToken: string; user: { id: string } }; assert.ok(body.accessToken); assert.equal(body.user.id, user!.id); assert.equal(JSON.stringify(body).includes(first.split('=')[1]!), false);
      const token = first.split('=')[1]!; const rows = await db.query<{ hash: string }>('SELECT hash FROM "RefreshToken" WHERE hash=:hash', { replacements: { hash: createHash('sha256').update(token).digest('hex') }, type: QueryTypes.SELECT }); assert.equal(rows.length, 1); assert.notEqual(rows[0]!.hash, token);
      const rotated = await call('refresh', first); assert.equal(rotated.status, 200); const second = cookie(rotated); assert.notEqual(first, second);
      assert.equal((await call('refresh', first)).status, 401);
      assert.equal((await call('refresh', second)).status, 401, 'replaying a consumed token revokes its family');
    });
    await t.test('requires the CSRF header and approved Origin on login, refresh and logout', async () => {
      for (const path of ['session', 'refresh', 'logout']) {
        const body = path === 'session' ? { email, password } : {};
        assert.equal((await call(path, '', body, { Origin: 'https://untrusted.example' })).status, 403);
        assert.equal((await call(path, '', body, { 'X-Session-Request': '' })).status, 403);
      }
      assert.equal((await call('refresh', 'onebodymusic_session=malformed')).status, 401);
      assert.equal((await call('refresh', '', { injected: true })).status, 400);
    });
    await t.test('logout clears the cookie, revokes renewal, and is idempotent', async () => {
      const session = cookie(await login()); const response = await call('logout', session); assert.equal(response.status, 204); assert.match(response.headers.getSetCookie().join(';'), /onebodymusic_session=;/);
      assert.equal((await call('refresh', session)).status, 401); assert.equal((await call('logout')).status, 204);
    });
    await t.test('expired sessions cannot renew', async () => {
      const session = cookie(await login()); await db.query('UPDATE "AuthSession" SET "expiresAt"=CURRENT_TIMESTAMP - INTERVAL \'1 second\' WHERE "userId"=:id', { replacements: { id: user!.id } });
      assert.equal((await call('refresh', session)).status, 401);
    });
    await t.test('suspension revokes the family and reactivation cannot resurrect it', async () => {
      const session = cookie(await login()); await user!.update({ status: UserStatus.SUSPENDED }); assert.equal((await login()).status, 401);
      await user!.update({ status: UserStatus.ACTIVE }); assert.equal((await call('refresh', session)).status, 401);
    });
    await t.test('concurrent reuse rotates only once and revokes the family', async () => {
      const session = cookie(await login()); const responses = await Promise.all([call('refresh', session), call('refresh', session)]); assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
      const next = cookie(responses.find((response) => response.status === 200)!); assert.equal((await call('refresh', next)).status, 401);
    });
    await t.test('production sessions use Secure HttpOnly cookies, including explicit cross-site configuration', async () => {
      const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const target = probe.address(); assert.ok(target && typeof target === 'object'); const securePort = target.port; await new Promise<void>((resolve) => probe.close(() => resolve()));
      const production = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, DATABASE_URL: url, PORT: String(securePort), MEDIA_ENABLED: 'false', NODE_ENV: 'production', AUTH_COOKIE_SAME_SITE: 'none', JWT_SECRET: randomBytes(48).toString('hex'), CORS_ALLOWED_ORIGINS: 'https://music.example.test' }, stdio: 'ignore' }); const ended = once(production, 'exit');
      try {
        let available = false; for (let i = 0; i < 100; i++) { assert.equal(production.exitCode, null); try { available = (await fetch(`http://127.0.0.1:${securePort}/api/v1/health`)).ok; } catch {} if (available) break; await delay(100); } assert.ok(available);
        const response = await fetch(`http://127.0.0.1:${securePort}/api/v1/auth/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://music.example.test', 'X-Session-Request': '1' }, body: JSON.stringify({ email, password }) });
        assert.equal(response.status, 200); const value = response.headers.getSetCookie().join(';'); assert.match(value, /; Secure/); assert.match(value, /; HttpOnly/); assert.match(value, /SameSite=None/);
      } finally { if (production.exitCode === null) production.kill('SIGTERM'); await ended; }
    });
    await t.test('allows credentialed CORS only for approved frontend origins', async () => {
      const response = await call('refresh'); assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173'); assert.equal(response.headers.get('access-control-allow-credentials'), 'true'); assert.match(response.headers.get('cache-control') || '', /no-store/);
    });
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM'); await stopped;
    if (user) await user.destroy(); await db.close();
  }
});
