import { useEffect, useState, type ReactNode } from 'react';
export default function Connectivity({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return <><div className={`connection-status ${online ? '' : 'is-offline'}`} role="status">{online ? 'Online' : 'Offline — reconnect to access your music'}</div>
    {!online && <main className="offline-screen state" aria-labelledby="offline-title"><h1 id="offline-title">You’re offline</h1><p>OnebodyMusic is installed and ready. Connect to the internet to sign in, access your library, or play music.</p><p>Your private library and audio are never saved for offline use. Keep this page open; it will return when your connection is restored.</p><button className="btn" onClick={() => { if (navigator.onLine) { setOnline(true); location.reload(); } }}>Check connection</button></main>}
    <div hidden={!online}>{children}</div>
  </>;
}
