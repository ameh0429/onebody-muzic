import { env } from 'node:process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({ plugins: [react(), tailwind(), VitePWA({ registerType: 'prompt', manifest: { name: 'OnebodyMusic', short_name: 'OnebodyMusic', description: 'One church. One sound. Your worship library and rehearsal companion.', theme_color: '#12675b', background_color: '#f7f9f6', display: 'standalone', start_url: '/', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] }, workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'], navigateFallbackDenylist: [/^\/api(?:\/|$)/], runtimeCaching: [], cleanupOutdatedCaches: true } })], server: { port: 5173, proxy: { '/api': { target: env.VITE_DEV_API_TARGET || 'http://localhost:3000', changeOrigin: true } } } });
