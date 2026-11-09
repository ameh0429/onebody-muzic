import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { EnvironmentVariables } from '../config/environment';
import { PlaybackTicketsService } from './playback-tickets.service';

describe('short-lived song-specific playback URLs', () => {
  const secret = randomBytes(48).toString('hex');
  const service = new PlaybackTicketsService(new ConfigService<EnvironmentVariables, true>({ JWT_SECRET: secret, MEDIA_PLAYBACK_TTL_SECONDS: 60 }));
  const userId = randomUUID(); const songId = randomUUID();
  afterEach(() => { jest.useRealTimers(); });
  it('issues relative, expiring URLs with no Cloudinary credentials or provider address', async () => {
    const result = await service.issue(userId, songId);
    const url = new URL(result.url, 'https://api.example.org');
    expect(url.pathname).toBe(`/api/v1/songs/${songId}/stream`); expect(result.expiresIn).toBe(60);
    const ticket = url.searchParams.get('ticket') ?? '';
    expect(await service.verify(ticket)).toMatchObject({ sub: userId, songId, kind: 'song-playback' });
    expect(result.url).not.toContain('cloudinary'); expect(result.url).not.toContain(secret);
  });
  it('actually rejects the URL ticket after its configured expiration', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }); jest.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    const result = await service.issue(userId, songId); const ticket = new URL(result.url, 'https://api.example.org').searchParams.get('ticket') ?? '';
    expect(new Date(result.expiresAt).toISOString()).toBe('2026-11-08T12:01:00.000Z');
    jest.advanceTimersByTime(61000); await expect(service.verify(ticket)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('does not accept ordinary access JWTs as playback tickets', async () => {
    const token = new JwtService({ secret }).sign({ sub: userId }, { expiresIn: 900 });
    await expect(service.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects tampering', async () => {
    const issued = await service.issue(userId, songId); const ticket = new URL(issued.url, 'https://api.example.org').searchParams.get('ticket') ?? '';
    const [header, , signature] = ticket.split('.'); const forged = `${header}.${Buffer.from(JSON.stringify({ sub: userId, songId: randomUUID(), exp: 9999999999 })).toString('base64url')}.${signature}`;
    await expect(service.verify(forged)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
