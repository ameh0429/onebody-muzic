/* Generic payloads only: never cache inbox contents or authentication tokens. */
self.addEventListener('push', event => {
  let tag = 'onebodymusic';
  try { tag = event.data.json().tag || tag; } catch { /* Empty payload. */ }
  event.waitUntil(self.registration.showNotification('OnebodyMusic', {
    body: 'You have a new notification. Open the app to view it.',
    icon: '/icon-192.png', badge: '/icon-192.png', tag, data: { url: '/notifications' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('/notifications', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && 'navigate' in client) {
        await client.navigate(target); return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
