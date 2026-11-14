import { api } from '../../lib/api';
import type { User } from '../../lib/types';
export interface SessionResponse { accessToken: string; expiresIn: number; user: User }
const options = { withCredentials: true, headers: { 'X-Session-Request': '1' } };
// Web Locks serialize cookie rotation across same-origin tabs; single-flight handles StrictMode and concurrent requests.
export function sessionLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return work();
  return new Promise<T>((resolve, reject) => {
    void navigator.locks.request('onebodymusic-session', async () => { try { resolve(await work()); } catch (error) { reject(error); } }).catch(reject);
  });
}
let refresh: Promise<SessionResponse> | null = null;
export function refreshSession(): Promise<SessionResponse> {
  if (!refresh) refresh = sessionLock(async () => (await api.post<SessionResponse>('/auth/refresh', {}, options)).data).finally(() => { refresh = null; });
  return refresh;
}
export async function loginSession(email: string, password: string): Promise<SessionResponse> {
  return sessionLock(async () => (await api.post<SessionResponse>('/auth/session', { email, password }, options)).data);
}
export function logoutSession(): Promise<void> { return sessionLock(async () => { await api.post('/auth/logout', {}, options); }); }
