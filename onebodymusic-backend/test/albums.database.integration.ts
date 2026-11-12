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
import { ForeignKeyConstraintError } from 'sequelize';
import { createDatabase } from '../src/database/connection';
import { Album, Artist, Role, Song, User, UserStatus } from '../src/database/models';
import { AlbumDetailResponseDto, AlbumsPageDto } from '../src/albums/dto/album-response.dto';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL database.');
async function unusedPort(): Promise<number> {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); return address.port;
}

test('compiled Albums API with PostgreSQL constraints and song associations', async (t) => {
  const db = createDatabase(url); const port = await unusedPort(); const suffix = randomUUID();
  const emails = [`album-admin-${suffix}@example.org`, `album-member-${suffix}@example.org`];
  const password = randomBytes(24).toString('hex'); const artistIds: string[] = []; const albumIds: string[] = [];
  const server = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, DATABASE_URL: url, PORT: String(port), JWT_SECRET: randomBytes(48).toString('hex'), JWT_ACCESS_TOKEN_TTL_SECONDS: '900', CORS_ALLOWED_ORIGINS: 'http://localhost:5173' }, stdio: 'ignore' }); const stopped = once(server, 'exit');
  const call = (path: string, method: string, token?: string, body?: object) => fetch(`http://127.0.0.1:${port}/api/v1/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const login = async (email: string): Promise<string> => { const response = await call('auth/login', 'POST', undefined, { email, password }); assert.equal(response.status, 200); return (await response.json() as { accessToken: string }).accessToken; };
  try {
    await db.authenticate(); let ready = false;
    for (let i = 0; i < 100; i++) { assert.equal(server.exitCode, null); try { if ((await call('health', 'GET')).ok) { ready = true; break; } } catch { /* Await startup. */ } await delay(100); } assert.ok(ready);
    const passwordHash = await hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await User.create({ name: 'Admin', email: emails[0]!, passwordHash, role: Role.ADMIN, status: UserStatus.ACTIVE });
    const member = await User.create({ name: 'Member', email: emails[1]!, passwordHash, status: UserStatus.ACTIVE });
    const adminToken = await login(emails[0]!); const memberToken = await login(emails[1]!);
    const a = await Artist.create({ name: `Album Artist A ${suffix}` }); const b = await Artist.create({ name: `Album Artist B ${suffix}` }); artistIds.push(a.id, b.id);
    const payload = { title: ` Praise  ${suffix} `, artistId: a.id, releaseYear: 2024, coverImageUrl: 'https://example.org/cover.jpg', coverImagePublicId: 'albums/test' }; let primaryId = '';
    await t.test('validates existing artists and authorizes album creation', async () => {
      assert.equal((await call('albums', 'GET')).status, 401);
      assert.equal((await call('albums', 'POST', memberToken, payload)).status, 403);
      assert.equal((await call('albums', 'POST', adminToken, { ...payload, artistId: randomUUID() })).status, 404);
      const response = await call('albums', 'POST', adminToken, payload); assert.equal(response.status, 201);
      const body = await response.json() as AlbumDetailResponseDto; primaryId = body.id; albumIds.push(primaryId);
      assert.equal(body.title, `Praise ${suffix}`); assert.equal(body.artist.id, a.id); assert.equal(body.releaseYear, 2024); assert.deepEqual(body.songs, []);
    });
    await t.test('enforces normalized per-artist uniqueness including concurrent requests', async () => {
      assert.equal((await call('albums', 'POST', adminToken, { ...payload, title: payload.title.toUpperCase() })).status, 409);
      const other = await call('albums', 'POST', adminToken, { ...payload, artistId: b.id }); assert.equal(other.status, 201); const otherId = (await other.json() as AlbumDetailResponseDto).id; albumIds.push(otherId);
      assert.equal((await call(`albums/${otherId}`, 'PATCH', adminToken, { artistId: a.id })).status, 409);
      const race = { ...payload, title: `Race ${suffix}` };
      const responses = await Promise.all([call('albums', 'POST', adminToken, race), call('albums', 'POST', adminToken, { ...race, title: race.title.toUpperCase() })]); assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      for (const response of responses) if (response.status === 201) albumIds.push((await response.json() as AlbumDetailResponseDto).id);
    });
    await t.test('combines artist/year/search filters with pagination and literal matching', async () => {
      const response = await call(`albums?artistId=${a.id}&releaseYear=2024&search=${encodeURIComponent(`praise ${suffix}`)}&limit=1`, 'GET', memberToken); assert.equal(response.status, 200);
      const page = await response.json() as AlbumsPageDto; assert.equal(page.total, 1); assert.equal(page.data[0]?.id, primaryId); assert.equal(page.data[0]?.artist.name, a.name);
      const percent = await call(`albums?artistId=${a.id}&search=${encodeURIComponent('%')}`, 'GET', memberToken); assert.equal((await percent.json() as AlbumsPageDto).total, 0);
    });
    await t.test('patches artwork and rejects missing replacement artists or empty updates', async () => {
      const response = await call(`albums/${primaryId}`, 'PATCH', adminToken, { coverImageUrl: null }); assert.equal(response.status, 200);
      const body = await response.json() as AlbumDetailResponseDto; assert.equal(body.coverImageUrl, null); assert.equal(body.coverImagePublicId, 'albums/test'); assert.equal(body.releaseYear, 2024);
      assert.equal((await call(`albums/${primaryId}`, 'PATCH', adminToken, { artistId: randomUUID() })).status, 404);
      assert.equal((await call(`albums/${primaryId}`, 'PATCH', adminToken, {})).status, 400);
      assert.equal((await call(`albums/${randomUUID()}`, 'GET', memberToken)).status, 404);
    });
    await t.test('includes songs, blocks artist reassignment and prevents populated deletion at API and database levels', async () => {
      const song = await Song.create({ title: 'Amazing Grace', artistId: a.id, albumId: primaryId, uploadedById: member.id, category: 'Worship', durationSeconds: 240, coverImageUrl: 'https://artwork.example.test/song.png', audioPublicId: suffix, audioResourceType: 'video' });
      const response = await call(`albums/${primaryId}`, 'GET', memberToken); assert.equal(response.status, 200);
      const body = await response.json() as AlbumDetailResponseDto; assert.equal(body.songCount, 1); assert.equal(body.songs[0]?.id, song.id); assert.equal(body.songs[0]?.title, 'Amazing Grace'); assert.equal(body.songs[0]?.coverImageUrl, 'https://artwork.example.test/song.png');
      await song.update({ coverImageUrl: null });
      const withoutArt = await call(`albums/${primaryId}`, 'GET', memberToken);
      assert.equal((await withoutArt.json() as AlbumDetailResponseDto).songs[0]?.coverImageUrl, null); assert.equal(JSON.stringify(body).includes('audioPublicId'), false);
      assert.equal((await call(`albums/${primaryId}`, 'PATCH', adminToken, { artistId: b.id })).status, 409);
      assert.equal((await call(`albums/${primaryId}`, 'DELETE', adminToken)).status, 409);
      await assert.rejects(Album.destroy({ where: { id: primaryId } }), ForeignKeyConstraintError);
      await song.reload(); assert.equal(song.albumId, primaryId);
      await song.update({ albumId: null });
      const deleted = await call(`albums/${primaryId}`, 'DELETE', adminToken); assert.equal(deleted.status, 204); assert.equal(await deleted.text(), '');
      assert.equal((await call(`albums/${primaryId}`, 'GET', memberToken)).status, 404); assert.ok(await Song.findByPk(song.id));
    });
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM'); const timer = setTimeout(() => server.kill('SIGKILL'), 5000); timer.unref(); await stopped; clearTimeout(timer);
    try { await Song.destroy({ where: { artistId: artistIds } }); await Album.destroy({ where: { id: albumIds } }); await Artist.destroy({ where: { id: artistIds } }); await User.destroy({ where: { email: emails } }); } finally { await db.close(); }
  }
});
