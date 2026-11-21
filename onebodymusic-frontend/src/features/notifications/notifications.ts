import { useQuery } from '@tanstack/react-query';
import { api, message } from '../../lib/api';
import { queryClient } from '../../lib/query';
export interface InboxItem { id: string; kind: string; title: string; body: string; href: string; createdAt: string; readAt: string | null }
export interface Inbox { data: InboxItem[]; unreadCount: number; total: number; page: number; totalPages: number }
export function newUnreadNotification(items: InboxItem[], seen: Set<string>): InboxItem | undefined {
  return items.find(item => !item.readAt && !seen.has(item.id));
}
export interface Preferences { rehearsals: boolean; reminders: boolean; push: boolean }
export function useInbox(userId: string, page = 1) {
  return useQuery({ queryKey: ['notifications', userId, page], queryFn: async ({ signal }) => (await api.get<Inbox>(`/notifications?page=${page}`, { signal })).data, refetchInterval: 30000, refetchOnWindowFocus: true });
}
export async function markRead(id?: string) {
  await api.patch(id ? `/notifications/${id}/read` : '/notifications/read-all');
  await queryClient.invalidateQueries({ queryKey: ['notifications'] });
}
export async function browserSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() ?? null;
}
const subscriptionOwnerKey = 'onebodymusic-push-owner';
export async function hasBrowserPush(userId: string) {
  const subscription = await browserSubscription();
  return !!subscription && localStorage.getItem(subscriptionOwnerKey) === userId;
}
export async function disableBrowserPush() {
  const subscription = await browserSubscription();
  if (!subscription) return;
  try { await api.delete('/notifications/push/subscriptions', { data: { endpoint: subscription.endpoint } }); }
  finally {
    await subscription.unsubscribe();
    localStorage.removeItem(subscriptionOwnerKey);
  }
}
const deviceKey = (userId: string) => `onebodymusic-push-device:${userId}`;
export function rememberPushDevice(userId: string, enabled: boolean) {
  if (enabled) localStorage.setItem(deviceKey(userId), '1');
  else localStorage.removeItem(deviceKey(userId));
}
async function releaseOtherAccountPush(userId: string, signal?: AbortSignal) {
  const owner = localStorage.getItem(subscriptionOwnerKey);
  if (owner && owner !== userId) {
    const subscription = await browserSubscription();
    signal?.throwIfAborted();
    if (localStorage.getItem(subscriptionOwnerKey) !== owner) return;
    if (subscription) await subscription.unsubscribe();
    localStorage.removeItem(subscriptionOwnerKey);
  }
}
export async function restoreBrowserPush(userId: string, signal: AbortSignal) {
  await releaseOtherAccountPush(userId, signal);
  signal.throwIfAborted();
  if (localStorage.getItem(deviceKey(userId)) !== '1' || !('Notification' in window) || Notification.permission !== 'granted') return;
  const preferences = await api.get<Preferences>('/notifications/preferences', { signal });
  if (!preferences.data.push) return;
  const options = await api.get<{ enabled: boolean; publicKey: string | null }>('/notifications/push/options', { signal });
  if (options.data.enabled && options.data.publicKey) await enableBrowserPush(userId, options.data.publicKey, signal);
}
export async function enableBrowserPush(userId: string, publicKey: string, signal?: AbortSignal) {
  if (!('Notification' in window) || !('PushManager' in window) || !window.isSecureContext) throw new Error('Push needs a supported browser and a secure connection. On iPhone, install the app from Safari first.');
  // Permission is requested only from an explicit Profile button press.
  if ((signal ? Notification.permission : await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked. You can change permission in your browser settings.');
  await releaseOtherAccountPush(userId, signal);
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active) throw new Error('Install or reload the app before enabling notifications.');
  signal?.throwIfAborted();
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const existing = await registration.pushManager.getSubscription();
  signal?.throwIfAborted();
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    signal?.throwIfAborted();
    const json = subscription.toJSON();
    await api.post('/notifications/push/subscriptions', { endpoint: subscription.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }, { signal });
    localStorage.setItem(subscriptionOwnerKey, userId);
  } catch (error) {
    if (!existing) await subscription.unsubscribe();
    throw new Error(message(error));
  }
}
