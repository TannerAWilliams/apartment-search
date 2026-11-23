// Service worker for alert notifications. It caches nothing, so the app always loads current code and
// listings from the Worker; it only shows pushed alerts and opens the app when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let alert = {};
  try { alert = event.data ? event.data.json() : {}; } catch { alert = {}; }
  const title = typeof alert.title === 'string' ? alert.title : 'Apartment Search';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof alert.body === 'string' ? alert.body : 'A saved search has new matches.',
    tag: typeof alert.tag === 'string' ? alert.tag : undefined,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: typeof alert.url === 'string' && alert.url.startsWith('/') ? alert.url : '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find((client) => client.url.startsWith(self.location.origin));
    return open ? open.focus().then((client) => client.navigate(url)) : self.clients.openWindow(url);
  }));
});
