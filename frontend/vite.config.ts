import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Three cache tiers per DESIGN.md §5: app shell (precache), coefficient data
// (CacheFirst — immutable per month), short-TTL API responses (SWR so panels
// render instantly from cache and refresh in the background).
export default defineConfig(({ mode }) => {
  // Not VITE_-prefixed on purpose: read here (Node side, for the dev tile
  // proxy below) and never exposed to client code via import.meta.env — same
  // treatment the Caddyfile gives it in Docker (frontend/README: set it in
  // frontend/.env, gitignored).
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['coeff/*.txt', 'p533/*'],
        manifest: {
          name: 'Skywave',
          short_name: 'Skywave',
          description:
            'Self-hosted, offline-capable HF propagation & space weather dashboard',
          theme_color: '#0b1220',
          background_color: '#0b1220',
          display: 'standalone',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,wasm,bin,txt}'],
          maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
          runtimeCaching: [
            {
              // Monthly ionospheric data — immutable once published
              urlPattern: /\/data\/ionos\d{2}\.bin$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'ionos-data',
                expiration: { maxEntries: 2 },
              },
            },
            {
              // Short-TTL API data: serve cached immediately, refresh behind.
              // Panels show their own "last updated" staleness badge (§9).
              urlPattern: /\/api\//,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'api-cache',
                // Sized for every JSON endpoint plus the 8 sun-image channels;
                // eviction here silently breaks offline degradation (§9).
                expiration: { maxEntries: 64, maxAgeSeconds: 7 * 24 * 3600 },
              },
            },
          ],
        },
      }),
    ],
    server: {
      proxy: {
        '/api': 'http://localhost:8000',
        // Mirrors the Caddyfile's /tiles/* proxy so the dev server also
        // serves the CARTO basemap same-origin with the key attached
        // server-side (set CARTO_API_KEY in frontend/.env — gitignored).
        '/tiles': {
          target: 'https://basemaps.cartocdn.com',
          changeOrigin: true,
          rewrite: (path) =>
            `/dark_all${path.replace(/^\/tiles/, '')}${
              env.CARTO_API_KEY ? `?key=${env.CARTO_API_KEY}` : ''
            }`,
        },
      },
    },
  };
});
