import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setAccessToken } from '../../lib/api';
import { queryClient } from '../../lib/query';
import type { User } from '../../lib/types';
interface Auth { user: User | null; login: (email: string, password: string) => Promise<void>; logout: () => void; update: (user: User) => void }
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null); const [expires, setExpires] = useState(0);
  const logout = () => { setAccessToken(null); setUser(null); setExpires(0); queryClient.clear(); };
  useEffect(() => { window.addEventListener('session-expired', logout); return () => window.removeEventListener('session-expired', logout); }, []);
  useEffect(() => { if (!expires) return; const timer = window.setTimeout(logout, Math.max(0, expires - Date.now())); return () => clearTimeout(timer); }, [expires]);
  useEffect(() => {
    if (!user) return;
    const check = () => { if (navigator.onLine && document.visibilityState === 'visible') void api.get<User>('/auth/me').then((r) => setUser(r.data)).catch(() => undefined); };
    const timer = window.setInterval(check, 60000); window.addEventListener('focus', check);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); };
  }, [user?.id]);
  async function login(email: string, password: string) { const { data } = await api.post<{ accessToken: string; expiresIn: number; user: User }>('/auth/login', { email: email.trim().toLowerCase(), password }); queryClient.clear(); setAccessToken(data.accessToken); setExpires(Date.now() + data.expiresIn * 1000); setUser(data.user); }
  return <Context.Provider value={{ user, login, logout, update: setUser }}>{children}</Context.Provider>;
}
export function useAuth() { const auth = useContext(Context); if (!auth) throw new Error('Auth provider missing'); return auth; }
