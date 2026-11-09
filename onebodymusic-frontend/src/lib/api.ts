import axios from 'axios';
let accessToken: string | null = null;
export function setAccessToken(token: string | null) { accessToken = token; }
export const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1', timeout: 20000 });
api.interceptors.request.use((config) => { if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`; return config; });
api.interceptors.response.use((response) => response, (error: unknown) => {
  if (axios.isAxiosError(error) && error.response?.status === 401 && accessToken && !error.config?.url?.startsWith('/auth/login')) window.dispatchEvent(new Event('session-expired'));
  return Promise.reject(error);
});
export function message(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return 'The request timed out while waiting for the server. Check the backend media diagnostics before retrying; any unfinished upload remains tracked for cleanup.';
    if (error.response?.status === 429) return `Too many attempts. Please try again in ${String(error.response.headers['retry-after'] || '60')} seconds.`;
    const body: unknown = error.response?.data;
    if (body && typeof body === 'object' && 'message' in body) { const detail: unknown = body.message; if (typeof detail === 'string') return detail; if (Array.isArray(detail) && detail.every((v: unknown) => typeof v === 'string')) return detail.join('. '); }
    if (!error.response) return 'Unable to connect. Check your connection and try again.';
    return 'Something went wrong. Please try again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
export function playbackUrl(path: string): string {
  const base = new URL(api.defaults.baseURL || '/api/v1', location.origin); const target = new URL(path, base);
  if (target.origin !== base.origin || !target.pathname.startsWith('/api/v1/songs/')) throw new Error('Invalid playback URL');
  return target.toString();
}
