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
import { AlbumsService } from '../src/albums/albums.service';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants';
import { configureApp } from '../src/configure-app';

@Module({})
class TestDatabaseModule {}

describe('Album authorization, validation, and documentation', () => {
  let app: INestApplication; let jwt: JwtService;
  const adminId = randomUUID(); const memberId = randomUUID(); const albumId = randomUUID(); const artistId = randomUUID();
  const records = new Map<string, User>();
  const albums = { create: jest.fn(), list: jest.fn(), findOne: jest.fn(), update: jest.fn(), remove: jest.fn() };
  const bearer = (id: string) => `Bearer ${jwt.sign({ sub: id })}`;
  const body = { title: ' Songs  of Praise ', artistId, releaseYear: 2024 };
  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('hex'); process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900'; process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173'; process.env.DATABASE_URL = 'postgresql://localhost/test';
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideModule(DatabaseModule).useModule(TestDatabaseModule)
      .overrideProvider(AuthRepository).useValue({ findById: async (id: string) => records.get(id) ?? null })
      .overrideProvider(UsersService).useValue({}).overrideProvider(ArtistsService).useValue({}).overrideProvider(AlbumsService).useValue(albums).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
    jwt = new JwtService({ secret: process.env.JWT_SECRET, signOptions: { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256', expiresIn: 900 } });
  });
  beforeEach(() => {
    jest.clearAllMocks(); records.clear();
    for (const [id, role] of [[adminId, Role.ADMIN], [memberId, Role.MEMBER]] as const) records.set(id, { id, role, status: UserStatus.ACTIVE, name: 'Grace', email: 'grace@example.org', createdAt: new Date(), updatedAt: new Date() } as User);
    for (const method of [albums.create, albums.findOne, albums.update]) method.mockResolvedValue({ id: albumId }); albums.list.mockResolvedValue({ data: [] }); albums.remove.mockResolvedValue(undefined);
  });
  afterAll(async () => { await app?.close(); });
  it('requires authentication everywhere and restricts writes to admins', async () => {
    await request(app.getHttpServer()).get('/api/v1/albums').expect(401);
    await request(app.getHttpServer()).get(`/api/v1/albums/${albumId}`).expect(401);
    await request(app.getHttpServer()).post('/api/v1/albums').send(body).expect(401);
    await request(app.getHttpServer()).patch(`/api/v1/albums/${albumId}`).send(body).expect(401);
    await request(app.getHttpServer()).delete(`/api/v1/albums/${albumId}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/albums').set('Authorization', bearer(memberId)).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/albums/${albumId}`).set('Authorization', bearer(memberId)).expect(200);
    await request(app.getHttpServer()).post('/api/v1/albums').set('Authorization', bearer(memberId)).send(body).expect(403);
    await request(app.getHttpServer()).patch(`/api/v1/albums/${albumId}`).set('Authorization', bearer(memberId)).send(body).expect(403);
    await request(app.getHttpServer()).delete(`/api/v1/albums/${albumId}`).set('Authorization', bearer(memberId)).expect(403);
  });
  it('normalizes titles and accepts admin create/update/delete with optional artwork', async () => {
    await request(app.getHttpServer()).post('/api/v1/albums').set('Authorization', bearer(adminId)).send(body).expect(201);
    expect(albums.create).toHaveBeenCalledWith({ ...body, title: 'Songs of Praise' });
    await request(app.getHttpServer()).patch(`/api/v1/albums/${albumId}`).set('Authorization', bearer(adminId)).send({ coverImageUrl: null, coverImagePublicId: null }).expect(200);
    await request(app.getHttpServer()).delete(`/api/v1/albums/${albumId}`).set('Authorization', bearer(adminId)).expect(204).expect('');
  });
  it.each([{ title: ' ' }, { title: null }, { artistId: 'invalid' }, { artistId: null }, { releaseYear: null }, { releaseYear: 0 }, { releaseYear: 10000 }, { releaseYear: 2024.5 }, { releaseYear: '2024' }, { coverImageUrl: 'http://example.org/x.jpg' }, { coverImagePublicId: '' }, { extra: true }])('rejects invalid create fields %j', async (override) => {
    await request(app.getHttpServer()).post('/api/v1/albums').set('Authorization', bearer(adminId)).send({ ...body, ...override }).expect(400);
  });
  it('requires a release year on create, rejects null required fields on patch', async () => {
    await request(app.getHttpServer()).post('/api/v1/albums').set('Authorization', bearer(adminId)).send({ title: 'Praise', artistId }).expect(400);
    for (const key of ['title', 'artistId', 'releaseYear']) await request(app.getHttpServer()).patch(`/api/v1/albums/${albumId}`).set('Authorization', bearer(adminId)).send({ [key]: null }).expect(400);
  });
  it.each(['artistId=invalid', 'releaseYear=0', 'releaseYear=x', 'releaseYear=2024.5', 'page=0', 'limit=101', 'search=', 'extra=true'])('validates filters and pagination %s', async (query) => {
    await request(app.getHttpServer()).get(`/api/v1/albums?${query}`).set('Authorization', bearer(memberId)).expect(400);
  });
  it('transforms query numbers and validates UUID route parameters', async () => {
    await request(app.getHttpServer()).get(`/api/v1/albums?artistId=${artistId}&releaseYear=2024&page=2&limit=5&search=praise`).set('Authorization', bearer(memberId)).expect(200);
    expect(albums.list).toHaveBeenCalledWith({ artistId, releaseYear: 2024, page: 2, limit: 5, search: 'praise' });
    await request(app.getHttpServer()).get('/api/v1/albums/invalid').set('Authorization', bearer(memberId)).expect(400);
    await request(app.getHttpServer()).patch('/api/v1/albums/invalid').set('Authorization', bearer(adminId)).send({ title: 'Praise' }).expect(400);
    await request(app.getHttpServer()).delete('/api/v1/albums/invalid').set('Authorization', bearer(adminId)).expect(400);
  });
  it('documents album operations and associated song schemas', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const doc = response.body as { paths: Record<string, Record<string, { security: unknown; responses: object }>>; components: { schemas: Record<string, unknown> } };
    for (const path of ['/api/v1/albums', '/api/v1/albums/{id}']) for (const operation of Object.values(doc.paths[path] ?? {})) { expect(operation.security).toEqual([{ bearer: [] }]); expect(operation.responses).toHaveProperty('401'); }
    expect(doc.components.schemas).toHaveProperty('AlbumSongDto');
  });
});
