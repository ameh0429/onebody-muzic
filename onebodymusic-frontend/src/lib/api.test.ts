import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { api, message, playbackUrl } from './api';
afterEach(() => vi.unstubAllGlobals());
describe('safe API presentation and playback', () => {
  it('resolves scoped tickets against the API origin and rejects external/ordinary URLs', () => {
    vi.stubGlobal('location', { origin: 'https://music.example.org' }); api.defaults.baseURL = 'https://api.example.org/api/v1';
    expect(playbackUrl('/api/v1/songs/123/stream?ticket=short-lived')).toBe('https://api.example.org/api/v1/songs/123/stream?ticket=short-lived');
    for (const path of ['https://elsewhere.example/song.mp3', '/api/v1/users', '//attacker.example/audio']) expect(() => playbackUrl(path)).toThrow('Invalid playback URL');
    api.defaults.baseURL = '/api/v1';
  });
  it('turns validation arrays and throttle responses into actionable messages', () => {
    const error = new AxiosError('Request failed', undefined, undefined, undefined, { status: 400, statusText: 'Bad Request', headers: new AxiosHeaders(), data: { message: ['title required', 'artist required'] }, config: { headers: new AxiosHeaders() } });
    expect(message(error)).toBe('title required. artist required');
    error.response!.status = 429; error.response!.headers['retry-after'] = '42'; expect(message(error)).toContain('42 seconds');
  });
  it('distinguishes request timeout from an ordinary disconnected request', () => {
    expect(message(new AxiosError('private timeout detail', 'ECONNABORTED'))).toContain('request timed out');
    expect(message(new AxiosError('private timeout detail', 'ETIMEDOUT'))).not.toContain('private timeout detail');
  });
  it('does not dump Axios internals or arbitrary response objects into the interface', () => {
    const error = new AxiosError('private transport details', undefined, undefined, undefined, { status: 500, statusText: 'Failure', headers: new AxiosHeaders(), data: { sql: 'sensitive SQL' }, config: { headers: new AxiosHeaders() } });
    expect(message(error)).not.toContain('SQL');
    expect(message(new AxiosError('network details'))).toBe('Unable to connect. Check your connection and try again.');
  });
});
