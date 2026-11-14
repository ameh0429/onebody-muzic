import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { loginSession, logoutSession, refreshSession } from './session';
vi.mock('../../lib/api', () => ({ api: { post: vi.fn() } }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('browser cookie session coordination', () => {
  it('shares one renewal among simultaneous callers to avoid replaying a rotated cookie', async () => {
    vi.stubGlobal('navigator', {});
    let finish!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = refreshSession(); const second = refreshSession(); expect(first).toBe(second);
    finish({ data: { accessToken: 'test-access', user: { id: 'test-user' }, expiresIn: 900 } });
    await expect(first).resolves.toHaveProperty('accessToken', 'test-access'); await second;
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/auth/refresh', {}, expect.objectContaining({ withCredentials: true, headers: { 'X-Session-Request': '1' } }));
  });
  it('permits a fresh attempt after a transient refresh failure', async () => {
    vi.stubGlobal('navigator', {});
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await expect(refreshSession()).rejects.toThrow('offline');
    vi.mocked(api.post).mockResolvedValueOnce({ data: { accessToken: 'retry-access' } });
    await expect(refreshSession()).resolves.toHaveProperty('accessToken', 'retry-access');
  });
  it('uses the same browser lock and CSRF-protected credentialed transport for login and logout', async () => {
    const lock = vi.fn(async (_name: string, work: () => Promise<void>) => work()); vi.stubGlobal('navigator', { locks: { request: lock } });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    await loginSession('test@example.org', 'test-only-password'); await logoutSession();
    expect(lock.mock.calls.map(([name]) => name)).toEqual(['onebodymusic-session', 'onebodymusic-session']);
    expect(api.post).toHaveBeenLastCalledWith('/auth/logout', {}, expect.objectContaining({ withCredentials: true, headers: { 'X-Session-Request': '1' } }));
  });
});
