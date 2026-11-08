import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { hash, argon2id } from 'argon2';
import { ForbiddenException } from '@nestjs/common';
import { createDatabase } from '../src/database/connection';
import { Role, User, UserStatus } from '../src/database/models';
import { UsersService } from '../src/users/users.service';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL test database.');

async function unusedPort(): Promise<number> {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test('user management API and concurrent administrator protection in PostgreSQL', async (t) => {
  const db = createDatabase(url); const port = await unusedPort(); const suffix = randomUUID();
  const emails = [`admin-a-${suffix}@example.org`, `admin-b-${suffix}@example.org`, `member-${suffix}@example.org`];
  const password = randomBytes(24).toString('hex');
  const server = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, DATABASE_URL: url, JWT_SECRET: randomBytes(48).toString('hex'), PORT: String(port), CORS_ALLOWED_ORIGINS: 'http://localhost:5173' }, stdio: 'ignore' });
  const stopped = once(server, 'exit');
  async function call(path: string, method: string, token?: string, body?: object): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/api/v1/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  }
  async function login(email: string): Promise<string> {
    const response = await call('auth/login', 'POST', undefined, { email, password }); assert.equal(response.status, 200);
    return (await response.json() as { accessToken: string }).accessToken;
  }
  try {
    await db.authenticate();
    let ready = false;
    for (let i = 0; i < 100; i++) { assert.equal(server.exitCode, null); try { if ((await call('health', 'GET')).ok) { ready = true; break; } } catch { /* Await startup. */ } await delay(100); }
    assert.ok(ready);
    const passwordHash = await hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const a = await User.create({ name: 'Admin A', email: emails[0]!, passwordHash, role: Role.ADMIN, status: UserStatus.ACTIVE });
    const b = await User.create({ name: 'Admin B', email: emails[1]!, passwordHash, role: Role.ADMIN, status: UserStatus.ACTIVE });
    const member = await User.create({ name: 'Member', email: emails[2]!, passwordHash });
    const adminToken = await login(a.email);
    await t.test('lists safe paginated and filtered records and returns 404 for unknown IDs', async () => {
      const response = await call('users?page=1&limit=1&role=MEMBER&status=PENDING', 'GET', adminToken); assert.equal(response.status, 200);
      const page = await response.json() as { data: { status: string; role: string }[]; total: number; limit: number };
      assert.ok(page.total >= 1); assert.equal(page.limit, 1); assert.equal(page.data.length, 1);
      assert.equal(page.data[0]?.status, 'PENDING'); assert.equal(JSON.stringify(page).includes('passwordHash'), false);
      assert.equal((await call(`users/${randomUUID()}`, 'GET', adminToken)).status, 404);
    });
    let memberToken = '';
    await t.test('approves a member, permits own-name changes and denies privilege escalation', async () => {
      const approve = await call(`users/${member.id}/status`, 'PATCH', adminToken, { status: 'ACTIVE' }); assert.equal(approve.status, 200);
      memberToken = await login(member.email);
      assert.equal((await call('users', 'GET', memberToken)).status, 403);
      const update = await call('users/me', 'PATCH', memberToken, { name: ' Renamed Member ' }); assert.equal(update.status, 200);
      const body = await update.json() as { name: string }; assert.equal(body.name, 'Renamed Member'); assert.equal(JSON.stringify(body).includes('passwordHash'), false);
      assert.equal((await call('users/me', 'PATCH', memberToken, { name: 'Grace', role: 'ADMIN' })).status, 400);
      assert.equal((await call(`users/${a.id}/role`, 'PATCH', memberToken, { role: 'MEMBER' })).status, 403);
      assert.equal((await call(`users/${a.id}/role`, 'PATCH', adminToken, { role: 'MEMBER' })).status, 403);
      assert.equal((await call(`users/${a.id}/status`, 'PATCH', adminToken, { status: 'SUSPENDED' })).status, 403);
      assert.equal((await call(`users/${a.id.toUpperCase()}/role`, 'PATCH', adminToken, { role: 'MEMBER' })).status, 403);
      await member.reload(); assert.equal(member.role, Role.MEMBER);
    });
    await t.test('changes roles and immediately revokes access on suspension', async () => {
      assert.equal((await call(`users/${member.id}/role`, 'PATCH', adminToken, { role: 'ADMIN' })).status, 200);
      assert.equal((await call('users', 'GET', memberToken)).status, 200);
      assert.equal((await call(`users/${member.id}/role`, 'PATCH', adminToken, { role: 'MEMBER' })).status, 200);
      assert.equal((await call('users', 'GET', memberToken)).status, 403);
      assert.equal((await call(`users/${member.id}/status`, 'PATCH', adminToken, { status: 'SUSPENDED' })).status, 200);
      assert.equal((await call('users/me', 'PATCH', memberToken, { name: 'Another' })).status, 401);
    });
    await t.test('serializes concurrent mutual demotion/suspension and revalidates the actor', async () => {
      const service = new UsersService(User, db);
      const results = await Promise.allSettled([
        service.updateRole(a.id, b.id, Role.MEMBER),
        service.updateStatus(b.id, a.id, UserStatus.SUSPENDED),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const rejection = results.find((result) => result.status === 'rejected');
      assert.ok(rejection?.status === 'rejected' && rejection.reason instanceof ForbiddenException);
      const active = await User.findAll({ where: { id: [a.id, b.id], role: Role.ADMIN, status: UserStatus.ACTIVE } });
      assert.equal(active.length, 1);
      assert.ok(active[0]);
      await assert.rejects(service.updateRole(active[0].id, active[0].id, Role.MEMBER), ForbiddenException);
    });
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000); timer.unref(); await stopped; clearTimeout(timer);
    try { await User.destroy({ where: { email: emails } }); } finally { await db.close(); }
  }
});
