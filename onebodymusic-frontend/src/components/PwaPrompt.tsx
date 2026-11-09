import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
export default function PwaPrompt() { const [ready, setReady] = useState(false); const [apply, setApply] = useState<(() => void) | null>(null);
  useEffect(() => { const update = registerSW({ onNeedRefresh: () => setReady(true), onRegisterError: () => undefined }); setApply(() => () => { if (confirm('Reload for the update? You will need to sign in again. Finish any upload first.')) void update(true); }); }, []);
  return ready && <div className="pwa-prompt" role="status"><span>A fresh version is ready.</span><button className="btn" onClick={() => apply?.()}>Update</button><button className="btn secondary" onClick={() => setReady(false)}>Later</button></div>;
}
