import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { hasBrowserPush, newUnreadNotification, rememberPushDevice, restoreBrowserPush, type InboxItem } from './notifications';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  const subscription = { endpoint: 'https://push.example/sub', toJSON: () => ({ keys: { p256dh: 'key', auth: 'auth' } }), unsubscribe: vi.fn() };
  vi.stubGlobal('window', { Notification: {}, PushManager: {}, isSecureContext: true });
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ active: true, pushManager: { getSubscription: async () => subscription } }) } });
  return subscription;
}
it('restores only the opted-in account without asking browser permission again', async () => {
  setup(); rememberPushDevice('admin', true);
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { push: true } }).mockResolvedValueOnce({ data: { enabled: true, publicKey: 'a2V5' } });
  const post = vi.spyOn(api, 'post').mockResolvedValue({});
  await restoreBrowserPush('member', new AbortController().signal);
  expect(get).not.toHaveBeenCalled();
  await restoreBrowserPush('admin', new AbortController().signal);
  expect(post).toHaveBeenCalledWith('/notifications/push/subscriptions', { endpoint: 'https://push.example/sub', p256dh: 'key', auth: 'auth' }, expect.anything());
  expect(Notification.requestPermission).not.toHaveBeenCalled();
});
it('respects account-wide disable and explicit device opt-out', async () => {
  setup(); rememberPushDevice('admin', true);
  const get = vi.spyOn(api, 'get').mockResolvedValue({ data: { push: false } });
  const post = vi.spyOn(api, 'post');
  await restoreBrowserPush('admin', new AbortController().signal);
  expect(post).not.toHaveBeenCalled();
  rememberPushDevice('admin', false); get.mockClear();
  await restoreBrowserPush('admin', new AbortController().signal);
  expect(get).not.toHaveBeenCalled();
});
it('does not restore when browser permission is revoked', async () => {
  setup(); rememberPushDevice('admin', true);
  vi.stubGlobal('Notification', { permission: 'denied' });
  const get = vi.spyOn(api, 'get');
  await restoreBrowserPush('admin', new AbortController().signal);
  expect(get).not.toHaveBeenCalled();
});

it('alerts only for a new unread item, not a count change or previously seen item', () => {
  const item: InboxItem = { id: 'new', kind: 'MEMBER_REGISTERED', title: 'Member awaiting approval', body: 'New member', href: '/admin', createdAt: new Date().toISOString(), readAt: null };
  expect(newUnreadNotification([item], new Set())).toEqual(item);
  expect(newUnreadNotification([item], new Set(['new']))).toBeUndefined();
  expect(newUnreadNotification([{ ...item, readAt: new Date().toISOString() }], new Set())).toBeUndefined();
});
it('does not attach a subscription after an account switch aborts restoration', async () => {
  setup(); rememberPushDevice('admin', true);
  const controller = new AbortController();
  vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { push: true } }).mockImplementationOnce(async () => {
    controller.abort(); return { data: { enabled: true, publicKey: 'a2V5' } };
  });
  const post = vi.spyOn(api, 'post');
  await expect(restoreBrowserPush('admin', controller.signal)).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
});

it('removes the previous account’s subscription when another account signs in', async () => {
  const subscription = setup();
  rememberPushDevice('admin', true);
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { push: true } }).mockResolvedValueOnce({ data: { enabled: true, publicKey: 'a2V5' } });
  vi.spyOn(api, 'post').mockResolvedValue({});
  await restoreBrowserPush('admin', new AbortController().signal);
  expect(await hasBrowserPush('admin')).toBe(true);
  expect(await hasBrowserPush('member')).toBe(false);
  get.mockClear();

  await restoreBrowserPush('member', new AbortController().signal);

  expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  expect(await hasBrowserPush('admin')).toBe(false);
  expect(get).not.toHaveBeenCalled();
});
