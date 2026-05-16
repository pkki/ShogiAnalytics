import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

// Injected at build time by VitePWA
precacheAndRoute(self.__WB_MANIFEST);

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
