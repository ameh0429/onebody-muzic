import { validateEnvironment } from './environment';

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
  it('rejects invalid runtime modes', () => {
    expect(() => validateEnvironment({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173', NODE_ENV: 'invalid' })).toThrow('NODE_ENV');
  });
});
