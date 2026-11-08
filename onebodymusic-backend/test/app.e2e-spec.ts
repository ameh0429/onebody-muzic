import { AlbumsService } from '../src/albums/albums.service';
import { ArtistsService } from '../src/artists/artists.service';
import { UsersService } from '../src/users/users.service';
import 'reflect-metadata';
import { Controller, Get, INestApplication, Module, Post, Body } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import request from 'supertest';
import { AuthRepository } from '../src/auth/auth.repository';
import { DatabaseModule } from '../src/database/database.module';

@Module({})
class TestDatabaseModule {}
import { configureApp } from '../src/configure-app';

class ValidationProbeDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count!: number;
}

// Test-only routes exercise shared middleware without introducing business endpoints.
@Controller({ path: 'probe', version: '1' })
class ProbeController {
  @Post()
  create(@Body() dto: ValidationProbeDto): ValidationProbeDto { return dto; }

  @Get('error')
  fail(): never { throw new Error('private internal detail'); }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

interface HealthBody { status: string; service: string; timestamp: string }
interface ErrorBody { statusCode: number; error: string; message: string | string[]; timestamp: string; path: string }
interface OpenApiDocument {
  info: { title: string; version: string };
  paths: Record<string, { get: { tags: string[]; responses: Record<string, unknown> } }>;
  components: { securitySchemes: Record<string, { scheme: string }> };
}

describe('API foundation', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-only-secret-at-least-32-characters';
    process.env.DATABASE_URL ??= 'postgresql://localhost/onebodymusic_test';
    process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule, ProbeModule] }).overrideModule(DatabaseModule).useModule(TestDatabaseModule).overrideProvider(AlbumsService).useValue({}).overrideProvider(ArtistsService).useValue({}).overrideProvider(UsersService).useValue({}).overrideProvider(AuthRepository).useValue({}).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('returns a typed liveness response and security headers', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const body = response.body as HealthBody;
    expect(body).toEqual({ status: 'ok', service: 'onebodymusic-backend', timestamp: expect.any(String) });
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('permits only configured browser origins', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'http://localhost:5173')
      .expect('Access-Control-Allow-Origin', 'http://localhost:5173').expect(200);
    const response = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'https://untrusted.example').expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await request(app.getHttpServer()).options('/api/v1/health').set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET').expect(204);
  });

  it('returns consistent errors for missing routes and versions', async () => {
    for (const path of ['/api/health', '/api/v2/health', '/api/v1/missing']) {
      const response = await request(app.getHttpServer()).get(path).expect(404);
      const body = response.body as ErrorBody;
      expect(body).toMatchObject({ statusCode: 404, error: 'Not Found', path });
      expect(typeof body.message).toBe('string');
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    }
  });

  it('transforms DTOs and rejects extra or invalid fields', async () => {
    await request(app.getHttpServer()).post('/api/v1/probe').send({ name: 'test', count: '2' })
      .expect(201).expect({ name: 'test', count: 2 });
    for (const payload of [{ name: 'test', count: 2, extra: true }, { name: 42, count: 0 }]) {
      const response = await request(app.getHttpServer()).post('/api/v1/probe').send(payload).expect(400);
      expect(response.body as ErrorBody).toMatchObject({ statusCode: 400, error: 'Bad Request', message: expect.any(Array) });
    }
  });

  it('hides internal error details', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/error').expect(500);
    expect(response.body as ErrorBody).toMatchObject({ statusCode: 500, message: 'Internal server error' });
    expect(JSON.stringify(response.body)).not.toContain('private internal detail');
  });

  it('serves Swagger UI, assets, and documented versioned endpoints', async () => {
    await request(app.getHttpServer()).get('/api/docs/').expect(200).expect(/swagger-ui/);
    await request(app.getHttpServer()).get('/api/docs/swagger-ui-bundle.js').expect(200);
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const document = response.body as OpenApiDocument;
    expect(document.info).toMatchObject({ title: 'OnebodyMusic API', version: '1.0.0' });
    expect(document.components.securitySchemes['bearer']?.scheme).toBe('bearer');
    expect(document.paths['/api/v1/health']?.get.tags).toEqual(['Health']);
    expect(document.paths['/api/v1/health']?.get.responses).toHaveProperty('200');
    expect(document.paths['/api/v1/health']?.get.responses).toHaveProperty('500');
  });
});
