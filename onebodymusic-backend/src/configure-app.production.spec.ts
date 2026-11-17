import { Controller, Get, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from './configure-app';

@Controller({ path: 'health', version: '1' })
class ProbeController { @Get() health() { return { status: 'ok' }; } }
@Module({ controllers: [ProbeController], providers: [{ provide: ConfigService, useValue: {
  get: (key: string) => ({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: ['https://music.example.org'] }[key]),
} }] })
class ProbeModule {}

describe('production HTTP configuration', () => {
  it('keeps health and exact credentialed CORS while omitting all Swagger routes', async () => {
    const module = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    const app = module.createNestApplication();
    configureApp(app);
    await app.init();
    try {
      await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'https://music.example.org')
        .expect('Access-Control-Allow-Origin', 'https://music.example.org')
        .expect('Access-Control-Allow-Credentials', 'true').expect(200, { status: 'ok' });
      const denied = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'https://untrusted.example');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
      for (const path of ['/api/docs', '/api/docs/', '/api/docs-json', '/api/docs-yaml', '/api/docs/swagger-ui-init.js']) {
        await request(app.getHttpServer()).get(path).expect(404);
      }
    } finally { await app.close(); }
  });
});
