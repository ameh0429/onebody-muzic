import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { hash } from 'argon2';
import { createDatabase } from '../src/database/connection';
import { Artist, Playlist, PlaylistPublicationStatus, PlaylistSong, PlaylistType, Rehearsal, Role, Song, User, UserStatus } from '../src/database/models';
import { RehearsalDetailResponseDto, RehearsalsPageDto } from '../src/rehearsals/dto/rehearsal-response.dto';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL database.');
test('Rehearsals API: permissions, UTC scheduling, visibility, pagination and songs', async (t) => {
  const db = createDatabase(url); const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const address = socket.address(); assert.ok(address && typeof address === 'object'); const port = address.port; await new Promise<void>((resolve) => socket.close(() => resolve()));
  const suffix = randomUUID(); const emails = ['admin', 'member'].map((name) => `rehearsal-${name}-${suffix}@example.org`); const password = randomBytes(24).toString('hex'); const rehearsalIds: string[] = []; const playlistIds: string[] = []; const songIds: string[] = []; let artistId = '';
  const server = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, DATABASE_URL: url, PORT: String(port), MEDIA_ENABLED: 'false', JWT_SECRET: randomBytes(48).toString('hex'), JWT_ACCESS_TOKEN_TTL_SECONDS: '900', CORS_ALLOWED_ORIGINS: 'http://localhost:5173' }, stdio: 'ignore' }); const stopped = once(server, 'exit');
  const call = (path: string, method = 'GET', token?: string, body?: object) => fetch(`http://127.0.0.1:${port}/api/v1/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    await db.authenticate(); let ready = false; for (let i = 0; i < 100; i++) { assert.equal(server.exitCode, null); try { if ((await call('health')).ok) { ready = true; break; } } catch { /* Starting. */ } await delay(100); } assert.ok(ready);
    const passwordHash = await hash(password); const users = await Promise.all(emails.map((email, i) => User.create({ email, name: 'Rehearsal tester', passwordHash, role: i === 0 ? Role.ADMIN : Role.MEMBER, status: UserStatus.ACTIVE })));
    const tokens = await Promise.all(emails.map(async (email) => { const response = await call('auth/login', 'POST', undefined, { email, password }); assert.equal(response.status, 200); return (await response.json() as { accessToken: string }).accessToken; })); const [admin, member] = tokens;
    const personal = await Playlist.create({ title: 'Personal', createdById: users[0]!.id, type: PlaylistType.PERSONAL });
    const draft = await Playlist.create({ title: 'Draft', createdById: users[0]!.id, type: PlaylistType.REHEARSAL });
    const published = await Playlist.create({ title: 'Published', createdById: users[0]!.id, type: PlaylistType.REHEARSAL, publicationStatus: PlaylistPublicationStatus.PUBLISHED }); playlistIds.push(personal.id, draft.id, published.id);
    const artist = await Artist.create({ name: `Rehearsal artist ${suffix}` }); artistId = artist.id;
    for (let i = 0; i < 2; i++) { const song = await Song.create({ title: `Song ${i}`, artistId, uploadedById: users[0]!.id, audioPublicId: `${suffix}-${i}`, audioResourceType: 'video' }); songIds.push(song.id); }
    await PlaylistSong.bulkCreate(songIds.map((songId, i) => ({ playlistId: published.id, songId, position: 1 - i })));
    const payload = { title: ' Sunday  practice ', scheduledAt: '2099-11-15T17:00:00+01:00', playlistId: published.id, description: 'Choir rehearsal' }; let upcomingId = ''; let draftId = ''; let pastId = '';
    const create = async (body: object) => { const response = await call('rehearsals', 'POST', admin, body); assert.equal(response.status, 201); const data = await response.json() as RehearsalDetailResponseDto; rehearsalIds.push(data.id); return data; };
    await t.test('requires authentication and administrator role for every mutation', async () => {
      for (const [path, method, body] of [['rehearsals', 'GET', undefined], [`rehearsals/${randomUUID()}`, 'GET', undefined], ['rehearsals', 'POST', payload], [`rehearsals/${randomUUID()}`, 'PATCH', { title: 'X' }], [`rehearsals/${randomUUID()}`, 'DELETE', undefined]] as const) assert.equal((await call(path, method, undefined, body)).status, 401);
      for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await call(method === 'POST' ? 'rehearsals' : `rehearsals/${randomUUID()}`, method, member, method === 'DELETE' ? undefined : payload)).status, 403);
    });
    await t.test('validates dates, timezone, DTOs, referenced playlist and UUIDs', async () => {
      for (const scheduledAt of ['2026-02-30T12:00:00Z', '2026-11-15', '2026-11-15T17:00:00', 'invalid', null]) assert.equal((await call('rehearsals', 'POST', admin, { ...payload, scheduledAt })).status, 400);
      for (const fields of [{ title: ' ' }, { playlistId: 'bad' }, { createdById: users[1]!.id }, { publicationStatus: 'PUBLISHED' }]) assert.equal((await call('rehearsals', 'POST', admin, { ...payload, ...fields })).status, 400);
      assert.equal((await call('rehearsals', 'POST', admin, { ...payload, playlistId: personal.id })).status, 400);
      assert.equal((await call('rehearsals', 'POST', admin, { ...payload, playlistId: randomUUID() })).status, 404);
      assert.equal((await call('rehearsals/not-a-uuid', 'GET', admin)).status, 400);
      for (const query of ['page=0', 'limit=101', 'period=future', 'extra=true']) assert.equal((await call(`rehearsals?${query}`, 'GET', member)).status, 400);
    });
    await t.test('stores UTC, returns ISO timestamps and ordered safe song metadata', async () => {
      const data = await create(payload); upcomingId = data.id; assert.equal(data.title, 'Sunday practice'); assert.equal(data.scheduledAt, '2099-11-15T16:00:00.000Z'); assert.equal(data.createdById, users[0]!.id);
      assert.deepEqual(data.playlist.songs.map((entry) => entry.songId), [...songIds].reverse()); assert.deepEqual(data.playlist.songs.map((entry) => entry.position), [0, 1]); assert.equal(JSON.stringify(data).includes('audioPublicId'), false);
      const stored = await Rehearsal.findByPk(data.id); assert.equal(stored?.scheduledAt.toISOString(), data.scheduledAt);
      pastId = (await create({ ...payload, scheduledAt: '2000-01-01T00:00:00Z' })).id;
      draftId = (await create({ ...payload, playlistId: draft.id })).id;
    });
    await t.test('filters publication before pagination and supports upcoming/past dates', async () => {
      const page = await call('rehearsals?period=upcoming&limit=1', 'GET', member); const data = await page.json() as RehearsalsPageDto; assert.equal(data.total, 1); assert.equal(data.data[0]?.id, upcomingId);
      const past = await call('rehearsals?period=past', 'GET', member); assert.ok((await past.json() as RehearsalsPageDto).data.some((row) => row.id === pastId));
      assert.equal((await call(`rehearsals/${draftId}`, 'GET', member)).status, 404); assert.equal((await call(`rehearsals/${draftId}`, 'GET', admin)).status, 200);
      await draft.update({ publicationStatus: PlaylistPublicationStatus.PUBLISHED }); assert.equal((await call(`rehearsals/${draftId}`, 'GET', member)).status, 200);
      await draft.update({ publicationStatus: PlaylistPublicationStatus.DRAFT }); assert.equal((await call(`rehearsals/${draftId}`, 'GET', member)).status, 404);
    });
    await t.test('updates metadata, time and playlist without permitting owner changes', async () => {
      assert.equal((await call(`rehearsals/${upcomingId}`, 'PATCH', admin, {})).status, 400);
      for (const field of ['title', 'scheduledAt', 'playlistId']) assert.equal((await call(`rehearsals/${upcomingId}`, 'PATCH', admin, { [field]: null })).status, 400);
      assert.equal((await call(`rehearsals/${upcomingId}`, 'PATCH', admin, { playlistId: personal.id })).status, 400);
      assert.equal((await call(`rehearsals/${upcomingId}`, 'PATCH', admin, { playlistId: randomUUID() })).status, 404);
      const response = await call(`rehearsals/${upcomingId}`, 'PATCH', admin, { description: null, scheduledAt: '2099-12-01T11:30:00-05:00', playlistId: draft.id }); assert.equal(response.status, 200); const data = await response.json() as RehearsalDetailResponseDto; assert.equal(data.description, null); assert.equal(data.scheduledAt, '2099-12-01T16:30:00.000Z'); assert.equal(data.createdById, users[0]!.id); assert.equal((await call(`rehearsals/${upcomingId}`, 'GET', member)).status, 404);
    });
    await t.test('documents all endpoints and preserves playlists/songs on deletion', async () => {
      const swagger = await fetch(`http://127.0.0.1:${port}/api/docs-json`); const document = await swagger.json() as { paths: Record<string, Record<string, { security?: object[] }>> };
      for (const [path, methods] of Object.entries({ '/api/v1/rehearsals': ['get', 'post'], '/api/v1/rehearsals/{id}': ['get', 'patch', 'delete'] })) for (const method of methods) assert.ok(document.paths[path]?.[method]?.security?.length);
      assert.equal((await call(`rehearsals/${upcomingId}`, 'DELETE', admin)).status, 204); assert.ok(await Playlist.findByPk(draft.id)); assert.equal(await Song.count({ where: { id: songIds } }), 2); assert.equal((await call(`rehearsals/${upcomingId}`, 'GET', admin)).status, 404);
      await users[1]!.update({ status: UserStatus.SUSPENDED }); assert.equal((await call('rehearsals', 'GET', member)).status, 401);
    });
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM'); const timer = setTimeout(() => server.kill('SIGKILL'), 5000); timer.unref(); await stopped; clearTimeout(timer);
    try { await Rehearsal.destroy({ where: { id: rehearsalIds } }); await Playlist.destroy({ where: { id: playlistIds } }); await Song.destroy({ where: { id: songIds } }); if (artistId) await Artist.destroy({ where: { id: artistId } }); await User.destroy({ where: { email: emails } }); } finally { await db.close(); }
  }
});
