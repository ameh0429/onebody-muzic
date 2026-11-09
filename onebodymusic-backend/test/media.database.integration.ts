import { CloudinaryOperationError } from '../src/media/errors/media-operation.error';
import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { INestApplication, Type } from '@nestjs/common';
import { hash, argon2id } from 'argon2';
import { createDatabase } from '../src/database/connection';
import { Artist, MediaAsset, MediaKind, MediaStatus, Role, User, UserStatus } from '../src/database/models';
import type { CloudinaryClient as CloudinaryClientType } from '../src/media/cloudinary.client';
import type { MediaService as MediaServiceType } from '../src/media/media.service';
import type { MediaCleanupWorker as WorkerType } from '../src/media/media-cleanup.worker';
import { MediaResponseDto } from '../src/media/dto/media-response.dto';
import { PNG, mp3 } from './fixtures/media';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL database.');
const compiled = createRequire(__filename);

test('media tracking, real multipart/auth/database, provider failures, and reconciliation', async (t) => {
  const db = createDatabase(url); const email = `media-admin-${randomUUID()}@example.org`;
  const suffix = randomUUID(); const password = randomBytes(24).toString('hex');
  const remote = new Set<string>(); let timeoutUpload = false; let destroyCalls = 0; let failUpload = false; let failDestroy = false; let failPersistence = false; let failDeletionPersistence = false;
  let destroyGate: Promise<void> | undefined; let destroyEntered = false;
  const provider = {
    configured: () => true,
    upload: async (buffer: Buffer, asset: MediaAsset) => {
      remote.add(asset.publicId);
      if (timeoutUpload) { const ErrorType = (compiled('../dist/media/errors/media-operation.error') as { CloudinaryOperationError: typeof CloudinaryOperationError }).CloudinaryOperationError; throw new ErrorType('TIMEOUT'); }
      if (failUpload) throw new Error('Simulated provider failure');
      return { bytes: buffer.length, format: asset.format, duration: asset.kind === MediaKind.AUDIO ? 3 : null, width: asset.kind === MediaKind.IMAGE ? 1 : null, height: asset.kind === MediaKind.IMAGE ? 1 : null };
    },
    destroy: async (asset: MediaAsset) => { destroyCalls++; if (destroyGate) { destroyEntered = true; await destroyGate; } if (failDestroy) throw new Error('Simulated provider deletion failure'); remote.delete(asset.publicId); },
    imageUrl: (asset: MediaAsset) => asset.kind === MediaKind.IMAGE ? `https://res.cloudinary.com/media-test/image/upload/${asset.publicId}.${asset.format}` : null,
  };
  let app: INestApplication | undefined; let ownerId = ''; let base = ''; let token = '';
  let media: MediaServiceType | undefined;
  let compiledAssets: typeof MediaAsset | undefined;
  const artistIds: string[] = [];
  async function upload(kind: 'images' | 'audio', folder = 'artists'): Promise<Response> {
    const body = new FormData(); if (kind === 'images') body.append('folder', folder);
    body.append('file', new Blob([Uint8Array.from(kind === 'images' ? PNG : mp3())], { type: kind === 'images' ? 'image/png' : 'audio/mpeg' }), kind === 'images' ? 'cover.png' : 'song.mp3');
    return fetch(`${base}/media/${kind}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
  }
  const remove = (id: string) => fetch(`${base}/media/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  const createArtist = (name: string, asset: MediaResponseDto) => fetch(`${base}/artists`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, imageUrl: asset.url, imagePublicId: asset.publicId }) });
  async function age(id: string): Promise<void> {
    await db.query('UPDATE "MediaAsset" SET "createdAt"=:past, "updatedAt"=:past WHERE id=:id', { replacements: { id, past: new Date(Date.now() - 172800000) } });
  }
  try {
    await db.authenticate();
    const admin = await User.create({ name: 'Media Admin', email, passwordHash: await hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }), role: Role.ADMIN, status: UserStatus.ACTIVE }); ownerId = admin.id;
    Object.assign(process.env, { DATABASE_URL: url, MEDIA_ENABLED: 'true', CLOUDINARY_CLOUD_NAME: 'media-test', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret', JWT_SECRET: randomBytes(48).toString('hex'), JWT_ACCESS_TOKEN_TTL_SECONDS: '900', CORS_ALLOWED_ORIGINS: 'http://localhost:5173', MEDIA_AUDIO_MAX_BYTES: '4096', MEDIA_IMAGE_MAX_BYTES: '1024' });
    const { AppModule } = compiled('../dist/app.module') as { AppModule: Type<unknown> };
    const { CloudinaryClient } = compiled('../dist/media/cloudinary.client') as { CloudinaryClient: Type<CloudinaryClientType> };
    const { MediaCleanupWorker } = compiled('../dist/media/media-cleanup.worker') as { MediaCleanupWorker: Type<WorkerType> };
    const { MediaService } = compiled('../dist/media/media.service') as { MediaService: Type<MediaServiceType> };
    const { configureApp } = compiled('../dist/configure-app') as { configureApp: (app: INestApplication) => void };
    compiledAssets = (compiled('../dist/database/models') as { MediaAsset: typeof MediaAsset }).MediaAsset;
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CloudinaryClient).useValue(provider).overrideProvider(MediaCleanupWorker).useValue({}).compile();
    app = module.createNestApplication(); app.useLogger(false); configureApp(app); await app.listen(0, '127.0.0.1'); base = `${await app.getUrl()}/api/v1`; media = app.get(MediaService);
    compiledAssets.addHook('beforeUpdate', 'test-media-finalization', (asset) => { if (failPersistence && asset.getDataValue('status') === MediaStatus.READY) throw new Error('Simulated database finalization failure'); if (failDeletionPersistence && asset.getDataValue('status') === MediaStatus.DELETED) throw new Error('Simulated deletion finalization failure'); });
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); assert.equal(login.status, 200); token = (await login.json() as { accessToken: string }).accessToken;
    await t.test('tracks authenticated audio and safe public-image metadata', async () => {
      const audio = await upload('audio'); assert.equal(audio.status, 201); const body = await audio.json() as MediaResponseDto;
      assert.equal(body.deliveryType, 'authenticated'); assert.equal(body.resourceType, 'video'); assert.equal(body.url, null);
      const record = await MediaAsset.findByPk(body.id, { rejectOnEmpty: true }); assert.equal(record.uploadedById, ownerId); assert.equal(record.status, MediaStatus.READY); assert.ok(remote.has(body.publicId));
      assert.equal((await remove(body.id)).status, 204); assert.equal((await remove(body.id)).status, 204); assert.equal(remote.has(body.publicId), false);
    });
    await t.test('returns a safe timeout without blocking on deletion, then reconciles durable cleanup', async () => {
      const before = new Set((await MediaAsset.findAll({ where: { uploadedById: ownerId } })).map((asset) => asset.id));
      const deletions = destroyCalls; timeoutUpload = true;
      const response = await upload('audio'); timeoutUpload = false;
      assert.equal(response.status, 504); const body = await response.json() as { message: string }; assert.ok(body.message.includes('Cloudinary did not respond'));
      assert.equal(destroyCalls, deletions);
      const asset = (await MediaAsset.findAll({ where: { uploadedById: ownerId } })).find((item) => !before.has(item.id)); assert.ok(asset); assert.equal(asset.status, MediaStatus.CLEANUP_PENDING); assert.ok(remote.has(asset.publicId));
      await age(asset.id); await media!.reconcile(900); await asset.reload(); assert.equal(asset.status, MediaStatus.DELETED); assert.equal(remote.has(asset.publicId), false);
    });
    await t.test('protects referenced images, rejects wrong-folder attachments, and rejects deleted references', async () => {
      const image = await upload('images'); assert.equal(image.status, 201); const asset = await image.json() as MediaResponseDto;
      const artist = await createArtist(`Managed media ${suffix}`, asset); assert.equal(artist.status, 201); const artistId = (await artist.json() as { id: string }).id; artistIds.push(artistId);
      assert.equal((await remove(asset.id)).status, 409); assert.ok(remote.has(asset.publicId));
      const wrong = await fetch(`${base}/albums`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Wrong folder ${suffix}`, artistId, releaseYear: 2024, coverImagePublicId: asset.publicId }) }); assert.equal(wrong.status, 409);
      await Artist.update({ imagePublicId: null, imageUrl: null }, { where: { id: artistId } }); assert.equal((await remove(asset.id)).status, 204);
      assert.equal((await createArtist(`Deleted media ${suffix}`, asset)).status, 409);
    });
    await t.test('compensates failed uploads and database finalization without losing the reservation', async () => {
      failUpload = true; failDestroy = true; assert.equal((await upload('images')).status, 502); failUpload = false; failDestroy = false;
      const pending = await MediaAsset.findOne({ where: { uploadedById: ownerId, status: MediaStatus.CLEANUP_PENDING }, rejectOnEmpty: true }); assert.ok(remote.has(pending.publicId));
      await age(pending.id); await media!.reconcile(900); await pending.reload(); assert.equal(pending.status, MediaStatus.DELETED); assert.equal(remote.has(pending.publicId), false);
      failPersistence = true; const failed = await upload('images'); assert.equal(failed.status, 503); failPersistence = false;
      const after = await MediaAsset.findOne({ where: { uploadedById: ownerId, status: MediaStatus.CLEANUP_PENDING }, rejectOnEmpty: true }); assert.equal(remote.has(after.publicId), false);
      await age(after.id); await media!.reconcile(900); await after.reload(); assert.equal(after.status, MediaStatus.DELETED);
    });
    await t.test('persists deletion intent before removing remote bytes, even if the final database write fails', async () => {
      const response = await upload('images'); assert.equal(response.status, 201); const asset = await response.json() as MediaResponseDto;
      failDeletionPersistence = true; assert.equal((await remove(asset.id)).status, 503); failDeletionPersistence = false;
      assert.equal(remote.has(asset.publicId), false);
      assert.equal((await MediaAsset.findByPk(asset.id))?.status, MediaStatus.CLEANUP_PENDING);
      await age(asset.id); await media!.reconcile(900); assert.equal((await MediaAsset.findByPk(asset.id))?.status, MediaStatus.DELETED);
    });
    await t.test('recovers stale uploads and expires unattached READY assets after 24h', async () => {
      const image = await upload('images'); assert.equal(image.status, 201); const asset = await image.json() as MediaResponseDto;
      await age(asset.id); await media!.reconcile(900); assert.equal((await MediaAsset.findByPk(asset.id))?.status, MediaStatus.DELETED); assert.equal(remote.has(asset.publicId), false);
      const id = randomUUID(); const key = `onebodymusic/audio/${id}`;
      await MediaAsset.create({ id, publicId: key, folder: 'onebodymusic/audio', kind: MediaKind.AUDIO, resourceType: 'video', deliveryType: 'authenticated', format: 'mp3', mimeType: 'audio/mpeg', bytes: 1, duration: null, width: null, height: null, uploadedById: ownerId }); remote.add(key);
      await age(id); await media!.reconcile(900); assert.equal((await MediaAsset.findByPk(id))?.status, MediaStatus.DELETED); assert.equal(remote.has(key), false);
    });
    await t.test('serializes deletion against new attachments so deleted media cannot be linked', async () => {
      const response = await upload('images'); assert.equal(response.status, 201); const asset = await response.json() as MediaResponseDto;
      let release: () => void = () => undefined; destroyGate = new Promise<void>((resolve) => { release = resolve; }); destroyEntered = false;
      const deletion = remove(asset.id);
      try {
        for (let i = 0; i < 100 && !destroyEntered; i++) await delay(10); assert.equal(destroyEntered, true);
        const attachment = createArtist(`Racing media ${suffix}`, asset);
        await delay(30); release();
        assert.equal((await deletion).status, 204); assert.equal((await attachment).status, 409);
      } finally { release(); destroyGate = undefined; }
    });
  } finally {
    failPersistence = false; failDeletionPersistence = false; failDestroy = false; failUpload = false;
    compiledAssets?.removeHook('beforeUpdate', 'test-media-finalization');
    if (app) await app.close();
    try {
      await Artist.destroy({ where: { id: artistIds } });
      if (ownerId) {
        const rows = await MediaAsset.findAll({ where: { uploadedById: ownerId } });
        for (const asset of rows) { remote.delete(asset.publicId); if (asset.status !== MediaStatus.DELETED) { if (asset.status !== MediaStatus.CLEANUP_PENDING) await asset.update({ status: MediaStatus.CLEANUP_PENDING }); await asset.update({ status: MediaStatus.DELETED }); } }
        await MediaAsset.destroy({ where: { uploadedById: ownerId } }); await User.destroy({ where: { id: ownerId } });
      }
    } finally { await db.close(); }
  }
});
