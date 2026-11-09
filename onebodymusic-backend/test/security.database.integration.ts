import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { Test } from '@nestjs/testing';
import { INestApplication, Type } from '@nestjs/common';
import { hash } from 'argon2';
import { createDatabase } from '../src/database/connection';
import { Album, Artist, MediaAsset, MediaKind, Playlist, Rehearsal, Role, Song, User, UserStatus, MediaStatus } from '../src/database/models';
import { AuthRateLimitStore } from '../src/auth/rate-limit/auth-rate-limit.store';
import { mp3 } from './fixtures/media';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL database.');
const compiled = createRequire(__filename);
interface RecordResponse { id: string; title?: string; status?: string; role?: string; scheduledAt?: string; playlist?: { songs: { songId: string; position: number }[] }; songs?: { songId: string; position: number }[] }

test('complete church library workflow and shared authentication rate limiting', async (t) => {
  const db = createDatabase(url); const suffix = randomUUID(); const emails = ['admin', 'member', 'other'].map((name) => `audit-${name}-${suffix}@example.org`); const password = randomBytes(24).toString('hex'); const secret = randomBytes(48).toString('hex');
  let app: INestApplication | undefined; let base = ''; let admin = ''; let member = ''; let memberId = ''; let artistId = ''; let albumId = ''; let playlistId = ''; let rehearsalId = ''; const songIds: string[] = []; let other = '';
  const loginKey = createHmac('sha256', secret).update('login:127.0.0.1').digest('hex');
  const registerKey = createHmac('sha256', secret).update('register:127.0.0.1').digest('hex');
  const call = (path: string, method = 'GET', token?: string, body?: object) => fetch(`${base}/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const record = async (response: Response, status: number): Promise<RecordResponse> => { const text = await response.text(); assert.equal(response.status, status, text); assert.equal(text.includes('passwordHash'), false); return JSON.parse(text) as RecordResponse; };
  const login = async (email: string) => { const response = await call('auth/login', 'POST', undefined, { email, password }); assert.equal(response.status, 200); return (await response.json() as { accessToken: string }).accessToken; };
  const audio = mp3();
  try {
    await db.authenticate(); await User.create({ name: 'Audit admin', email: emails[0]!, passwordHash: await hash(password), role: Role.ADMIN, status: UserStatus.ACTIVE });
    Object.assign(process.env, { DATABASE_URL: url, NODE_ENV: 'test', MEDIA_ENABLED: 'true', CLOUDINARY_CLOUD_NAME: 'audit-test', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret', JWT_SECRET: secret, JWT_ACCESS_TOKEN_TTL_SECONDS: '900', CORS_ALLOWED_ORIGINS: 'http://localhost:5173', AUTH_LOGIN_MAX_ATTEMPTS: '10', AUTH_REGISTER_MAX_ATTEMPTS: '5', AUTH_RATE_LIMIT_WINDOW_SECONDS: '60' });
    const { AppModule } = compiled('../dist/app.module') as { AppModule: Type<unknown> };
    const { CloudinaryClient } = compiled('../dist/media/cloudinary.client') as { CloudinaryClient: Type<unknown> };
    const { CloudinaryAudioGateway } = compiled('../dist/media/cloudinary-audio.gateway') as { CloudinaryAudioGateway: Type<unknown> };
    const { MediaCleanupWorker } = compiled('../dist/media/media-cleanup.worker') as { MediaCleanupWorker: Type<unknown> };
    const { configureApp } = compiled('../dist/configure-app') as { configureApp: (application: INestApplication) => void };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CloudinaryClient).useValue({ configured: () => true, upload: async (buffer: Buffer, asset: MediaAsset) => ({ bytes: buffer.length, format: asset.format, duration: 3, width: null, height: null }), destroy: async () => undefined, imageUrl: () => null })
      .overrideProvider(CloudinaryAudioGateway).useValue({ open: async (_asset: MediaAsset, range?: string) => ({ stream: Readable.from([range ? audio.subarray(0, 10) : audio]), status: range ? 206 : 200, contentType: 'audio/mpeg', contentLength: String(range ? 10 : audio.length), contentRange: range ? `bytes 0-9/${audio.length}` : undefined, acceptRanges: 'bytes' }) })
      .overrideProvider(MediaCleanupWorker).useValue({}).compile();
    app = module.createNestApplication(); app.useLogger(false); configureApp(app); await app.listen(0, '127.0.0.1'); base = `${await app.getUrl()}/api/v1`;
    await t.test('registration → pending rejection → admin approval → active login with no escalation', async () => {
      const registration = { name: 'Audit member', email: emails[1]!, password, confirmPassword: password };
      assert.equal((await call('auth/register', 'POST', undefined, { ...registration, role: 'ADMIN', status: 'ACTIVE' })).status, 400);
      const created = await record(await call('auth/register', 'POST', undefined, registration), 201); memberId = created.id; assert.equal(created.status, 'PENDING'); assert.equal(created.role, 'MEMBER');
      await record(await call('auth/register', 'POST', undefined, { ...registration, email: emails[2] }), 201);
      assert.equal((await call('auth/login', 'POST', undefined, { email: emails[1], password })).status, 401);
      admin = await login(emails[0]!);
      await record(await call(`users/${memberId}/status`, 'PATCH', admin, { status: 'ACTIVE' }), 200);
      const second = await User.findOne({ where: { email: emails[2] } }); assert.ok(second); await record(await call(`users/${second.id}/status`, 'PATCH', admin, { status: 'ACTIVE' }), 200);
      member = await login(emails[1]!); other = await login(emails[2]!);
      await record(await call('auth/me', 'GET', member), 200);
      assert.equal((await call(`users/${memberId}/role`, 'PATCH', member, { role: 'ADMIN' })).status, 403);
      assert.equal((await call('users/me', 'PATCH', member, { name: 'X', role: 'ADMIN' })).status, 400);
    });
    await t.test('artist + album + multipart audio + songs CRUD, permissions and safe responses', async () => {
      artistId = (await record(await call('artists', 'POST', admin, { name: `Audit choir ${suffix}` }), 201)).id;
      albumId = (await record(await call('albums', 'POST', admin, { title: `Audit album ${suffix}`, artistId, releaseYear: 2026 }), 201)).id;
      assert.equal((await call('artists', 'POST', member, { name: 'Forbidden' })).status, 403);
      for (let i = 0; i < 2; i++) {
        const form = new FormData(); form.append('file', new Blob([Uint8Array.from(audio)], { type: 'audio/mpeg' }), 'practice.mp3');
        assert.equal((await fetch(`${base}/media/audio`, { method: 'POST', headers: { Authorization: `Bearer ${member}` }, body: form })).status, 403);
        const asset = await record(await fetch(`${base}/media/audio`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: form }), 201);
        const song = await record(await call('songs', 'POST', admin, { title: `Audit song ${i}`, artistId, albumId, audioAssetId: asset.id, lyrics: 'Verse\nChorus' }), 201); songIds.push(song.id);
      }
      for (const resource of [`artists/${artistId}`, `albums/${albumId}`, `songs/${songIds[0]}`]) {
        await record(await call(resource, 'GET', member), 200); assert.equal((await call(resource, 'PATCH', member, { title: 'Unauthorized' })).status, 403); assert.equal((await call(resource, 'DELETE', member)).status, 403);
      }
      await record(await call(`artists/${artistId}`, 'PATCH', admin, { biography: 'Church choir' }), 200);
      await record(await call(`albums/${albumId}`, 'PATCH', admin, { releaseYear: 2025 }), 200);
      await record(await call(`songs/${songIds[0]}`, 'PATCH', admin, { title: 'Updated title' }), 200);
      assert.equal((await call(`albums/${albumId}`, 'DELETE', admin)).status, 409);
    });
    await t.test('personal ownership, atomic ordering and published rehearsal visibility', async () => {
      playlistId = (await record(await call('playlists', 'POST', member, { title: 'Private practice' }), 201)).id;
      assert.equal((await call(`playlists/${playlistId}`, 'GET', other)).status, 403);
      await record(await call(`playlists/${playlistId}/songs`, 'POST', member, { songIds }), 201);
      assert.equal((await call(`playlists/${playlistId}/songs`, 'POST', member, { songIds: [songIds[0]] })).status, 409);
      const reordered = await record(await call(`playlists/${playlistId}/songs/reorder`, 'PATCH', member, { songIds: [...songIds].reverse() }), 200); assert.deepEqual(reordered.songs?.map((entry) => entry.songId), [...songIds].reverse());
      const rehearsalPlaylist = await record(await call('playlists', 'POST', admin, { title: 'Sunday rehearsal', type: 'REHEARSAL' }), 201);
      await record(await call(`playlists/${rehearsalPlaylist.id}/songs`, 'POST', admin, { songIds }), 201);
      const event = await record(await call('rehearsals', 'POST', admin, { title: 'Practice', playlistId: rehearsalPlaylist.id, scheduledAt: '2099-12-01T17:00:00+01:00' }), 201); rehearsalId = event.id;
      assert.equal((await call(`rehearsals/${event.id}`, 'GET', member)).status, 404);
      await record(await call(`playlists/${rehearsalPlaylist.id}`, 'PATCH', admin, { publicationStatus: 'PUBLISHED' }), 200);
      const visible = await record(await call(`rehearsals/${event.id}`, 'GET', member), 200); assert.deepEqual(visible.playlist?.songs.map((entry) => entry.songId), songIds);
    });
    await t.test('malformed UUIDs, pagination boundaries and literal query filtering', async () => {
      for (const resource of ['users', 'artists', 'albums', 'songs', 'playlists', 'rehearsals']) {
        assert.equal((await call(`${resource}/not-a-uuid`, 'GET', admin)).status, 400);
        for (const query of ['page=0', 'limit=0', 'limit=101', 'page=1.5', 'page=1&page=2']) assert.equal((await call(`${resource}?${query}`, 'GET', admin)).status, 400);
        assert.equal((await call(`${resource}?page=1000000&limit=100`, 'GET', admin)).status, 200);
      }
      const search = await call(`artists?search=${encodeURIComponent("%' OR 1=1; --")}`, 'GET', member); assert.equal(search.status, 200); assert.equal((await search.json() as { total: number }).total, 0);
      assert.equal((await call('songs?sortBy=title;DROP%20TABLE', 'GET', member)).status, 400);
    });
    await t.test('audio tickets require an active user, expire/scoping protections remain separate from access JWTs', async () => {
      assert.equal((await call(`songs/${songIds[0]}/stream`)).status, 401);
      const response = await call(`songs/${songIds[0]}/stream?redirect=false`, 'GET', member); assert.equal(response.status, 200); const ticket = await response.json() as { url: string };
      const range = await fetch(`${base.replace('/api/v1', '')}${ticket.url}`, { headers: { Range: 'bytes=0-9' } }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 10); assert.equal(range.headers.get('cache-control')?.includes('no-store'), true);
      assert.equal((await fetch(`${base.replace('/api/v1', '')}${ticket.url.replace(songIds[0]!, songIds[1]!)}`)).status, 403);
      await record(await call(`users/${memberId}/status`, 'PATCH', admin, { status: 'SUSPENDED' }), 200);
      assert.equal((await fetch(`${base.replace('/api/v1', '')}${ticket.url}`)).status, 401); assert.equal((await call('auth/me', 'GET', member)).status, 401);
    });
    await t.test('real HTTP limiter counts invalid DTOs, resists header spoofing and resets expired windows', async () => {
      await db.query('DELETE FROM "AuthRateLimit" WHERE "key"=:key', { replacements: { key: loginKey } });
      const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${i}` }, body: JSON.stringify({ email: 'invalid', password: 'x' }) })));
      assert.deepEqual(responses.map((r) => r.status).sort(), [...Array<number>(10).fill(400), 429, 429]);
      for (const response of responses.filter((r) => r.status === 429)) { assert.ok(Number(response.headers.get('retry-after')) > 0); const body = await response.json() as { message: string; statusCode: number }; assert.equal(body.statusCode, 429); assert.equal(body.message.includes(password), false); }
      await db.query('UPDATE "AuthRateLimit" SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE "key"=:key', { replacements: { key: loginKey } });
      assert.equal((await call('auth/login', 'POST', undefined, { email: 'invalid' })).status, 400);
    });
    await t.test('separate store instances share an atomic counter and clean up expired entries', async () => {
      const key = randomBytes(32).toString('hex'); const first = new AuthRateLimitStore(db); const second = new AuthRateLimitStore(db);
      try { const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).consume(key, 60, 5))); assert.equal(results.filter((r) => r.hits <= 5).length, 5); assert.ok(results.every((r) => r.hits <= 6)); }
      finally { await db.query('DELETE FROM "AuthRateLimit" WHERE "key"=:key', { replacements: { key } }); }
    });
    await t.test('deletes through the API without cascading library/media unexpectedly', async () => {
      await record(await call(`users/${memberId}/status`, 'PATCH', admin, { status: 'ACTIVE' }), 200);
      assert.equal((await call(`rehearsals/${rehearsalId}`, 'DELETE', admin)).status, 204);
      const owned = await Playlist.findAll({ where: { createdById: [memberId, (await User.findOne({ where: { email: emails[0] } }))!.id] } });
      for (const playlist of owned) assert.equal((await call(`playlists/${playlist.id}`, 'DELETE', playlist.id === playlistId ? member : admin)).status, 204);
      for (const songId of songIds) assert.equal((await call(`songs/${songId}`, 'DELETE', admin)).status, 204);
      assert.equal((await call(`albums/${albumId}`, 'DELETE', admin)).status, 204); assert.equal((await call(`artists/${artistId}`, 'DELETE', admin)).status, 204);
    });
  } finally {
    await app?.close();
    try {
      const owners = await User.findAll({ where: { email: emails }, attributes: ['id'] }); const ownerIds = owners.map((u) => u.id);
      await Rehearsal.destroy({ where: { createdById: ownerIds } }); await Playlist.destroy({ where: { createdById: ownerIds } }); await Song.destroy({ where: { uploadedById: ownerIds } }); if (albumId) await Album.destroy({ where: { id: albumId } }); if (artistId) await Artist.destroy({ where: { id: artistId } }); // Provider is an in-memory fake. Confirm its cleanup before removing durable tombstones.
      for (const asset of await MediaAsset.findAll({ where: { uploadedById: ownerIds } })) {
        if (asset.status !== MediaStatus.DELETED) { if (asset.status !== MediaStatus.CLEANUP_PENDING) await asset.update({ status: MediaStatus.CLEANUP_PENDING }); await asset.update({ status: MediaStatus.DELETED }); }
      }
      await MediaAsset.destroy({ where: { uploadedById: ownerIds } }); await User.destroy({ where: { id: ownerIds } });
      await db.query('DELETE FROM "AuthRateLimit" WHERE "key" IN (:keys)', { replacements: { keys: [loginKey, registerKey] } });
    } finally { await db.close(); }
  }
});
