import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

// Injected at build time by VitePWA
precacheAndRoute(self.__WB_MANIFEST);

// vite-plugin-pwa の updateServiceWorker() から送られる SKIP_WAITING を処理
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Push 通知 ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'ShogiAnalytics', {
      body:  data.body  ?? '',
      icon:  '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      data:  { url: data.url ?? '/' },
      tag:   data.tag  ?? 'default',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus().then(c => c.navigate(url));
      return clients.openWindow(url);
    })
  );
});

// API/auth/socket routes — never cache, always go to network
registerRoute(
  ({ url }) => /^\/(api|auth|socket\.io)/.test(url.pathname),
  new NetworkOnly()
);

// Navigation handler: serve index.html from precache with COOP/COEP headers
// These headers make crossOriginIsolated=true, enabling SharedArrayBuffer for WASM
const navHandler = createHandlerBoundToURL('/index.html');

registerRoute(
  new NavigationRoute(
    async (params) => {
      const response = await navHandler(params);
      const headers = new Headers(response.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
    { denylist: [/^\/(api|auth|socket\.io|login|admin)\b/] }
  )
);
