import { registerSW } from 'virtual:pwa-register';
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined;
let pending = false;
const subscribers = new Set<(value: boolean) => void>();
export function subscribeUpdates(listener: (value: boolean) => void) {
  subscribers.add(listener); listener(pending);
  if (!applyUpdate) {
    applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh() { pending = true; subscribers.forEach(notify => notify(true)); },
      onRegisteredSW(_url, registration) {
        if (!registration) return;
        const check = () => { if (navigator.onLine && document.visibilityState === 'visible') void registration.update().catch(() => undefined); };
        window.setInterval(check, 60 * 60 * 1000);
        window.addEventListener('online', check);
        document.addEventListener('visibilitychange', check);
      },
      onRegisterError() { /* The online app remains usable when SW registration is unavailable. */ },
    });
  }
  return () => { subscribers.delete(listener); };
}
export async function updateApp() { await applyUpdate?.(true); }
