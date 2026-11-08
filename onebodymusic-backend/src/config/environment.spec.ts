import { validateEnvironment as validate } from './environment';

const validateEnvironment = (config: Record<string, unknown>) => validate({ DATABASE_URL: 'postgresql://localhost/onebodymusic', JWT_SECRET: 'test-only-secret-at-least-32-characters', ...config });

describe('startup configuration validation', () => {
  it('parses explicit origins and applies documented defaults', () => {
    expect(validateEnvironment({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173, https://music.example.org' }))
      .toMatchObject({ NODE_ENV: 'development', PORT: 3000, CORS_ALLOWED_ORIGINS: ['http://localhost:5173', 'https://music.example.org'] });
  });
  it.each([undefined, '', '*', 'https://*.example.org', 'https://example.org/path', 'javascript:alert(1)', 'https://example.org,'])
    ('rejects missing or invalid origins: %s', (origins) => {
      expect(() => validateEnvironment({ CORS_ALLOWED_ORIGINS: origins })).toThrow('CORS_ALLOWED_ORIGINS');
    });
  it.each(['0', '65536', 'abc', '3.5'])('rejects invalid port %s', (port) => {
    expect(() => validateEnvironment({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173', PORT: port })).toThrow('PORT');
  });
  it.each([undefined, '', 'mysql://localhost/db', 'postgresql://'])('rejects invalid database URL %s', (url) => {
    expect(() => validateEnvironment({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173', DATABASE_URL: url })).toThrow('DATABASE_URL');
  });
  it.each([undefined, '', 'short', ' '.repeat(40)])('rejects invalid JWT secret', (JWT_SECRET) => {
    expect(() => validateEnvironment({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173', JWT_SECRET })).toThrow('JWT_SECRET');
  });
  it.each(['0', '59', '3601', 'abc', '1.5'])('rejects invalid JWT lifetime %s', (JWT_ACCESS_TOKEN_TTL_SECONDS) => {
    expect(() => validateEnvironment({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173', JWT_ACCESS_TOKEN_TTL_SECONDS })).toThrow('JWT_ACCESS_TOKEN_TTL_SECONDS');
  });
  it('validates media credentials only when explicitly enabled', () => {
    const base = { CORS_ALLOWED_ORIGINS: 'http://localhost:5173' };
    expect(validateEnvironment(base).MEDIA_ENABLED).toBe('false');
    expect(() => validateEnvironment({ ...base, MEDIA_ENABLED: 'true' })).toThrow('CLOUDINARY');
    expect(validateEnvironment({ ...base, MEDIA_ENABLED: 'true', CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret' }).MEDIA_ENABLED).toBe('true');
  });
  it.each([{ MEDIA_AUDIO_MAX_BYTES: '0' }, { MEDIA_IMAGE_MAX_BYTES: '999999999' }, { MEDIA_MAX_CONCURRENT_UPLOADS: '0' }, { MEDIA_STALE_UPLOAD_SECONDS: '30' }])('rejects invalid media bounds %j', (values) => {
    expect(() => validateEnvironment({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173', ...values })).toThrow('MEDIA_');
  });
  it('rejects invalid runtime modes', () => {
    expect(() => validateEnvironment({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173', NODE_ENV: 'invalid' })).toThrow('NODE_ENV');
  });
});
