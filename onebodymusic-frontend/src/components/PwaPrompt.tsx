import { useEffect, useState } from 'react';
import { subscribeUpdates, updateApp } from '../lib/pwa';
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
export default function PwaPrompt() {
  const [ready, setReady] = useState(false);
  const [later, setLater] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const [error, setError] = useState('');
  const ios = /iPad|iPhone|iPod/u.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
  return <aside className="pwa-controls" aria-label="App installation and updates">
    {!installed && <details className="pwa-install"><summary>Install OnebodyMusic</summary>
      {install && <button className="btn" onClick={() => void requestInstall()}>Install app</button>}
      <p>{ios ? 'In Safari, tap Share, then Add to Home Screen and Add. If using another browser, open this page in Safari first.' : 'In Chrome or Edge, choose Install app from the address bar or browser menu when available. Installation requires HTTPS. You can also keep using the app in your browser.'}</p>
      {error && <p role="alert">{error}</p>}
    </details>}
    {ready && <div className="pwa-update" role="status"><p>{later ? 'An update is waiting.' : 'A new OnebodyMusic version is ready. Finish any upload before reloading. Your session will restore when connected.'}</p><button className="btn" onClick={() => void updateApp().catch(() => setError('Could not apply the update. Reconnect and try again.'))}>Reload to update</button>{!later && <button className="btn secondary" onClick={() => setLater(true)}>Later</button>}{error && <p role="alert">{error}</p>}</div>}
  </aside>;
}
