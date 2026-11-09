import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { EnvironmentVariables } from '../../config/environment';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { AuthRateLimitStore } from './auth-rate-limit.store';
describe('AuthRateLimitGuard', () => {
  const consume = jest.fn(); const setHeader = jest.fn(); const handler = () => undefined;
  const reflector = { get: jest.fn() }; let guard: AuthRateLimitGuard;
  const context = (forwarded: string) => ({ getHandler: () => handler, switchToHttp: () => ({ getRequest: () => ({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': forwarded } }), getResponse: () => ({ setHeader }) }) }) as unknown as ExecutionContext;
  beforeEach(() => { jest.resetAllMocks(); reflector.get.mockReturnValue('login'); consume.mockResolvedValue({ hits: 1, retryAfter: 60 }); guard = new AuthRateLimitGuard({ consume } as unknown as AuthRateLimitStore, new ConfigService<EnvironmentVariables, true>({ JWT_SECRET: 'test-secret', AUTH_LOGIN_MAX_ATTEMPTS: 10, AUTH_REGISTER_MAX_ATTEMPTS: 5, AUTH_RATE_LIMIT_WINDOW_SECONDS: 60 }), reflector as unknown as Reflector); });
  it('uses a private address digest, separates endpoints and ignores spoofed forwarded headers', async () => {
    await guard.canActivate(context('1.2.3.4')); const first = consume.mock.calls[0] as [string, number, number];
    await guard.canActivate(context('8.8.8.8')); expect(consume.mock.calls[1]).toEqual(first); expect(first[0]).toMatch(/^[a-f0-9]{64}$/u); expect(first.slice(1)).toEqual([60, 10]);
    reflector.get.mockReturnValue('register'); await guard.canActivate(context('1.2.3.4')); expect(consume.mock.calls[2]?.[0]).not.toBe(first[0]); expect(consume.mock.calls[2]?.[2]).toBe(5);
  });
  it('returns 429 and Retry-After after the limit', async () => {
    consume.mockResolvedValue({ hits: 11, retryAfter: 42 }); await expect(guard.canActivate(context(''))).rejects.toMatchObject({ status: 429 }); expect(setHeader).toHaveBeenCalledWith('Retry-After', 42);
  });
  it('fails closed and hides storage errors', async () => {
    consume.mockRejectedValue(new Error('database password and SQL')); await expect(guard.canActivate(context(''))).rejects.toBeInstanceOf(ServiceUnavailableException); await expect(guard.canActivate(context(''))).rejects.toThrow('Authentication temporarily unavailable');
  });
});
