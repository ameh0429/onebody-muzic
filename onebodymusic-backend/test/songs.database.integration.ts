import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash, argon2id } from 'argon2';
import { createDatabase } from '../src/database/connection';
import { Album, Artist, MediaAsset, MediaKind, MediaStatus, Playlist, PlaylistSong, Role, Song, User, UserStatus } from '../src/database/models';
import type { CloudinaryClient as ClientType } from '../src/media/cloudinary.client';
import type { CloudinaryAudioGateway as GatewayType } from '../src/media/cloudinary-audio.gateway';
import type { MediaCleanupWorker as WorkerType } from '../src/media/media-cleanup.worker';
import { SongResponseDto, SongsPageDto } from '../src/songs/dto/song-response.dto';
import { PlaybackResponseDto } from '../src/songs/dto/playback.dto';
import { MediaResponseDto } from '../src/media/dto/media-response.dto';
import { mp3, PNG } from './fixtures/media';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL database.');
const compiled = createRequire(__filename);

test('Songs API with tracked media ownership, transactional cleanup, and range playback', async (t) => {
  const db = createDatabase(url); const suffix = randomUUID(); const password = randomBytes(24).toString('hex');
  const emails = [`song-admin-a-${suffix}@example.org`, `song-admin-b-${suffix}@example.org`, `song-member-${suffix}@example.org`];
  const artistIds: string[] = []; const albumIds: string[] = []; const userIds: string[] = []; const playlistIds: string[] = [];
  const remote = new Map<string, Buffer>(); let app: INestApplication | undefined; let base = ''; let origin = ''; let streamCalls = 0;
  const provider = {
    configured: () => true,
    upload: async (buffer: Buffer, asset: MediaAsset) => { remote.set(asset.publicId, buffer); return { bytes: buffer.length, format: asset.format, duration: asset.kind === MediaKind.AUDIO ? 240.25 : null, width: asset.kind === MediaKind.IMAGE ? 1 : null, height: asset.kind === MediaKind.IMAGE ? 1 : null }; },
    destroy: async (asset: MediaAsset) => { remote.delete(asset.publicId); },
    imageUrl: (asset: MediaAsset) => asset.kind === MediaKind.IMAGE ? `https://res.cloudinary.com/test/image/upload/${asset.publicId}.${asset.format}` : null,
  };
  const gateway = {
    open: async (asset: MediaAsset, range: string | undefined, head: boolean) => {
      streamCalls++; const data = remote.get(asset.publicId); assert.ok(data);
      let start = 0; let end = data.length - 1;
      if (range) { const [left, right] = range.slice(6).split('-'); if (!left) start = Math.max(0, data.length - Number(right)); else { start = Number(left); if (right) end = Math.min(Number(right), end); } }
      return { stream: Readable.from(head ? [] : [data.subarray(start, end + 1)]), status: range ? 206 : 200, contentLength: String(end - start + 1), contentRange: range ? `bytes ${start}-${end}/${data.length}` : undefined, contentType: asset.mimeType, acceptRanges: 'bytes' };
    },
  };
  const call = (path: string, method: string, token?: string, body?: object) => fetch(`${base}/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  async function login(email: string): Promise<string> { const response = await call('auth/login', 'POST', undefined, { email, password }); assert.equal(response.status, 200); return (await response.json() as { accessToken: string }).accessToken; }
  async function audio(token: string): Promise<MediaResponseDto> {
    const body = new FormData(); body.append('file', new Blob([Uint8Array.from(mp3())], { type: 'audio/mpeg' }), 'song.mp3');
    const response = await fetch(`${base}/media/audio`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }); assert.equal(response.status, 201); return response.json() as Promise<MediaResponseDto>;
  }
  try {
    await db.authenticate();
    const passwordHash = await hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const a = await User.create({ name: 'Admin A', email: emails[0]!, passwordHash, role: Role.ADMIN, status: UserStatus.ACTIVE });
    const b = await User.create({ name: 'Admin B', email: emails[1]!, passwordHash, role: Role.ADMIN, status: UserStatus.ACTIVE });
    const member = await User.create({ name: 'Member', email: emails[2]!, passwordHash, status: UserStatus.ACTIVE }); userIds.push(a.id, b.id, member.id);
    Object.assign(process.env, { DATABASE_URL: url, MEDIA_ENABLED: 'true', CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret', JWT_SECRET: randomBytes(48).toString('hex'), JWT_ACCESS_TOKEN_TTL_SECONDS: '900', MEDIA_PLAYBACK_TTL_SECONDS: '60', CORS_ALLOWED_ORIGINS: 'http://localhost:5173' });
    const { AppModule } = compiled('../dist/app.module') as { AppModule: Type<unknown> };
    const { CloudinaryClient } = compiled('../dist/media/cloudinary.client') as { CloudinaryClient: Type<ClientType> };
    const { CloudinaryAudioGateway } = compiled('../dist/media/cloudinary-audio.gateway') as { CloudinaryAudioGateway: Type<GatewayType> };
    const { MediaCleanupWorker } = compiled('../dist/media/media-cleanup.worker') as { MediaCleanupWorker: Type<WorkerType> };
    const { configureApp } = compiled('../dist/configure-app') as { configureApp: (app: INestApplication) => void };
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CloudinaryClient).useValue(provider).overrideProvider(CloudinaryAudioGateway).useValue(gateway).overrideProvider(MediaCleanupWorker).useValue({}).compile();
    app = module.createNestApplication(); app.useLogger(false); configureApp(app); await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); base = `${origin}/api/v1`;
    const adminToken = await login(a.email); const otherAdminToken = await login(b.email); const memberToken = await login(member.email);
    const artist = await Artist.create({ name: `Song Artist ${suffix}` }); const otherArtist = await Artist.create({ name: `Other Song Artist ${suffix}` }); artistIds.push(artist.id, otherArtist.id);
    const album = await Album.create({ title: 'Praise', artistId: artist.id, releaseYear: 2024 }); const otherAlbum = await Album.create({ title: 'Other', artistId: otherArtist.id, releaseYear: 2024 }); albumIds.push(album.id, otherAlbum.id);
    const upload = await audio(adminToken); const otherUpload = await audio(otherAdminToken);
    const input = { title: `Amazing ${suffix}`, artistId: artist.id, albumId: album.id, category: 'Worship', audioAssetId: upload.id }; let primaryId = '';
    await t.test('rejects invalid artist/album and unauthorized media reuse; creates owned READY audio', async () => {
      assert.equal((await call('songs', 'POST', memberToken, input)).status, 403);
      assert.equal((await call('songs', 'POST', adminToken, { ...input, artistId: randomUUID(), albumId: null })).status, 404);
      assert.equal((await call('songs', 'POST', adminToken, { ...input, albumId: randomUUID() })).status, 404);
      assert.equal((await call('songs', 'POST', adminToken, { ...input, albumId: otherAlbum.id })).status, 400);
      assert.equal((await call('songs', 'POST', adminToken, { ...input, audioAssetId: otherUpload.id })).status, 403);
      const response = await call('songs', 'POST', adminToken, input); assert.equal(response.status, 201); const song = await response.json() as SongResponseDto; primaryId = song.id;
      assert.equal(song.durationSeconds, 241); assert.equal(song.artist.name, artist.name); assert.equal(song.album?.id, album.id); assert.equal(JSON.stringify(song).includes('audioPublicId'), false);
      assert.equal((await MediaAsset.findByPk(upload.id))?.status, MediaStatus.READY);
      assert.equal((await call(`media/${upload.id}`, 'DELETE', adminToken)).status, 409);
      assert.equal((await call('songs', 'POST', adminToken, input)).status, 409);
    });
    await t.test('serializes concurrent reuse and supports title/category/artist/album filters and sorting', async () => {
      const race = await audio(adminToken); const body = { ...input, title: `Race ${suffix}`, audioAssetId: race.id };
      const responses = await Promise.all([call('songs', 'POST', adminToken, body), call('songs', 'POST', adminToken, body)]); assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      const response = await call(`songs?artistId=${artist.id}&albumId=${album.id}&category=Worship&search=${encodeURIComponent(`Amazing ${suffix}`)}&page=1&limit=1&sortBy=title&sortOrder=ASC`, 'GET', memberToken); assert.equal(response.status, 200);
      const page = await response.json() as SongsPageDto; assert.equal(page.total, 1); assert.equal(page.totalPages, 1); assert.equal(page.data[0]?.id, primaryId);
    });
    let ticketUrl = '';
    await t.test('issues scoped expiring URLs and streams full/range/HEAD without exposing provider URLs', async () => {
      const redirect = await fetch(`${base}/songs/${primaryId}/stream`, { redirect: 'manual', headers: { Authorization: `Bearer ${memberToken}` } }); assert.equal(redirect.status, 302); assert.match(redirect.headers.get('location') ?? '', /\?ticket=/);
      const response = await call(`songs/${primaryId}/stream?redirect=false`, 'GET', memberToken); assert.equal(response.status, 200); const playback = await response.json() as PlaybackResponseDto;
      assert.equal(playback.expiresIn, 60); assert.ok(Date.parse(playback.expiresAt) - Date.now() <= 60000); assert.equal(playback.url.includes('cloudinary'), false); ticketUrl = new URL(playback.url, origin).toString();
      const full = await fetch(ticketUrl); assert.equal(full.status, 200); assert.deepEqual(Buffer.from(await full.arrayBuffer()), mp3());
      const ranged = await fetch(ticketUrl, { headers: { Range: 'bytes=1-31' } }); assert.equal(ranged.status, 206); assert.equal(ranged.headers.get('content-range'), `bytes 1-31/${mp3().length}`); assert.equal(ranged.headers.get('accept-ranges'), 'bytes'); assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), mp3().subarray(1, 32));
      const head = await fetch(ticketUrl, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(mp3().length)); assert.equal(await head.text(), '');
      assert.equal((await fetch(ticketUrl, { headers: { Range: 'bytes=999999-' } })).status, 416);
      assert.equal((await fetch(ticketUrl, { headers: { Range: 'bytes=0-1,3-4' } })).status, 400);
    });
    await t.test('rechecks current status for every playback request and prevents ticket reuse on other songs', async () => {
      assert.equal((await call(`songs/${primaryId}/stream`, 'GET')).status, 401);
      const wrongSong = new URL(ticketUrl); wrongSong.pathname = `/api/v1/songs/${randomUUID()}/stream`; assert.equal((await fetch(wrongSong)).status, 403);
      const before = streamCalls; await member.update({ status: UserStatus.SUSPENDED }); assert.equal((await fetch(ticketUrl, { headers: { Range: 'bytes=1-31' } })).status, 401); assert.equal(streamCalls, before); await member.update({ status: UserStatus.ACTIVE });
    });
    await t.test('replaces media and atomically schedules old files for cleanup', async () => {
      const replacement = await audio(adminToken);
      const response = await call(`songs/${primaryId}`, 'PATCH', adminToken, { audioAssetId: replacement.id, category: null }); assert.equal(response.status, 200);
      assert.equal((await MediaAsset.findByPk(upload.id))?.status, MediaStatus.CLEANUP_PENDING); assert.equal((await MediaAsset.findByPk(replacement.id))?.status, MediaStatus.READY);
    });
    await t.test('protects playlist references, then deletes the song and queues its now-unused audio', async () => {
      const song = await Song.findByPk(primaryId, { rejectOnEmpty: true }); const playlist = await Playlist.create({ title: 'Rehearsal', createdById: member.id }); playlistIds.push(playlist.id);
      await PlaylistSong.create({ playlistId: playlist.id, songId: primaryId, position: 0 }); assert.equal((await call(`songs/${primaryId}`, 'DELETE', adminToken)).status, 409);
      await PlaylistSong.destroy({ where: { playlistId: playlist.id } }); assert.equal((await call(`songs/${primaryId}`, 'DELETE', adminToken)).status, 204);
      assert.equal((await MediaAsset.findByPk(song.audioAssetId!))?.status, MediaStatus.CLEANUP_PENDING); assert.equal((await fetch(ticketUrl)).status, 404);
    });
  } finally {
    if (app) await app.close();
    try {
      await PlaylistSong.destroy({ where: { playlistId: playlistIds } }); await Playlist.destroy({ where: { id: playlistIds } });
      await Song.destroy({ where: { artistId: artistIds } }); await Album.destroy({ where: { id: albumIds } }); await Artist.destroy({ where: { id: artistIds } });
      const assets = await MediaAsset.findAll({ where: { uploadedById: userIds } });
      for (const asset of assets) { remote.delete(asset.publicId); if (asset.status !== MediaStatus.DELETED) { if (asset.status !== MediaStatus.CLEANUP_PENDING) await asset.update({ status: MediaStatus.CLEANUP_PENDING }); await asset.update({ status: MediaStatus.DELETED }); } }
      await MediaAsset.destroy({ where: { uploadedById: userIds } }); await User.destroy({ where: { id: userIds } });
    } finally { await db.close(); }
  }
});
