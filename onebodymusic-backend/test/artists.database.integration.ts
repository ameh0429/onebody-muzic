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
import { createDatabase } from '../src/database/connection';
import { Album, Artist, Role, Song, User, UserStatus } from '../src/database/models';
import { ArtistResponseDto } from '../src/artists/dto/artist-response.dto';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL database.');
async function unusedPort(): Promise<number> {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); return address.port;
}

test('compiled Artists API with PostgreSQL uniqueness, counts and safe deletion', async (t) => {
  const db = createDatabase(url); const port = await unusedPort(); const suffix = randomUUID();
  const emails = [`artist-admin-${suffix}@example.org`, `artist-member-${suffix}@example.org`];
  const password = randomBytes(24).toString('hex'); const artistIds: string[] = [];
  const api = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, DATABASE_URL: url, PORT: String(port), JWT_SECRET: randomBytes(48).toString('hex'), JWT_ACCESS_TOKEN_TTL_SECONDS: '900', CORS_ALLOWED_ORIGINS: 'http://localhost:5173' }, stdio: 'ignore' });
  const stopped = once(api, 'exit');
  const call = (path: string, method: string, token?: string, body?: object) => fetch(`http://127.0.0.1:${port}/api/v1/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const login = async (email: string): Promise<string> => { const response = await call('auth/login', 'POST', undefined, { email, password }); assert.equal(response.status, 200); return (await response.json() as { accessToken: string }).accessToken; };
  try {
    await db.authenticate(); let ready = false;
    for (let i = 0; i < 100; i++) { assert.equal(api.exitCode, null); try { if ((await call('health', 'GET')).ok) { ready = true; break; } } catch { /* Await startup. */ } await delay(100); } assert.ok(ready);
    const passwordHash = await hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await User.create({ name: 'Admin', email: emails[0]!, passwordHash, role: Role.ADMIN, status: UserStatus.ACTIVE });
    const member = await User.create({ name: 'Member', email: emails[1]!, passwordHash, status: UserStatus.ACTIVE });
    const adminToken = await login(emails[0]!); const memberToken = await login(emails[1]!);
    let primaryId = ''; let otherId = '';
    await t.test('creates normalized profiles and image references; protects writes', async () => {
      assert.equal((await call('artists', 'GET')).status, 401);
      assert.equal((await call('artists', 'POST', memberToken, { name: `Unauthorized ${suffix}` })).status, 403);
      const response = await call('artists', 'POST', adminToken, { name: ` Test   Artist ${suffix} `, biography: 'Biography', imageUrl: 'https://example.org/image.jpg', imagePublicId: 'artists/test' }); assert.equal(response.status, 201);
      const body = await response.json() as ArtistResponseDto; primaryId = body.id; artistIds.push(primaryId);
      assert.equal(body.name, `Test Artist ${suffix}`); assert.equal(body.albumCount, 0); assert.equal(body.songCount, 0); assert.equal(body.imagePublicId, 'artists/test');
      const other = await call('artists', 'POST', adminToken, { name: `Other ${suffix}` }); assert.equal(other.status, 201); otherId = (await other.json() as ArtistResponseDto).id; artistIds.push(otherId);
    });
    await t.test('rejects case/whitespace duplicates on create, update and concurrent requests', async () => {
      assert.equal((await call('artists', 'POST', adminToken, { name: ` TEST ARTIST ${suffix.toUpperCase()} ` })).status, 409);
      assert.equal((await call(`artists/${otherId}`, 'PATCH', adminToken, { name: `test artist ${suffix}` })).status, 409);
      const name = `Race ${suffix}`;
      const results = await Promise.all([call('artists', 'POST', adminToken, { name }), call('artists', 'POST', adminToken, { name: name.toUpperCase() })]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      for (const result of results) if (result.status === 201) artistIds.push((await result.json() as ArtistResponseDto).id);
    });
    await t.test('supports literal case-insensitive search and filtered pagination', async () => {
      const response = await call(`artists?search=${encodeURIComponent(`test artist ${suffix}`)}&page=1&limit=1`, 'GET', memberToken); assert.equal(response.status, 200);
      const page = await response.json() as { total: number; data: ArtistResponseDto[]; totalPages: number }; assert.equal(page.total, 1); assert.equal(page.totalPages, 1); assert.equal(page.data[0]?.id, primaryId);
      const percent = await call(`artists?search=${encodeURIComponent('%')}`, 'GET', memberToken); assert.equal(percent.status, 200);
      const wildcard = await percent.json() as { data: ArtistResponseDto[] }; assert.ok(wildcard.data.every((artist) => artist.name.includes('%')));
    });
    await t.test('patches and clears optional references without erasing omitted fields', async () => {
      const response = await call(`artists/${primaryId}`, 'PATCH', adminToken, { biography: null, imageUrl: null }); assert.equal(response.status, 200);
      const body = await response.json() as ArtistResponseDto; assert.equal(body.biography, null); assert.equal(body.imageUrl, null); assert.equal(body.imagePublicId, 'artists/test');
      assert.equal((await call(`artists/${primaryId}`, 'PATCH', adminToken, { name: null })).status, 400);
      assert.equal((await call(`artists/${primaryId}`, 'PATCH', adminToken, {})).status, 400);
      assert.equal((await call(`artists/${randomUUID()}`, 'GET', memberToken)).status, 404);
      assert.equal((await call(`artists/${randomUUID()}`, 'DELETE', adminToken)).status, 404);
    });
    await t.test('returns accurate counts and refuses deletion while albums or songs reference an artist', async () => {
      const album = await Album.create({ title: 'Test Album', artistId: primaryId });
      await Song.create({ title: 'Song 1', artistId: primaryId, albumId: album.id, uploadedById: member.id, audioPublicId: suffix, audioResourceType: 'video' });
      await Song.create({ title: 'Song 2', artistId: primaryId, uploadedById: member.id, audioPublicId: `${suffix}-2`, audioResourceType: 'video' });
      const response = await call(`artists/${primaryId}`, 'GET', memberToken); assert.equal(response.status, 200);
      const body = await response.json() as ArtistResponseDto; assert.equal(body.albumCount, 1); assert.equal(body.songCount, 2);
      assert.equal((await call(`artists/${primaryId}`, 'DELETE', adminToken)).status, 409);
      const onlyAlbum = await Album.create({ title: 'Album Only', artistId: otherId });
      assert.equal((await call(`artists/${otherId}`, 'DELETE', adminToken)).status, 409); await onlyAlbum.destroy();
      await Song.update({ albumId: null }, { where: { albumId: album.id } });
      await album.destroy(); assert.equal((await call(`artists/${primaryId}`, 'DELETE', adminToken)).status, 409);
      await Song.destroy({ where: { artistId: primaryId } });
      const deleted = await call(`artists/${primaryId}`, 'DELETE', adminToken); assert.equal(deleted.status, 204); assert.equal(await deleted.text(), '');
      assert.equal((await call(`artists/${primaryId}`, 'GET', memberToken)).status, 404);
    });
  } finally {
    if (api.exitCode === null) api.kill('SIGTERM'); const timer = setTimeout(() => api.kill('SIGKILL'), 5000); timer.unref(); await stopped; clearTimeout(timer);
    try {
      await Song.destroy({ where: { artistId: artistIds } }); await Album.destroy({ where: { artistId: artistIds } }); await Artist.destroy({ where: { id: artistIds } }); await User.destroy({ where: { email: emails } });
    } finally { await db.close(); }
  }
});
