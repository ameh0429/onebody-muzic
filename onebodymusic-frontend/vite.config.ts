import { env } from 'node:process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [react(), tailwind(), VitePWA({
    registerType: 'prompt', injectRegister: false,
    includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
    manifest: {
      id: '/', name: 'OnebodyMusic', short_name: 'OnebodyMusic', lang: 'en',
      description: 'One church. One sound. Your worship library and rehearsal companion.',
      theme_color: '#100e1f', background_color: '#100e1f', display: 'standalone',
      start_url: '/', scope: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      importScripts: ['/push-events.js'],
      // Explicit build-only allowlist: never add API, auth, artwork or audio runtime caches.
      globPatterns: ['index.html', 'assets/**/*.{js,css,woff2}', 'icon*.{png,svg}'],
      navigateFallback: 'index.html', navigateFallbackDenylist: [/^\/api(?:\/|$)/],
      runtimeCaching: [], cleanupOutdatedCaches: true,
      skipWaiting: false, clientsClaim: true,
    },
  })],
  server: { port: 5173, proxy: { '/api': { target: env.VITE_DEV_API_TARGET || 'http://localhost:3000', changeOrigin: true } } },
});
