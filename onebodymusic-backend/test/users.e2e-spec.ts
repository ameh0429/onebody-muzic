import { AlbumsService } from '../src/albums/albums.service';
import { ArtistsService } from '../src/artists/artists.service';
import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { DatabaseModule } from '../src/database/database.module';
import { AuthRepository } from '../src/auth/auth.repository';
import { Role, User, UserStatus } from '../src/database/models';
import { UsersService } from '../src/users/users.service';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants';
import { configureApp } from '../src/configure-app';

@Module({})
class TestDatabaseModule {}

describe('User management authorization and DTOs', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const adminId = randomUUID(); const memberId = randomUUID(); const targetId = randomUUID();
  const records = new Map<string, User>();
  const service = { list: jest.fn(), findOne: jest.fn(), updateName: jest.fn(), updateRole: jest.fn(), updateStatus: jest.fn() };
  const bearer = (id: string) => `Bearer ${jwt.sign({ sub: id })}`;
  beforeAll(async () => {
    process.env.JWT_SECRET = randomBytes(48).toString('hex');
    process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule).useModule(TestDatabaseModule)
      .overrideProvider(AuthRepository).useValue({ findById: async (id: string) => records.get(id) ?? null })
      .overrideProvider(AlbumsService).useValue({}).overrideProvider(ArtistsService).useValue({}).overrideProvider(UsersService).useValue(service).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
    jwt = new JwtService({ secret: process.env.JWT_SECRET, signOptions: { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 900 } });
  });
  beforeEach(() => {
    jest.clearAllMocks(); records.clear();
    for (const [id, role] of [[adminId, Role.ADMIN], [memberId, Role.MEMBER]] as const) records.set(id, { id, role, status: UserStatus.ACTIVE, name: 'Grace', email: `${id}@example.org`, createdAt: new Date(), updatedAt: new Date() } as User);
    service.list.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    service.updateName.mockImplementation(async (id: string, name: string) => ({ id, name }));
    service.findOne.mockResolvedValue({ id: targetId });
    service.updateRole.mockResolvedValue({ id: targetId }); service.updateStatus.mockResolvedValue({ id: targetId });
  });
  afterAll(async () => { await app?.close(); });

  it.each(['list', 'detail', 'status', 'role', 'me'])('rejects unauthenticated access: %s', async (kind) => {
    if (kind === 'list') await request(app.getHttpServer()).get('/api/v1/users').expect(401);
    else if (kind === 'detail') await request(app.getHttpServer()).get(`/api/v1/users/${targetId}`).expect(401);
    else await request(app.getHttpServer()).patch(`/api/v1/users/${kind === 'me' ? 'me' : `${targetId}/${kind}`}`).send({}).expect(401);
  });
  it('denies all admin operations to members', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').set('Authorization', bearer(memberId)).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/users/${targetId}`).set('Authorization', bearer(memberId)).expect(403);
    for (const field of ['role', 'status']) await request(app.getHttpServer()).patch(`/api/v1/users/${targetId}/${field}`).set('Authorization', bearer(memberId)).send({ [field]: field === 'role' ? 'ADMIN' : 'ACTIVE' }).expect(403);
    expect(service.list).not.toHaveBeenCalled(); expect(service.updateRole).not.toHaveBeenCalled();
  });
  it('allows admins to list/filter, get details, approve and change roles', async () => {
    await request(app.getHttpServer()).get('/api/v1/users?page=2&limit=5&role=MEMBER&status=PENDING').set('Authorization', bearer(adminId)).expect(200);
    expect(service.list).toHaveBeenCalledWith({ page: 2, limit: 5, role: Role.MEMBER, status: UserStatus.PENDING });
    await request(app.getHttpServer()).get(`/api/v1/users/${targetId}`).set('Authorization', bearer(adminId)).expect(200);
    await request(app.getHttpServer()).patch(`/api/v1/users/${targetId}/status`).set('Authorization', bearer(adminId)).send({ status: 'ACTIVE' }).expect(200);
    expect(service.updateStatus).toHaveBeenCalledWith(adminId, targetId, UserStatus.ACTIVE);
    await request(app.getHttpServer()).patch(`/api/v1/users/${targetId}/role`).set('Authorization', bearer(adminId)).send({ role: 'ADMIN' }).expect(200);
  });
  it.each([adminId, memberId])('allows only the current user to update their trimmed name', async (id) => {
    await request(app.getHttpServer()).patch('/api/v1/users/me').set('Authorization', bearer(id)).send({ name: ' Grace James ' }).expect(200).expect({ id, name: 'Grace James' });
    expect(service.updateName).toHaveBeenCalledWith(id, 'Grace James');
  });
  it.each([{ name: ' ' }, { name: 42 }, {}, { name: 'Grace', role: 'ADMIN' }, { name: 'Grace', status: 'ACTIVE' }, { name: 'Grace', email: 'other@example.org' }, { name: 'Grace', id: targetId }])('rejects invalid or extra profile fields %j', async (body) => {
    await request(app.getHttpServer()).patch('/api/v1/users/me').set('Authorization', bearer(memberId)).send(body).expect(400);
    expect(service.updateName).not.toHaveBeenCalled();
  });
  it.each(['page=0', 'page=1.5', 'page=no', 'limit=101', 'limit=-1', 'role=OWNER', 'status=DISABLED', 'extra=true'])('validates pagination/filter %s', async (query) => {
    await request(app.getHttpServer()).get(`/api/v1/users?${query}`).set('Authorization', bearer(adminId)).expect(400);
  });
  it('validates UUIDs and role/status request bodies', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/invalid').set('Authorization', bearer(adminId)).expect(400);
    for (const field of ['status', 'role']) {
      await request(app.getHttpServer()).patch(`/api/v1/users/invalid/${field}`).set('Authorization', bearer(adminId)).send({ [field]: 'ACTIVE' }).expect(400);
      for (const body of [{}, { [field]: 'INVALID' }, { [field]: field === 'role' ? 'ADMIN' : 'ACTIVE', name: 'Extra' }]) await request(app.getHttpServer()).patch(`/api/v1/users/${targetId}/${field}`).set('Authorization', bearer(adminId)).send(body).expect(400);
    }
  });
  it('rejects suspended users even with an existing token', async () => {
    const token = bearer(adminId); records.get(adminId)!.status = UserStatus.SUSPENDED;
    await request(app.getHttpServer()).get('/api/v1/users').set('Authorization', token).expect(401);
  });
  it('documents bearer authentication and errors on all user routes', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const doc = response.body as { paths: Record<string, Record<string, { security: unknown; responses: object }>> };
    for (const path of ['/api/v1/users', '/api/v1/users/me', '/api/v1/users/{id}', '/api/v1/users/{id}/status', '/api/v1/users/{id}/role']) {
      for (const operation of Object.values(doc.paths[path] ?? {})) {
        expect(operation.security).toEqual([{ bearer: [] }]); expect(operation.responses).toHaveProperty('401'); expect(operation.responses).toHaveProperty('403');
      }
    }
  });
});
