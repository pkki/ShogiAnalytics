import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    // SharedArrayBuffer (WASM) に必要な COOP/COEP を /login 以外に適用
    // /login に same-origin を付けると Google Sign-In の gsi/transform が止まる
    {
      name: 'coop-coep-except-login',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = (req.url || '').split('?')[0];
          if (path !== '/login') {
            res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
          }
          next();
        });
      },
    },
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: '将棋アナリティクス',
        short_name: '将棋解析',
        description: '将棋の棋譜を解析・共有するアプリ',
        lang: 'ja',
        theme_color: '#111827',
        background_color: '#111827',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/app',
        scope: '/',
        icons: [
          { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          {
            src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        // API・Socket.io はキャッシュせず常にネットワーク経由
        // /login はサーバー側で COOP ヘッダーを除外しているが SW のキャッシュが上書きするため除外
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/socket\.io/, /^\/login/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api') ||
              url.pathname.startsWith('/auth') ||
              url.pathname.startsWith('/socket.io'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    host: true,          // LAN の他デバイスからも Vite dev にアクセス可能
    port: 5173,
    // SharedArrayBuffer (WASM マルチスレッド) に必要なヘッダー
    // /login は Google Sign-In が COOP: same-origin で止まるため除外
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (path !== '/login') {
          res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        }
        next();
      });
    },
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:3010',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react';
          if (id.includes('node_modules/lucide-react')) return 'vendor-ui';
          if (id.includes('node_modules/socket.io-client')) return 'vendor-socket';
        },
      },
    },
  },
})
