import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { verify } from 'argon2';
import { createDatabase } from '../src/database/connection';
import { User, UserStatus } from '../src/database/models';

interface TokenResponse { accessToken: string; user: { id: string; role: string; status: string } }

async function unusedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL database.');

test('compiled auth API persists users and enforces current PostgreSQL account state', async (t) => {
  const database = createDatabase(url);
  const port = await unusedPort();
  const email = `auth-${randomUUID()}@example.org`;
  const raceEmail = `race-${randomUUID()}@example.org`;
  const password = randomBytes(24).toString('hex');
  const registration = { name: 'Integration Member', email: ` ${email.toUpperCase()} `, password, confirmPassword: password };
  const server = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DATABASE_URL: url, JWT_SECRET: randomBytes(48).toString('hex'), JWT_ACCESS_TOKEN_TTL_SECONDS: '900', CORS_ALLOWED_ORIGINS: 'http://localhost:5173' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const stopped = once(server, 'exit');
  async function call(path: string, body?: object, token?: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/api/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  try {
    await database.authenticate();
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(server.exitCode, null, 'Compiled server exited before startup');
      try { if ((await call('health')).ok) { ready = true; break; } } catch { /* Waiting for HTTP startup. */ }
      await delay(100);
    }
    assert.ok(ready, 'Compiled server did not become ready');
    await t.test('registers a safe pending user with a verified Argon2id password', async () => {
      const response = await call('auth/register', registration);
      assert.equal(response.status, 201);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(body.email, email);
      assert.equal(body.role, 'MEMBER');
      assert.equal(body.status, 'PENDING');
      assert.equal('passwordHash' in body, false);
      const stored = await User.unscoped().findOne({ where: { email }, rejectOnEmpty: true });
      assert.equal(await verify(stored.passwordHash, password), true);
    });
    await t.test('rejects duplicate and concurrent normalized emails', async () => {
      assert.equal((await call('auth/register', registration)).status, 409);
      const responses = await Promise.all([call('auth/register', { ...registration, email: raceEmail }), call('auth/register', { ...registration, email: raceEmail.toUpperCase() })]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.equal(await User.count({ where: { email: raceEmail } }), 1);
    });
    await t.test('rejects pending users and allows active login and profile retrieval', async () => {
      assert.equal((await call('auth/login', { email, password })).status, 401);
      await User.update({ status: UserStatus.ACTIVE }, { where: { email } });
      const response = await call('auth/login', { email, password });
      assert.equal(response.status, 200);
      const body = await response.json() as TokenResponse;
      assert.equal(body.user.status, 'ACTIVE');
      const me = await call('auth/me', undefined, body.accessToken);
      assert.equal(me.status, 200);
      const profile = await me.json() as Record<string, unknown>;
      assert.equal(profile.email, email);
      assert.equal('passwordHash' in profile, false);
      await User.update({ status: UserStatus.SUSPENDED }, { where: { email } });
      assert.equal((await call('auth/me', undefined, body.accessToken)).status, 401);
      assert.equal((await call('auth/login', { email, password })).status, 401);
      await User.destroy({ where: { email } });
      assert.equal((await call('auth/me', undefined, body.accessToken)).status, 401);
    });
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    timer.unref();
    await stopped;
    clearTimeout(timer);
    try { await User.destroy({ where: { email: [email, raceEmail] } }); } finally { await database.close(); }
  }
});
