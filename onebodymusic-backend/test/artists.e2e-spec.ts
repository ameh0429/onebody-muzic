import { RehearsalsService } from '../src/rehearsals/rehearsals.service';
import { PlaylistsService } from '../src/playlists/playlists.service';
import { SongsService } from '../src/songs/songs.service';
import { MediaModule } from '../src/media/media.module';
import { AlbumsService } from '../src/albums/albums.service';
import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { DatabaseModule } from '../src/database/database.module';
import { AuthRepository } from '../src/auth/auth.repository';
import { Role, User, UserStatus } from '../src/database/models';
import { UsersService } from '../src/users/users.service';
import { ArtistsService } from '../src/artists/artists.service';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants';
import { configureApp } from '../src/configure-app';

@Module({})
class TestDatabaseModule {}

describe('Artist routes, authorization and validation', () => {
  let app: INestApplication; let jwt: JwtService;
  const adminId = randomUUID(); const memberId = randomUUID(); const artistId = randomUUID();
  const records = new Map<string, User>();
  const artists = { create: jest.fn(), list: jest.fn(), findOne: jest.fn(), update: jest.fn(), remove: jest.fn() };
  const bearer = (id: string) => `Bearer ${jwt.sign({ sub: id })}`;
  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('hex'); process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
    process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173'; process.env.DATABASE_URL = 'postgresql://localhost/test';
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideModule(MediaModule).useModule(TestDatabaseModule).overrideModule(DatabaseModule).useModule(TestDatabaseModule)
      .overrideProvider(AuthRepository).useValue({ findById: async (id: string) => records.get(id) ?? null })
      .overrideProvider(SongsService).useValue({}).overrideProvider(RehearsalsService).useValue({}).overrideProvider(PlaylistsService).useValue({}).overrideProvider(UsersService).useValue({}).overrideProvider(AlbumsService).useValue({}).overrideProvider(ArtistsService).useValue(artists).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
    jwt = new JwtService({ secret: process.env.JWT_SECRET, signOptions: { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 900 } });
  });
  beforeEach(() => {
    jest.clearAllMocks(); records.clear();
    for (const [id, role] of [[adminId, Role.ADMIN], [memberId, Role.MEMBER]] as const) records.set(id, { id, role, status: UserStatus.ACTIVE, name: 'Grace', email: 'grace@example.org', createdAt: new Date(), updatedAt: new Date() } as User);
    artists.create.mockResolvedValue({ id: artistId }); artists.findOne.mockResolvedValue({ id: artistId }); artists.list.mockResolvedValue({ data: [], total: 0 }); artists.update.mockResolvedValue({ id: artistId }); artists.remove.mockResolvedValue(undefined);
  });
  afterAll(async () => { await app?.close(); });
  it('requires authentication for every endpoint', async () => {
    await request(app.getHttpServer()).get('/api/v1/artists').expect(401);
    await request(app.getHttpServer()).get(`/api/v1/artists/${artistId}`).expect(401);
    await request(app.getHttpServer()).post('/api/v1/artists').send({ name: 'Artist' }).expect(401);
    await request(app.getHttpServer()).patch(`/api/v1/artists/${artistId}`).send({ name: 'Artist' }).expect(401);
    await request(app.getHttpServer()).delete(`/api/v1/artists/${artistId}`).expect(401);
  });
  it('allows member reads and forbids member writes', async () => {
    await request(app.getHttpServer()).get('/api/v1/artists').set('Authorization', bearer(memberId)).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/artists/${artistId}`).set('Authorization', bearer(memberId)).expect(200);
    await request(app.getHttpServer()).post('/api/v1/artists').set('Authorization', bearer(memberId)).send({ name: 'Artist' }).expect(403);
    await request(app.getHttpServer()).patch(`/api/v1/artists/${artistId}`).set('Authorization', bearer(memberId)).send({ name: 'Artist' }).expect(403);
    await request(app.getHttpServer()).delete(`/api/v1/artists/${artistId}`).set('Authorization', bearer(memberId)).expect(403);
  });
  it('allows administrator writes and normalizes names', async () => {
    await request(app.getHttpServer()).post('/api/v1/artists').set('Authorization', bearer(adminId)).send({ name: ' Hillsong   Worship ', biography: 'Music', imageUrl: 'https://example.org/image.jpg', imagePublicId: 'artists/image' }).expect(201);
    expect(artists.create).toHaveBeenCalledWith({ name: 'Hillsong Worship', biography: 'Music', imageUrl: 'https://example.org/image.jpg', imagePublicId: 'artists/image' });
    await request(app.getHttpServer()).patch(`/api/v1/artists/${artistId}`).set('Authorization', bearer(adminId)).send({ biography: null, imageUrl: null }).expect(200);
    await request(app.getHttpServer()).delete(`/api/v1/artists/${artistId}`).set('Authorization', bearer(adminId)).expect(204).expect('');
  });
  it.each([{ name: '' }, { name: ' ' }, { name: null }, { name: 42 }, { name: 'x'.repeat(201) }, { name: 'Valid', extra: true }, { name: 'Valid', biography: 123 }, { name: 'Valid', imageUrl: 'javascript:alert(1)' }, { name: 'Valid', imageUrl: 'http://example.org/a.jpg' }, { name: 'Valid', imagePublicId: '' }])('rejects invalid creation %j', async (body) => {
    await request(app.getHttpServer()).post('/api/v1/artists').set('Authorization', bearer(adminId)).send(body).expect(400);
  });
  it('rejects null names in updates while allowing null optional fields', async () => {
    await request(app.getHttpServer()).patch(`/api/v1/artists/${artistId}`).set('Authorization', bearer(adminId)).send({ name: null }).expect(400);
    await request(app.getHttpServer()).patch(`/api/v1/artists/${artistId}`).set('Authorization', bearer(adminId)).send({ imagePublicId: null }).expect(200);
  });
  it.each(['page=0', 'page=x', 'limit=101', 'limit=0', 'search=', 'search=x&extra=true'])('validates artist queries: %s', async (query) => {
    await request(app.getHttpServer()).get(`/api/v1/artists?${query}`).set('Authorization', bearer(memberId)).expect(400);
  });
  it('transforms pagination and validates UUID parameters', async () => {
    await request(app.getHttpServer()).get('/api/v1/artists?page=2&limit=5&search=Hillsong').set('Authorization', bearer(memberId)).expect(200);
    expect(artists.list).toHaveBeenCalledWith({ page: 2, limit: 5, search: 'Hillsong' });
    await request(app.getHttpServer()).get('/api/v1/artists/not-a-uuid').set('Authorization', bearer(memberId)).expect(400);
    await request(app.getHttpServer()).patch('/api/v1/artists/invalid').set('Authorization', bearer(adminId)).send({ name: 'Valid' }).expect(400);
    await request(app.getHttpServer()).delete('/api/v1/artists/invalid').set('Authorization', bearer(adminId)).expect(400);
  });
  it('denies suspended accounts with existing tokens', async () => {
    const token = bearer(memberId); records.get(memberId)!.status = UserStatus.SUSPENDED;
    await request(app.getHttpServer()).get('/api/v1/artists').set('Authorization', token).expect(401);
  });
  it('documents all operations with bearer authorization', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const doc = response.body as { paths: Record<string, Record<string, { security: unknown; responses: object }>> };
    for (const path of ['/api/v1/artists', '/api/v1/artists/{id}']) for (const operation of Object.values(doc.paths[path] ?? {})) {
      expect(operation.security).toEqual([{ bearer: [] }]); expect(operation.responses).toHaveProperty('401');
    }
  });
});
