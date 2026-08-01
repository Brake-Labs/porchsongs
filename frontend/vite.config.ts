import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Workbox generates and revisions the precache manifest against Vite's hashed
      // output. The previous hand-rolled sw.js cached exactly one file and could not
      // have kept a list of hashed bundles correct by hand.
      registerType: 'prompt',
      // The registration script is imported by main.tsx instead of being injected
      // inline. security_headers.py sets `script-src 'self'` with no nonce, so an
      // inline registration is blocked IN PRODUCTION ONLY: it would pass every local
      // and CI check and ship a site with no service worker at all.
      injectRegister: null,
      // offline.html is deleted. Workbox takes a single navigateFallback, and it has
      // to be the SPA shell or offline play never renders at all.
      workbox: {
        // Claim uncontrolled clients on FIRST install, so offline works from the
        // first visit rather than only after a second load. This does not affect
        // upgrades: skipWaiting stays off, so a new build still waits for the user to
        // accept it via the update banner rather than swapping mid-session.
        clientsClaim: true,
        skipWaiting: false,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          // LOAD-BEARING. LoginPage does `window.location.href =
          // '/api/auth/oauth/google'`, a top-level navigation to an /api/ path. The
          // default NavigationRoute allowlist is [/./] with no denylist, so the SW
          // would answer that from the precache and the browser would never reach
          // the 302 to Google. Sign-in would break permanently for every user who
          // already has the SW installed. The old 30-line sw.js carried this same
          // guard with a comment saying exactly this.
          /^\/api\//,
          // Server-rendered, not part of the SPA.
          /^\/robots\.txt$/,
          /^\/sitemap\.xml$/,
          // Premium injects per-route meta into these server-side. A precached shell
          // would give repeat visitors the generic title instead.
          /^\/(pricing|about|terms|privacy)$/,
          /^\/how-to(\/|$)/,
        ],
        // Charts are mirrored in IndexedDB, not here; the API is never cached.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
      },
      manifest: false, // public/manifest.json is maintained by hand.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Override with VITE_API_PROXY when the backend runs on a non-default port
      // (e.g. VITE_API_PROXY=http://localhost:8001 for a docker-compose backend).
      '/api': process.env.VITE_API_PROXY || 'http://localhost:8000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
});
