import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const desktopPath = /^\/computers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/desktop(?:\/|$)/;

/**
 * Bumped whenever the icons change: browsers and installed apps keep icons by address (favicon caches, Android's
 * installed app, the service worker's precache), so a new address is what makes them fetch the new art. index.html
 * carries the same version.
 */
const ICONS = '?v=2';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // Registered by src/lib/pwa.ts (an import, not an inline script: the CSP allows only 'self' scripts).
      injectRegister: false,
      // globPatterns below already precache every icon.
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'Agent Swarm NG',
        short_name: 'Agent Swarm',
        description: 'Persistent AI agents that chat with you and each other and share computers.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#151515',
        background_color: '#242424',
        icons: [
          { src: `/icon-192.png${ICONS}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `/icon-512.png${ICONS}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `/icon.svg${ICONS}`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: `/icon-maskable-192.png${ICONS}`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: `/icon-maskable-512.png${ICONS}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,mp3}'],
        navigateFallbackDenylist: [/^\/api(?:\/|$)/, desktopPath],
        runtimeCaching: [],
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: (
      loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'DEV_ALLOWED_HOSTS').DEV_ALLOWED_HOSTS ?? ''
    )
      .split(',')
      .map(host => host.trim())
      .filter(Boolean),
    // The dev server can read the whole repository (/@fs/…): never its secrets, data or scratch files. It listens on
    // 127.0.0.1 (package.json) and must not be reachable from other machines.
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.local/**', '**/.scratch/**', '*.db', '*.db-*'],
    },
    // Avoid transforming partially written files during local edits.
    watch: { awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 25 } },
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000', ws: true } },
  },
  // `vite preview` checks the production build against the same backend.
  preview: {
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000', ws: true } },
  },
}));
