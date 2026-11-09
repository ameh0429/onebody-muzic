import { AuthRateLimitStore } from '../src/auth/rate-limit/auth-rate-limit.store';
import { RehearsalsService } from '../src/rehearsals/rehearsals.service';
import { PlaylistsService } from '../src/playlists/playlists.service';
import { SongsService } from '../src/songs/songs.service';
import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { Transaction } from 'sequelize';
import { DatabaseModule } from '../src/database/database.module';
import { AuthRepository } from '../src/auth/auth.repository';
import { Role, User, UserStatus, MediaAsset, MediaStatus } from '../src/database/models';
import { UsersService } from '../src/users/users.service';
import { ArtistsService } from '../src/artists/artists.service';
import { AlbumsService } from '../src/albums/albums.service';
import { MediaRepository } from '../src/media/media.repository';
import { CloudinaryClient } from '../src/media/cloudinary.client';
import { MediaCleanupWorker } from '../src/media/media-cleanup.worker';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants';
import { configureApp } from '../src/configure-app';
import { m4a, mp3, PNG, JPEG, WEBP } from './fixtures/media';

@Module({})
class TestDatabaseModule {}

describe('Admin multipart media uploads', () => {
  let app: INestApplication; let jwt: JwtService;
  const adminId = randomUUID(); const memberId = randomUUID(); const records = new Map<string, User>(); const assets = new Map<string, MediaAsset>();
  const provider = { configured: jest.fn(), upload: jest.fn(), destroy: jest.fn(), imageUrl: jest.fn() };
  const repository = {
    reserve: jest.fn(async (values: object) => {
      const asset = { ...values, status: MediaStatus.UPLOADING, createdAt: new Date(), updatedAt: new Date(), update: async (change: object) => Object.assign(asset, change) } as MediaAsset;
      assets.set(asset.id, asset); return asset;
    }),
    locked: jest.fn(async (id: string, work: (asset: MediaAsset, t: Transaction) => Promise<unknown>) => { const asset = assets.get(id); return asset ? work(asset, {} as Transaction) : null; }),
    referenced: jest.fn(async () => false), candidates: jest.fn(async () => []),
  };
  const bearer = (id: string) => `Bearer ${jwt.sign({ sub: id })}`;
  beforeAll(async () => {
    Object.assign(process.env, { JWT_SECRET: randomBytes(48).toString('hex'), CORS_ALLOWED_ORIGINS: 'http://localhost:5173', DATABASE_URL: 'postgresql://localhost/test', MEDIA_ENABLED: 'true', CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret', MEDIA_AUDIO_MAX_BYTES: '4096', MEDIA_IMAGE_MAX_BYTES: '1024', MEDIA_MAX_CONCURRENT_UPLOADS: '2' });
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideModule(DatabaseModule).useModule(TestDatabaseModule)
      .overrideProvider(AuthRateLimitStore).useValue({ consume: async () => ({ hits: 1, retryAfter: 60 }) }).overrideProvider(AuthRepository).useValue({ findById: async (id: string) => records.get(id) ?? null })
      .overrideProvider(SongsService).useValue({}).overrideProvider(RehearsalsService).useValue({}).overrideProvider(PlaylistsService).useValue({}).overrideProvider(UsersService).useValue({}).overrideProvider(ArtistsService).useValue({}).overrideProvider(AlbumsService).useValue({})
      .overrideProvider(MediaRepository).useValue(repository).overrideProvider(CloudinaryClient).useValue(provider).overrideProvider(MediaCleanupWorker).useValue({}).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
    jwt = new JwtService({ secret: process.env.JWT_SECRET, signOptions: { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256', expiresIn: 900 } });
  });
  beforeEach(() => {
    jest.clearAllMocks(); records.clear(); assets.clear();
    for (const [id, role] of [[adminId, Role.ADMIN], [memberId, Role.MEMBER]] as const) records.set(id, { id, role, status: UserStatus.ACTIVE, name: 'Grace', email: 'grace@example.org', createdAt: new Date(), updatedAt: new Date() } as User);
    provider.configured.mockReturnValue(true); provider.destroy.mockResolvedValue(undefined); provider.imageUrl.mockImplementation((asset: MediaAsset) => asset.resourceType === 'image' ? 'https://res.cloudinary.com/test/image/upload/cover.png' : null);
    provider.upload.mockImplementation(async (buffer: Buffer, asset: MediaAsset) => ({ bytes: buffer.length, format: asset.format, width: asset.resourceType === 'image' ? 1 : null, height: asset.resourceType === 'image' ? 1 : null, duration: asset.resourceType === 'video' ? 2 : null }));
  });
  afterAll(async () => { await app?.close(); });
  it('rejects unauthorized and member uploads/deletions before parsing files', async () => {
    for (const path of ['audio', 'images']) {
      await request(app.getHttpServer()).post(`/api/v1/media/${path}`).attach('file', PNG, 'cover.png').expect(401);
      await request(app.getHttpServer()).post(`/api/v1/media/${path}`).set('Authorization', bearer(memberId)).attach('file', PNG, 'cover.png').expect(403);
    }
    await request(app.getHttpServer()).delete(`/api/v1/media/${randomUUID()}`).expect(401);
    await request(app.getHttpServer()).delete(`/api/v1/media/${randomUUID()}`).set('Authorization', bearer(memberId)).expect(403);
    expect(provider.upload).not.toHaveBeenCalled();
  });
  it.each([[PNG, 'cover.png', 'image/png'], [JPEG, 'cover.jpeg', 'image/jpeg'], [WEBP, 'cover.webp', 'image/webp']] as const)('accepts supported image formats %s', async (buffer, filename, contentType) => {
    const response = await request(app.getHttpServer()).post('/api/v1/media/images').set('Authorization', bearer(adminId)).field('folder', 'artists').attach('file', buffer, { filename, contentType }).expect(201);
    expect(response.body as object).toMatchObject({ folder: 'onebodymusic/artists', status: 'READY', resourceType: 'image', deliveryType: 'upload' });
  });
  it.each([[mp3(), 'song.mp3', 'audio/mpeg'], [m4a(), 'song.m4a', 'audio/mp4']] as const)('accepts supported audio signatures and exposes no delivery URL %s', async (buffer, filename, contentType) => {
    const response = await request(app.getHttpServer()).post('/api/v1/media/audio').set('Authorization', bearer(adminId)).attach('file', buffer, { filename, contentType }).expect(201);
    expect(response.body as object).toMatchObject({ deliveryType: 'authenticated', resourceType: 'video', url: null }); expect(JSON.stringify(response.body)).not.toContain('secret');
  });
  it('rejects mismatched signatures and unsupported MIME types without starting uploads', async () => {
    await request(app.getHttpServer()).post('/api/v1/media/audio').set('Authorization', bearer(adminId)).attach('file', PNG, { filename: 'song.mp3', contentType: 'audio/mpeg' }).expect(415);
    await request(app.getHttpServer()).post('/api/v1/media/images').set('Authorization', bearer(adminId)).field('folder', 'artists').attach('file', Buffer.from('bad'), { filename: 'cover.png', contentType: 'image/png' }).expect(415);
    await request(app.getHttpServer()).post('/api/v1/media/images').set('Authorization', bearer(adminId)).field('folder', 'artists').attach('file', PNG, { filename: 'cover.gif', contentType: 'image/gif' }).expect(415);
    expect(repository.reserve).not.toHaveBeenCalled();
  });
  it('rejects oversized files, missing files, and invalid destination fields', async () => {
    await request(app.getHttpServer()).post('/api/v1/media/audio').set('Authorization', bearer(adminId)).attach('file', Buffer.alloc(4097), { filename: 'song.mp3', contentType: 'audio/mpeg' }).expect(413);
    await request(app.getHttpServer()).post('/api/v1/media/audio').set('Authorization', bearer(adminId)).expect(400);
    await request(app.getHttpServer()).post('/api/v1/media/images').set('Authorization', bearer(adminId)).field('folder', '../audio').attach('file', PNG, 'cover.png').expect(400);
    await request(app.getHttpServer()).post('/api/v1/media/images').set('Authorization', bearer(adminId)).attach('file', PNG, 'cover.png').expect(400);
  });
  it('rejects extra fields and multiple files', async () => {
    await request(app.getHttpServer()).post('/api/v1/media/audio').set('Authorization', bearer(adminId)).field('publicId', 'attacker').attach('file', mp3(), { filename: 'song.mp3', contentType: 'audio/mpeg' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/media/images').set('Authorization', bearer(adminId)).field('folder', 'artists').attach('file', PNG, 'a.png').attach('file', PNG, 'b.png').expect(400);
  });
  it('schedules cleanup after provider failures and deletes by internal UUID only', async () => {
    provider.upload.mockRejectedValueOnce(new Error('private-provider-secret'));
    const failed = await request(app.getHttpServer()).post('/api/v1/media/images').set('Authorization', bearer(adminId)).field('folder', 'albums').attach('file', PNG, 'cover.png').expect(502);
    expect(JSON.stringify(failed.body)).not.toContain('private-provider-secret'); expect(provider.destroy).toHaveBeenCalled();
    const success = await request(app.getHttpServer()).post('/api/v1/media/images').set('Authorization', bearer(adminId)).field('folder', 'songs').attach('file', PNG, 'cover.png').expect(201);
    const id = (success.body as { id: string }).id;
    await request(app.getHttpServer()).delete(`/api/v1/media/${id}`).set('Authorization', bearer(adminId)).expect(204);
    await request(app.getHttpServer()).delete(`/api/v1/media/${id}`).set('Authorization', bearer(adminId)).expect(204);
    await request(app.getHttpServer()).delete('/api/v1/media/not-a-uuid').set('Authorization', bearer(adminId)).expect(400);
    await request(app.getHttpServer()).delete(`/api/v1/media/${randomUUID()}`).set('Authorization', bearer(adminId)).expect(404);
  });
  it('bounds concurrent in-memory uploads and releases slots afterward', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    provider.upload.mockImplementation(async (buffer: Buffer, asset: MediaAsset) => { await gate; return { bytes: buffer.length, format: asset.format, width: 1, height: 1, duration: null }; });
    const send = () => request(app.getHttpServer()).post('/api/v1/media/images').set('Authorization', bearer(adminId)).field('folder', 'artists').attach('file', PNG, 'cover.png');
    const requests = [send().then((response) => response), send().then((response) => response)];
    try {
      for (let i = 0; i < 100 && provider.upload.mock.calls.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(provider.upload).toHaveBeenCalledTimes(2);
      await send().expect(429);
    } finally { release(); }
    for (const response of await Promise.all(requests)) expect(response.status).toBe(201);
    await send().expect(201);
  });

  it('documents real file inputs and bearer authentication', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const doc = response.body as { paths: Record<string, { post?: { requestBody: { content: Record<string, { schema: { properties: { file: { format: string } } } }> }; security: unknown } }> };
    for (const path of ['/api/v1/media/audio', '/api/v1/media/images']) {
      expect(doc.paths[path]?.post?.requestBody.content['multipart/form-data']?.schema.properties.file.format).toBe('binary'); expect(doc.paths[path]?.post?.security).toEqual([{ bearer: [] }]);
    }
  });
});
