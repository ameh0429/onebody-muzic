import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import { api, setAccessToken, setSessionRenewal } from '../../lib/api';
import { queryClient } from '../../lib/query';
import type { User } from '../../lib/types';
import { loginSession, logoutSession, refreshSession, type SessionResponse } from './session';
interface Auth { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; update: (user: User) => void }
const Context = createContext<Auth | null>(null);
const LOGOUT_PENDING = 'onebodymusic-logout-pending';
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null); const [loading, setLoading] = useState(true); const [notice, setNotice] = useState('');
  const current = useRef<User | null>(null); const deadline = useRef(0); const version = useRef(0); const mounted = useRef(false);
  const clear = useCallback(() => { version.current++; setAccessToken(null); current.current = null; deadline.current = 0; setUser(null); queryClient.clear(); }, []);
  const apply = useCallback((data: SessionResponse) => {
    if (current.current && current.current.id !== data.user.id) queryClient.clear();
    setAccessToken(data.accessToken); current.current = data.user; setUser(data.user); deadline.current = Date.now() + data.expiresIn * 1000; setNotice('');
  }, []);
  const renew = useCallback(async () => {
    const attempt = version.current;
    try {
      const data = await refreshSession();
      if (!mounted.current || attempt !== version.current) throw new Error('Session changed');
      apply(data);
    } catch (error) {
      if (mounted.current && attempt === version.current && axios.isAxiosError(error) && error.response?.status === 401) clear();
      throw error;
    }
  }, [apply, clear]);
  const restore = useCallback(async () => {
    setLoading(true);
    try {
      if (localStorage.getItem(LOGOUT_PENDING)) { await logoutSession(); localStorage.removeItem(LOGOUT_PENDING); clear(); }
      else await renew();
    } catch (error) {
      if (mounted.current && !(axios.isAxiosError(error) && error.response?.status === 401)) setNotice('We could not restore your session. Check your connection and retry.');
    } finally { if (mounted.current) setLoading(false); }
  }, [clear, renew]);
  const logout = useCallback(async () => {
    localStorage.setItem(LOGOUT_PENDING, '1'); clear(); setLoading(true); setNotice('');
    try { await logoutSession(); localStorage.removeItem(LOGOUT_PENDING); }
    catch { if (mounted.current) setNotice('Signed out on this page. Server sign-out is pending; reconnect and retry to finish.'); }
    finally { if (mounted.current) setLoading(false); }
  }, [clear]);
  useEffect(() => {
    mounted.current = true; setSessionRenewal(renew); void restore();
    const expired = () => { clear(); }; const storage = (event: StorageEvent) => { if (event.key === LOGOUT_PENDING && event.newValue) clear(); };
    window.addEventListener('session-expired', expired); window.addEventListener('storage', storage);
    return () => { mounted.current = false; setSessionRenewal(null); window.removeEventListener('session-expired', expired); window.removeEventListener('storage', storage); };
  }, [clear, renew, restore]);
  useEffect(() => {
    if (!user) return;
    const check = async () => {
      if (!navigator.onLine) return;
      try {
        if (Date.now() >= deadline.current - 30000) await renew();
        else if (document.visibilityState === 'visible') {
          const attempt = version.current; const result = await api.get<User>('/auth/me');
          if (mounted.current && attempt === version.current) { current.current = result.data; setUser(result.data); }
        }
      } catch { /* A transient outage leaves the cookie intact; the next focus/timer retries. */ }
    };
    const timer = window.setInterval(() => void check(), 30000); const focus = () => void check(); window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [user?.id, renew]);
  async function login(email: string, password: string) {
    const attempt = ++version.current; const data = await loginSession(email.trim().toLowerCase(), password);
    if (!mounted.current || attempt !== version.current) return;
    localStorage.removeItem(LOGOUT_PENDING); queryClient.clear(); apply(data);
  }
  return <Context.Provider value={{ user, loading, login, logout, update: (next) => { current.current = next; setUser(next); } }}>
    {notice && <div className="notice" role="alert">{notice}<button className="btn secondary" onClick={() => void restore()}>Retry session connection</button></div>}{children}
  </Context.Provider>;
}
export function useAuth() { const auth = useContext(Context); if (!auth) throw new Error('Auth provider missing'); return auth; }
