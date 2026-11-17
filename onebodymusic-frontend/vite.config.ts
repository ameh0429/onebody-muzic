import { env } from 'node:process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
// Use the same source artwork as BrandLogo; size each install icon explicitly.
const logoBase = 'https://res.cloudinary.com/dxpopimi3/image/upload';
const logoAsset = 'v1793571514/onebody-logo-removebg-preview_k4vg3x.png';
const installIcon = (size: number) => `${logoBase}/c_pad,w_${size},h_${size},b_transparent,f_png/${logoAsset}`;
// Keep the full logo inside the maskable icon's central safe zone.
const maskableIcon = `${logoBase}/c_fit,w_350,h_350/c_pad,w_512,h_512,b_rgb:100e1f,f_png/${logoAsset}`;

export default defineConfig({
  plugins: [react(), tailwind(), VitePWA({
    registerType: 'prompt', injectRegister: false,
    manifest: {
      id: '/', name: 'OnebodyMusic', short_name: 'OnebodyMusic', lang: 'en',
      description: 'One church. One sound. Your worship library and rehearsal companion.',
      theme_color: '#100e1f', background_color: '#100e1f', display: 'standalone',
      start_url: '/', scope: '/',
      icons: [
        { src: installIcon(192), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: installIcon(512), sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: maskableIcon, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
