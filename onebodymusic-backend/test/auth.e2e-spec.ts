import { UsersService } from '../src/users/users.service';
import { Controller, Get, INestApplication, Logger, Module, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { hash, argon2id, verify } from 'argon2';
import { randomUUID, randomBytes } from 'node:crypto';
import { UniqueConstraintError } from 'sequelize';
import request from 'supertest';
import { DatabaseModule } from '../src/database/database.module';
import { Role, User, UserStatus } from '../src/database/models';
import { AuthRepository } from '../src/auth/auth.repository';
import { AuthModule } from '../src/auth/auth.module';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { CurrentUser } from '../src/auth/decorators/current-user.decorator';
import { UserResponseDto } from '../src/auth/dto/user-response.dto';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants';
import { configureApp } from '../src/configure-app';

@Module({})
class TestDatabaseModule {}

@Controller({ path: 'auth-test', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
class AuthorizationProbe {
  @Get('admin')
  admin(@CurrentUser() user: UserResponseDto): { role: Role } { return { role: user.role }; }

  @Get('member')
  @Roles(Role.MEMBER)
  member(): { allowed: boolean } { return { allowed: true }; }
}
@Module({ imports: [AuthModule], controllers: [AuthorizationProbe] })
class ProbeModule {}

type RecordUser = Pick<User, 'id' | 'name' | 'email' | 'passwordHash' | 'role' | 'status' | 'createdAt' | 'updatedAt'>;
interface LoginBody { accessToken: string; expiresIn: number; user: UserResponseDto }

// A repository test double isolates HTTP/Passport checks; separate PostgreSQL tests exercise real persistence.
const users = new Map<string, RecordUser>();
const repository = {
  findByEmail: jest.fn(async (email: string): Promise<User | null> => (Array.from(users.values()).find((user) => user.email === email) as User | undefined) ?? null),
  findCredentials: jest.fn(async (email: string): Promise<User | null> => (Array.from(users.values()).find((user) => user.email === email) as User | undefined) ?? null),
  findById: jest.fn(async (id: string): Promise<User | null> => (users.get(id) as User | undefined) ?? null),
  createMember: jest.fn(async (name: string, email: string, passwordHash: string): Promise<User> => {
    const user: RecordUser = { id: randomUUID(), name, email, passwordHash, role: Role.MEMBER, status: UserStatus.PENDING, createdAt: new Date(), updatedAt: new Date() };
    users.set(user.id, user);
    return user as User;
  }),
};

const password = 'A-long-test-passphrase!';
const registration = { name: ' Grace James ', email: ' GRACE@EXAMPLE.ORG ', password, confirmPassword: password };

describe('Authentication and authorization HTTP', () => {
  let app: INestApplication;
  let signing: JwtService;
  let passwordHash: string;
  const secret = randomBytes(48).toString('hex');
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
    process.env.JWT_SECRET = secret;
    process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
    passwordHash = await hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule, ProbeModule] })
      .overrideModule(DatabaseModule).useModule(TestDatabaseModule)
      .overrideProvider(UsersService).useValue({}).overrideProvider(AuthRepository).useValue(repository).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    signing = new JwtService({ secret, signOptions: { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 900 } });
  });
  beforeEach(() => { users.clear(); jest.clearAllMocks(); });
  afterAll(async () => { await app?.close(); });

  function activeUser(role: Role = Role.MEMBER): RecordUser {
    const user: RecordUser = { id: randomUUID(), name: 'Grace James', email: 'grace@example.org', passwordHash, role, status: UserStatus.ACTIVE, createdAt: new Date(), updatedAt: new Date() };
    users.set(user.id, user); return user;
  }
  const bearer = (user: RecordUser) => `Bearer ${signing.sign({ sub: user.id })}`;

  it('registers a normalized pending member with an Argon2id hash and safe response', async () => {
    const result = await request(app.getHttpServer()).post('/api/v1/auth/register').send(registration).expect(201);
    const body = result.body as UserResponseDto;
    expect(body).toMatchObject({ name: 'Grace James', email: 'grace@example.org', role: Role.MEMBER, status: UserStatus.PENDING });
    const saved = users.get(body.id);
    expect(saved).toBeDefined();
    expect(saved?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verify(saved?.passwordHash ?? '', password)).toBe(true);
    expect(result.body).not.toHaveProperty('passwordHash');
    expect(result.body).not.toHaveProperty('accessToken');
  });

  it('rejects duplicate normalized email', async () => {
    activeUser();
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(registration).expect(409);
    expect(repository.createMember).not.toHaveBeenCalled();
  });

  it('converts concurrent database uniqueness failures to 409', async () => {
    repository.createMember.mockRejectedValueOnce(new UniqueConstraintError({ message: 'duplicate', errors: [] }));
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(registration).expect(409);
  });

  it.each([
    { password: 'short', confirmPassword: 'short' },
    { password: ' '.repeat(16), confirmPassword: ' '.repeat(16) },
    { password: 'x'.repeat(129), confirmPassword: 'x'.repeat(129) },
    { confirmPassword: 'does-not-match' },
    { password: 123, confirmPassword: 123 },
    { name: ' ' },
    { email: 'invalid' },
    { role: 'ADMIN' },
    { status: 'ACTIVE' },
  ])('rejects invalid registration or privilege fields: %j', async (override) => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({ ...registration, ...override }).expect(400);
    expect(repository.createMember).not.toHaveBeenCalled();
  });

  it('rejects missing confirmation', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({ name: 'Grace', email: 'grace@example.org', password }).expect(400);
  });

  it('logs in an active member and issues a minimal, short-lived token', async () => {
    const user = activeUser();
    const result = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: ' GRACE@EXAMPLE.ORG ', password }).expect(200);
    const body = result.body as LoginBody;
    expect(body.expiresIn).toBe(900);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(body.user).not.toHaveProperty('passwordHash');
    const payload = signing.verify<Record<string, unknown>>(body.accessToken);
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub']);
    expect(payload.sub).toBe(user.id);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(900);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${body.accessToken}`).expect(200).expect(body.user);
  });

  it.each(['wrong', 'missing', 'pending', 'suspended'])('uses the same generic error for %s credentials', async (scenario) => {
    const user = activeUser();
    if (scenario === 'missing') users.clear();
    if (scenario === 'pending') user.status = UserStatus.PENDING;
    if (scenario === 'suspended') user.status = UserStatus.SUSPENDED;
    const result = await request(app.getHttpServer()).post('/api/v1/auth/login')
      .send({ email: user.email, password: scenario === 'wrong' ? 'incorrect-password' : password }).expect(401);
    expect(result.body as { message: string }).toMatchObject({ message: 'Invalid email or password' });
  });

  it('rejects malformed login input', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'bad', password: '' }).expect(400);
  });

  it.each([undefined, 'Bearer malformed', 'Basic invalid'])('rejects missing/malformed credentials: %s', async (authorization) => {
    const call = request(app.getHttpServer()).get('/api/v1/auth/me');
    if (authorization) call.set('Authorization', authorization);
    await call.expect(401);
  });

  it('rejects expired JWTs', async () => {
    const user = activeUser();
    await request(app.getHttpServer()).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${signing.sign({ sub: user.id }, { expiresIn: -1 })}`).expect(401);
  });

  it('rejects tokens signed by another secret', async () => {
    const user = activeUser();
    const token = new JwtService({ secret: randomBytes(48).toString('hex') }).sign({ sub: user.id });
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('rejects invalid issuer, audience, algorithm and subject', async () => {
    const user = activeUser();
    const tokens = [
      signing.sign({ sub: user.id }, { issuer: 'wrong' }),
      signing.sign({ sub: user.id }, { audience: 'wrong' }),
      signing.sign({ sub: user.id }, { algorithm: 'HS384' }),
      signing.sign({ sub: 'not-a-uuid' }),
      signing.sign({ sub: user.id }, { noTimestamp: true }),
      new JwtService({ secret, signOptions: { issuer: JWT_ISSUER, audience: JWT_AUDIENCE } }).sign({ sub: user.id }),
    ];
    for (const token of tokens) await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it.each(['pending', 'suspended', 'deleted'])('revokes access for a newly %s user despite an unexpired JWT', async (state) => {
    const user = activeUser(); const token = bearer(user);
    if (state === 'deleted') users.delete(user.id);
    else user.status = state === 'pending' ? UserStatus.PENDING : UserStatus.SUSPENDED;
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', token).expect(401);
  });

  it('enforces ADMIN/MEMBER metadata and current roles instead of JWT role claims', async () => {
    const user = activeUser(); const token = bearer(user);
    await request(app.getHttpServer()).get('/api/v1/auth-test/admin').set('Authorization', token).expect(403);
    await request(app.getHttpServer()).get('/api/v1/auth-test/member').set('Authorization', token).expect(200);
    user.role = Role.ADMIN;
    await request(app.getHttpServer()).get('/api/v1/auth-test/admin').set('Authorization', token).expect(200).expect({ role: Role.ADMIN });
    await request(app.getHttpServer()).get('/api/v1/auth-test/member').set('Authorization', token).expect(403);
    user.role = Role.MEMBER;
    await request(app.getHttpServer()).get('/api/v1/auth-test/admin').set('Authorization', token).expect(403);
    await request(app.getHttpServer()).get('/api/v1/auth-test/admin').expect(401);
  });

  it('never exposes credential-related exception details in responses or logs', async () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      repository.findCredentials.mockRejectedValueOnce(new Error('private-credential-value'));
      const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'grace@example.org', password }).expect(500);
      expect(JSON.stringify(response.body)).not.toContain('private-credential-value');
      expect(JSON.stringify(logger.mock.calls)).not.toContain('private-credential-value');
    } finally { logger.mockRestore(); }
  });

  it('documents DTOs, examples, error responses and bearer authorization', async () => {
    const result = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const doc = result.body as { paths: Record<string, { post?: { requestBody: unknown; responses: Record<string, unknown> }; get?: { security: unknown } }> };
    expect(doc.paths['/api/v1/auth/register']?.post?.requestBody).toBeDefined();
    expect(doc.paths['/api/v1/auth/register']?.post?.responses).toHaveProperty('409');
    expect(doc.paths['/api/v1/auth/login']?.post?.responses).toHaveProperty('401');
    expect(doc.paths['/api/v1/auth/me']?.get?.security).toEqual([{ bearer: [] }]);
  });
});
