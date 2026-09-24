import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const desktopPath = /^\/computers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/desktop(?:\/|$)/;

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'prompt',
    manifest: {
      name: 'Agent Swarm NG',
      short_name: 'Agent Swarm NG',
      start_url: '/',
      display: 'standalone',
      theme_color: '#151515',
      background_color: '#242424',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,woff2,mp3}'],
      navigateFallbackDenylist: [/^\/api(?:\/|$)/, desktopPath],
      runtimeCaching: [],
    },
  })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: (loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'DEV_ALLOWED_HOSTS').DEV_ALLOWED_HOSTS ?? '')
      .split(',').map(host => host.trim()).filter(Boolean),
    // Avoid transforming partially written files during local edits.
    watch: { awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 25 } },
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000' } },
  },
}));
