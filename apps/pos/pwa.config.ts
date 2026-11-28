/**
 * The installable, offline app shell (ARCH §7.6). The service worker stores the app's own files and
 * nothing else: all API traffic belongs to the sync engine.
 */
import type { VitePWAOptions } from 'vite-plugin-pwa';

export const THEME_COLOR = '#0f172a';
const BACKGROUND_COLOR = '#ffffff';

export const pwaOptions: Partial<VitePWAOptions> = {
  // A new version waits until the cashier asks for it, between sales.
  registerType: 'prompt',
  // `src/pwa/app-updater.ts` registers the worker, so the rules for reloading live in the app.
  injectRegister: false,
  // The icons are precached by the pattern below; this would list them a second time.
  includeManifestIcons: false,
  manifest: {
    id: '/',
    name: 'Apparel POS',
    short_name: 'Apparel POS',
    description: 'Offline-first point of sale for a clothing shop (demo).',
    lang: 'en-AU',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    icons: [
      { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      {
        src: 'maskable-icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    // The whole app shell, so any screen opens with no network.
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
    // A deep link such as /receipt/:id is the app too...
    navigateFallback: 'index.html',
    // ...but the API never is, even if it is served from the same origin.
    navigateFallbackDenylist: [/^\/v1(\/|\?|$)/],
    cleanupOutdatedCaches: true,
    // No `runtimeCaching`, `skipWaiting` or `clientsClaim`: nothing from the API is ever stored,
    // and a new version takes over only when asked.
  },
};
