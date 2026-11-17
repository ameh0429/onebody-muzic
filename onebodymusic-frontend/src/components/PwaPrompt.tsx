import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { subscribeUpdates, updateApp } from '../lib/pwa';
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const InstallContext = createContext<{ installed: boolean; available: boolean; requestInstall: () => Promise<void>; error: string }>({ installed: true, available: false, requestInstall: async () => undefined, error: '' });
export function InstallApp() {
  const { installed, available, requestInstall, error } = useContext(InstallContext);
  const ios = /iPad|iPhone|iPod/u.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (installed) return null;
  return <section className="pwa-install" aria-labelledby="install-app-title">
    <h3 id="install-app-title">OnebodyMusic on your device</h3>
    <p className="subtle">Keep your worship space close with the OnebodyMusic app.</p>
    {available ? <button className="btn" onClick={() => void requestInstall()}><Download size={18}/>Install app</button> : <details><summary className="btn secondary"><Download size={18}/>Install app</summary>
      <p className="subtle">{ios ? 'In Safari, tap Share, then Add to Home Screen and Add. If using another browser, open this page in Safari first.' : 'In Chrome or Edge, choose Install app from the address bar or browser menu when available. Installation requires HTTPS. You can also keep using the app in your browser.'}</p>
    </details>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
export default function PwaPrompt({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [later, setLater] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const [error, setError] = useState('');
  useEffect(() => subscribeUpdates(setReady), []);
  useEffect(() => {
    const before = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    const done = () => { setInstall(null); setInstalled(true); };
    window.addEventListener('beforeinstallprompt', before); window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', done); };
  }, []);
  async function requestInstall() {
    if (!install) return;
    try { await install.prompt(); await install.userChoice; setInstall(null); }
    catch { setError('Use your browser menu to install OnebodyMusic.'); }
  }
  return <InstallContext.Provider value={{ installed, available: !!install, requestInstall, error }}>
    {children}
    {ready && <div className="pwa-update" role="status"><p>{later ? 'An update is waiting.' : 'A new OnebodyMusic version is ready. Finish any upload before reloading. Your session will restore when connected.'}</p><button className="btn" onClick={() => void updateApp().catch(() => setError('Could not apply the update. Reconnect and try again.'))}>Reload to update</button>{!later && <button className="btn secondary" onClick={() => setLater(true)}>Later</button>}{error && <p role="alert">{error}</p>}</div>}
  </InstallContext.Provider>;
}
