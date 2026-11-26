// Rowav Offline-First PWA Service Worker (iOS Safari / Home Screen PWA / Desktop / Android)
const BUILD_ID = '__ROWAV_BUILD_ID__';
const SHELL_CACHE = `rowav-shell-${BUILD_ID}`;
const COVERS_CACHE = 'rowav-covers-v1';
const FONTS_CACHE = 'rowav-fonts-v1';

const FALLBACK_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/kora-icon.svg',
];

async function precacheAppShell() {
  const cache = await caches.open(SHELL_CACHE);
  let urls = FALLBACK_SHELL_URLS;
  try {
    const res = await fetch('/precache-manifest.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.urls) && data.urls.length > 0) {
        urls = Array.from(new Set([...FALLBACK_SHELL_URLS, ...data.urls]));
      }
    }
  } catch {
    // Use fallback shell list if manifest fetch fails
  }

  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const req = new Request(url, { cache: 'reload' });
        const resp = await fetch(req);
        if (resp && resp.ok) {
          await cache.put(url, resp);
        }
      } catch {
        // Ignore individual asset failure so install always succeeds
      }
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheAppShell().then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k.startsWith('rowav-shell-') &&
                k !== SHELL_CACHE
            )
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Network-first with fast timeout for HTML navigations so Airplane Mode opens Rowav in 0ms
async function handleNavigationRequest(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const networkRes = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (networkRes && networkRes.ok) {
      cache.put('/index.html', networkRes.clone()).catch(() => {});
      return networkRes;
    }
  } catch {
    // Offline or timed out -> serve cached app shell immediately
  }
  const cachedIndex =
    (await cache.match('/index.html')) ||
    (await cache.match('/')) ||
    (await caches.match('/index.html')) ||
    (await caches.match('/'));
  if (cachedIndex) return cachedIndex;
  return new Response('Rowav hors-ligne : ouvre l’app une fois connecté pour activer le cache.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// Cache-first for immutable Vite hashed assets & static icons
async function handleStaticAsset(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkRes = await fetch(request);
    if (networkRes && (networkRes.ok || networkRes.type === 'opaque')) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkRes.clone()).catch(() => {});
    }
    return networkRes;
  } catch {
    return new Response('', { status: 504 });
  }
}

// Stale-while-revalidate for covers (/api/cover) and Google Fonts so artwork stays crisp offline
async function handleStaleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(request, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }
  const fresh = await fetchPromise;
  return fresh || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept Firebase, Google Drive APIs, or non-http schemes
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Cache Google Fonts cleanly for offline typography
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(handleStaleWhileRevalidate(request, FONTS_CACHE));
    return;
  }

  // Only handle same-origin requests beyond fonts
  if (url.origin !== self.location.origin) return;

  // Cache HD cover images (/api/cover) so project & track covers work offline too!
  if (url.pathname === '/api/cover') {
    event.respondWith(handleStaleWhileRevalidate(request, COVERS_CACHE));
    return;
  }

  // Skip all other live API endpoints (/api/drive, /api/social, /api/share, etc.)
  if (url.pathname.startsWith('/api/')) return;

  // Skip precache manifest itself so updates are always fresh
  if (url.pathname === '/precache-manifest.json' || url.pathname === '/sw.js') return;

  // HTML page navigations (including / and /?... routes) -> Offline-safe app shell
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // Static app bundles (/assets/*, icons, manifest) -> Cache-first for instant offline launch
  if (
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|css|png|jpg|jpeg|webp|svg|ico|webmanifest|woff2?)$/i.test(url.pathname)
  ) {
    event.respondWith(handleStaticAsset(request, SHELL_CACHE));
  }
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

// Focus or open Rowav PWA when user taps a notification
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
