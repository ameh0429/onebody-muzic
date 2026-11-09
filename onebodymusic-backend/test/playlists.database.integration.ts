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
import { Artist, Playlist, PlaylistSong, Rehearsal, Role, Song, User, UserStatus } from '../src/database/models';
import { PlaylistDetailResponseDto, PlaylistsPageDto } from '../src/playlists/dto/playlist-response.dto';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL database.');
test('Playlists API with real PostgreSQL permissions, transactions and ordering', async (t) => {
  const db = createDatabase(url); const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const address = socket.address(); assert.ok(address && typeof address === 'object'); const port = address.port; await new Promise<void>((resolve) => socket.close(() => resolve()));
  const suffix = randomUUID(); const emails = ['admin', 'member', 'other'].map((name) => `${name}-${suffix}@example.org`); const password = randomBytes(24).toString('hex');
  const server = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, DATABASE_URL: url, PORT: String(port), MEDIA_ENABLED: 'false', JWT_SECRET: randomBytes(48).toString('hex'), JWT_ACCESS_TOKEN_TTL_SECONDS: '900', CORS_ALLOWED_ORIGINS: 'http://localhost:5173' }, stdio: 'ignore' }); const stopped = once(server, 'exit');
  const call = (path: string, method = 'GET', token?: string, body?: object) => fetch(`http://127.0.0.1:${port}/api/v1/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ids: string[] = []; let artistId = ''; const songIds: string[] = []; let personal = ''; let rehearsal = '';
  try {
    await db.authenticate(); let ready = false; for (let i = 0; i < 100; i++) { assert.equal(server.exitCode, null); try { if ((await call('health')).ok) { ready = true; break; } } catch { /* Starting. */ } await delay(100); } assert.ok(ready);
    const passwordHash = await hash(password);
    const users = await Promise.all(emails.map((email, index) => User.create({ email, name: 'Playlist tester', passwordHash, role: index === 0 ? Role.ADMIN : Role.MEMBER, status: UserStatus.ACTIVE })));
    const tokens = await Promise.all(emails.map(async (email) => { const response = await call('auth/login', 'POST', undefined, { email, password }); assert.equal(response.status, 200); return (await response.json() as { accessToken: string }).accessToken; })); const [admin, member, other] = tokens;
    const artist = await Artist.create({ name: `Playlist artist ${suffix}` }); artistId = artist.id;
    for (let i = 0; i < 4; i++) { const song = await Song.create({ title: `Song ${i}`, artistId, uploadedById: users[0]!.id, audioPublicId: `${suffix}-${i}`, audioResourceType: 'video' }); songIds.push(song.id); }
    const create = async (token: string, body: object) => { const response = await call('playlists', 'POST', token, body); assert.equal(response.status, 201); const data = await response.json() as PlaylistDetailResponseDto; ids.push(data.id); return data; };
    await t.test('Swagger documents all playlist operations with bearer authorization', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/docs-json`); assert.equal(response.status, 200);
      const document = await response.json() as { paths: Record<string, Record<string, { security?: object[]; requestBody?: object }>> };
      for (const [path, methods] of Object.entries({ '/api/v1/playlists': ['get', 'post'], '/api/v1/playlists/{id}': ['get', 'patch', 'delete'], '/api/v1/playlists/{id}/songs': ['post'], '/api/v1/playlists/{id}/songs/reorder': ['patch'], '/api/v1/playlists/{id}/songs/{songId}': ['delete'] })) {
        for (const method of methods) { const operation = document.paths[path]?.[method]; assert.ok(operation); assert.ok(operation.security?.length); }
      }
    });
    await t.test('authentication, validation and creation permissions', async () => {
      for (const [path, method, body] of [['playlists', 'GET', undefined], ['playlists', 'POST', { title: 'X' }], [`playlists/${randomUUID()}`, 'PATCH', { title: 'X' }], [`playlists/${randomUUID()}`, 'DELETE', undefined], [`playlists/${randomUUID()}/songs`, 'POST', { songIds }], [`playlists/${randomUUID()}/songs/reorder`, 'PATCH', { songIds }], [`playlists/${randomUUID()}/songs/${songIds[0]}`, 'DELETE', undefined]] as const) assert.equal((await call(path, method, undefined, body)).status, 401);
      for (const query of ['page=0', 'limit=101', 'type=INVALID', 'publicationStatus=INVALID', 'extra=true']) assert.equal((await call(`playlists?${query}`, 'GET', member)).status, 400);
      assert.equal((await call('playlists', 'POST', member, { title: 'Rehearsal', type: 'REHEARSAL' })).status, 403);
      for (const body of [{ title: ' ' }, { title: 'X', createdById: users[0]!.id }, { title: 'X', type: 'INVALID' }, { title: 'X', publicationStatus: 'PUBLISHED' }]) assert.equal((await call('playlists', 'POST', member, body)).status, 400);
      personal = (await create(member!, { title: ' My  playlist ' })).id; rehearsal = (await create(admin!, { title: 'Sunday', type: 'REHEARSAL' })).id;
      const response = await call(`playlists/${personal}`, 'GET', member); const data = await response.json() as PlaylistDetailResponseDto; assert.equal(data.title, 'My playlist'); assert.equal(data.createdById, users[1]!.id); assert.deepEqual(data.songs, []);
    });
    await t.test('private ownership and published rehearsal visibility', async () => {
      for (const token of [other, admin]) for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await call(`playlists/${personal}`, method, token, method === 'PATCH' ? { title: 'Stolen' } : undefined)).status, 403);
      assert.equal((await call(`playlists/${rehearsal}`, 'GET', member)).status, 403);
      const before = await call('playlists?type=REHEARSAL', 'GET', member); assert.equal((await before.json() as PlaylistsPageDto).data.some((p) => p.id === rehearsal), false);
      assert.equal((await call(`playlists/${rehearsal}`, 'PATCH', admin, { publicationStatus: 'PUBLISHED' })).status, 200);
      assert.equal((await call(`playlists/${rehearsal}`, 'GET', member)).status, 200);
      for (const method of ['PATCH', 'DELETE']) assert.equal((await call(`playlists/${rehearsal}`, method, member, method === 'PATCH' ? { title: 'Changed' } : undefined)).status, 403);
      const page = await call('playlists?limit=1&type=PERSONAL', 'GET', member); const data = await page.json() as PlaylistsPageDto; assert.equal(data.total, 1); assert.equal(data.limit, 1); assert.equal(data.data[0]?.id, personal);
    });
    await t.test('validates all IDs and rejects duplicates without partial additions', async () => {
      assert.equal((await call(`playlists/${personal}/songs`, 'POST', other, { songIds: [songIds[0]] })).status, 403);
      assert.equal((await call(`playlists/${personal}/songs`, 'POST', member, { songIds: [songIds[0], randomUUID()] })).status, 404);
      assert.equal(await PlaylistSong.count({ where: { playlistId: personal } }), 0);
      for (const values of [[], ['bad'], [songIds[0], songIds[0]!.toUpperCase()]]) assert.equal((await call(`playlists/${personal}/songs`, 'POST', member, { songIds: values })).status, 400);
      const added = await call(`playlists/${personal}/songs`, 'POST', member, { songIds: songIds.slice(0, 3) }); assert.equal(added.status, 201); const data = await added.json() as PlaylistDetailResponseDto; assert.equal(data.songCount, 3); assert.deepEqual(data.songs.map((entry) => entry.position), [0, 1, 2]); assert.equal(JSON.stringify(data).includes('audioPublicId'), false);
      assert.equal((await call(`playlists/${personal}/songs`, 'POST', member, { songIds: [songIds[0]] })).status, 409);
    });
    await t.test('swaps unique positions atomically and preserves entry identity', async () => {
      const before = await PlaylistSong.findAll({ where: { playlistId: personal }, order: [['position', 'ASC']] });
      const order = [songIds[2]!, songIds[0]!, songIds[1]!]; const response = await call(`playlists/${personal}/songs/reorder`, 'PATCH', member, { songIds: order }); assert.equal(response.status, 200); const data = await response.json() as PlaylistDetailResponseDto; assert.deepEqual(data.songs.map((entry) => entry.songId), order); assert.deepEqual(data.songs.map((entry) => entry.position), [0, 1, 2]);
      const after = await PlaylistSong.findAll({ where: { playlistId: personal } }); for (const entry of before) { const same = after.find((item) => item.id === entry.id); assert.ok(same); assert.equal(same.createdAt.toISOString(), entry.createdAt.toISOString()); }
      assert.equal((await call(`playlists/${personal}/songs/reorder`, 'PATCH', member, { songIds: [songIds[0]] })).status, 409);
      assert.equal((await call(`playlists/${personal}/songs/reorder`, 'PATCH', other, { songIds: order })).status, 403);
      const removed = await call(`playlists/${personal}/songs/${songIds[0]}`, 'DELETE', member); assert.equal(removed.status, 200); assert.deepEqual((await removed.json() as PlaylistDetailResponseDto).songs.map((entry) => entry.position), [0, 1]); assert.ok(await Song.findByPk(songIds[0]));
    });
    await t.test('concurrent duplicate appends serialize without broken ordering', async () => {
      const responses = await Promise.all([call(`playlists/${personal}/songs`, 'POST', member, { songIds: [songIds[3]] }), call(`playlists/${personal}/songs`, 'POST', member, { songIds: [songIds[3]] })]); assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      const entries = await PlaylistSong.findAll({ where: { playlistId: personal }, order: [['position', 'ASC']] }); assert.deepEqual(entries.map((entry) => entry.position), [0, 1, 2]);
    });
    await t.test('rehearsal references block deletion; personal deletion preserves songs', async () => {
      const event = await Rehearsal.create({ title: 'Service', scheduledAt: new Date(), playlistId: rehearsal, createdById: users[0]!.id });
      try { assert.equal((await call(`playlists/${rehearsal}`, 'DELETE', admin)).status, 409); } finally { await event.destroy(); }
      assert.equal((await call(`playlists/${personal}`, 'DELETE', member)).status, 204); assert.equal(await PlaylistSong.count({ where: { playlistId: personal } }), 0); assert.equal(await Song.count({ where: { id: songIds } }), 4);
      await users[1]!.update({ status: UserStatus.SUSPENDED }); assert.equal((await call('playlists', 'GET', member)).status, 401);
    });
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM'); const timer = setTimeout(() => server.kill('SIGKILL'), 5000); timer.unref(); await stopped; clearTimeout(timer);
    try { await Playlist.destroy({ where: { id: ids } }); await Song.destroy({ where: { id: songIds } }); if (artistId) await Artist.destroy({ where: { id: artistId } }); await User.destroy({ where: { email: emails } }); } finally { await db.close(); }
  }
});
