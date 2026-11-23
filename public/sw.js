// Kora PWA Service Worker — iOS 16.4+ / Android / Desktop Push & Notifications
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle real Web Push payloads (iOS Home Screen PWA / Desktop / Android)
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Rowav',
    body: 'Nouvelle notification Rowav',
    tag: 'rowav-push',
    url: '/',
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch {
    if (event.data) {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag || 'rowav-push',
      renotify: true,
      data: { url: payload.url || '/' },
    })
  );
});

// Allow client app to dispatch native PWA notifications reliably on iOS
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg && msg.type === 'SHOW_NOTIFICATION' && msg.payload) {
    const { title, body, tag, url } = msg.payload;
    event.waitUntil(
      self.registration.showNotification(title || 'Rowav', {
        body: body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: tag || 'rowav-local',
        renotify: true,
        data: { url: url || '/' },
      })
    );
  }
});

// Focus or open Kora PWA when user taps a notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
