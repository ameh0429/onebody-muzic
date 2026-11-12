import { ProfilePictureService } from '../src/media/profile-picture.service';
import { INestApplication, Module, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ModulesContainer, MetadataScanner } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { DatabaseModule } from '../src/database/database.module';
import { MediaModule } from '../src/media/media.module';
import { AuthRepository } from '../src/auth/auth.repository';
import { AuthRateLimitStore } from '../src/auth/rate-limit/auth-rate-limit.store';
import { UsersService } from '../src/users/users.service';
import { ArtistsService } from '../src/artists/artists.service';
import { AlbumsService } from '../src/albums/albums.service';
import { SongsService } from '../src/songs/songs.service';
import { MediaService } from '../src/media/media.service';
import { PlaylistsService } from '../src/playlists/playlists.service';
import { RehearsalsService } from '../src/rehearsals/rehearsals.service';
import { configureApp } from '../src/configure-app';
@Module({}) class EmptyDatabase {}
// Keep MediaModule so its real controller/interceptor upload schemas are audited.
describe('Complete runtime route and OpenAPI contract audit', () => {
  let app: INestApplication; let document: OpenAPIObject;
  beforeAll(async () => {
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/test', JWT_SECRET: randomBytes(48).toString('hex'), CORS_ALLOWED_ORIGINS: 'http://localhost:5173', MEDIA_ENABLED: 'false' });
    const { AppModule } = await import('../src/app.module');
    let builder = Test.createTestingModule({ imports: [AppModule, MediaModule] }).overrideModule(DatabaseModule).useModule(EmptyDatabase).overrideProvider(AuthRepository).useValue({}).overrideProvider(AuthRateLimitStore).useValue({ consume: async () => ({ hits: 1, retryAfter: 60 }) });
    for (const provider of [UsersService, ArtistsService, AlbumsService, SongsService, MediaService, PlaylistsService, RehearsalsService, ProfilePictureService]) builder = builder.overrideProvider(provider).useValue({});
    // MediaRepository requires models even though the controller is denied before it runs.
    const { MediaRepository } = await import('../src/media/media.repository');
    const module = await builder.overrideProvider(MediaRepository).useValue({}).compile();
    app = module.createNestApplication(); configureApp(app); await app.init(); document = (await request(app.getHttpServer()).get('/api/docs-json').expect(200)).body as OpenAPIObject;
  });
  afterAll(async () => app?.close());
  const operations = () => Object.entries(document.paths).flatMap(([path, item]) => Object.entries(item ?? {}).filter(([method]) => ['get', 'post', 'patch', 'delete'].includes(method)).map(([method, operation]) => ({ path, method, operation: operation as OperationObject })));
  it('has exactly one documented operation for every real controller route', () => {
    const actual = new Set<string>(); const scanner = new MetadataScanner();
    for (const module of app.get(ModulesContainer).values()) for (const controller of module.controllers.values()) {
      const instance: unknown = controller.instance; if (!instance || !controller.metatype) continue;
      const prefix: unknown = Reflect.getMetadata(PATH_METADATA, controller.metatype); if (typeof prefix !== 'string') continue;
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name]; if (typeof handler !== 'function') continue;
        const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler); const suffix: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        if (typeof method !== 'number' || typeof suffix !== 'string') continue;
        const path = `/api/v1/${prefix}/${suffix}`.replace(/\/+$/u, '').replace(/:([^/]+)/gu, '{$1}');
        actual.add(`${RequestMethod[method]!.toLowerCase()} ${path}`);
      }
    }
    expect(actual.size).toBe(46); expect(new Set(operations().map(({ path, method }) => `${method} ${path}`))).toEqual(actual);
  });
  it('groups every operation, resolves every schema reference and defines success schemas', () => {
    const ids = new Set<string>();
    for (const { operation } of operations()) {
      const body = operation.requestBody; if (body && 'content' in body && body.content['application/json']) expect(operation.responses['413']).toBeDefined();
      expect(operation.tags?.length).toBe(1); expect(operation.summary).toBeTruthy(); expect(operation.operationId).toBeTruthy(); expect(ids.has(operation.operationId!)).toBe(false); ids.add(operation.operationId!);
      expect(Object.keys(operation.responses).some((status) => /^2\d\d$/u.test(status))).toBe(true);
      for (const [status, response] of Object.entries(operation.responses)) if (/^20[01]$/u.test(status) && response && !('$ref' in response)) expect(response.content).toBeDefined();
    }
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if ('$ref' in value && typeof value.$ref === 'string') { const ref = value.$ref; expect(ref.startsWith('#/')).toBe(true); let found: unknown = document; for (const key of ref.slice(2).split('/')) { expect(found).toBeDefined(); found = (found as Record<string, unknown>)[key]; } expect(found).toBeDefined(); }
      for (const child of Object.values(value)) visit(child);
    }; visit(document);
    expect(/amehmathiasejeh@gmail|passwordHash|api_secret/iu.test(JSON.stringify(document))).toBe(false);
  });
  it('documents bearer auth for all protected routes and actually rejects missing authentication', async () => {
    const publicRoutes = new Set(['get /api/v1/health', 'post /api/v1/auth/login', 'post /api/v1/auth/register', 'post /api/v1/auth/session', 'post /api/v1/auth/refresh', 'post /api/v1/auth/logout']);
    for (const { path, method, operation } of operations()) {
      if (publicRoutes.has(`${method} ${path}`)) continue;
      expect(operation.security).toEqual(expect.arrayContaining([{ bearer: [] }])); expect(operation.responses['401']).toBeDefined();
      const target = path.replace(/\{[^}]+\}/gu, randomUUID());
      if (method === 'get') await request(app.getHttpServer()).get(target).expect(401);
      if (method === 'post') await request(app.getHttpServer()).post(target).send({}).expect(401);
      if (method === 'patch') await request(app.getHttpServer()).patch(target).send({}).expect(401);
      if (method === 'delete') await request(app.getHttpServer()).delete(target).expect(401);
    }
  });
  it('documents pagination, multipart files, validation, throttling and playback variants', () => {
    for (const resource of ['users', 'artists', 'albums', 'songs', 'playlists', 'rehearsals']) {
      const op = document.paths[`/api/v1/${resource}`]!.get!;
      for (const name of ['page', 'limit']) expect(op.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name, in: 'query', required: false })]));
      expect(op.responses['400']).toBeDefined();
    }
    for (const type of ['audio', 'images']) { const body = document.paths[`/api/v1/media/${type}`]!.post!.requestBody!; expect(body).toHaveProperty('content.multipart/form-data.schema.properties.file.format', 'binary'); }
    for (const route of ['login', 'register']) expect(document.paths[`/api/v1/auth/${route}`]!.post!.responses['429']).toBeDefined();
    const stream = document.paths['/api/v1/songs/{id}/stream']!.get!;
    expect(stream.responses).toEqual(expect.objectContaining({ '200': expect.any(Object), '206': expect.any(Object), '302': expect.any(Object), '416': expect.any(Object) }));
    expect(stream.responses['200']).toHaveProperty('content.audio/mpeg.schema.format', 'binary');
    expect(stream.responses['200']).toHaveProperty('content.application/json.schema.$ref');
  });
});
