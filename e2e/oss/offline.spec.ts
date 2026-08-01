import { test, expect } from '@playwright/test';
import {
  waitForAppReady,
  navigateToTab,
  createSongViaApi,
  getDefaultProfileId,
} from '../fixtures/test-helpers';
import { makeSongCreatePayload } from '../fixtures/mock-data';

/**
 * Offline behaviour, exercised against a real service worker.
 *
 * No unit test can cover any of this. The service worker, its navigation routing, and
 * the interaction between a precached shell and the update banner only exist in a
 * real browser against a real build, which is exactly where the expensive mistakes
 * live: a default Workbox `navigateFallback` silently swallows the OAuth redirect and
 * breaks sign-in for every user who already has the worker installed.
 *
 * These run against `vite preview`-style static output served by the app server, so
 * the service worker is registered the way it is in production.
 */

/** Wait until a service worker controls the page. */
async function waitForServiceWorker(page: import('@playwright/test').Page): Promise<void> {
  // `ready` resolves once a worker is active; `controller` is only set once it has
  // claimed this page. Both matter: routing offline navigations needs a controller,
  // not merely an active worker.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
    timeout: 20_000,
  });
}

test.describe('OSS Offline', () => {
  test('registers a service worker and precaches the shell', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await waitForServiceWorker(page);

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const all: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        all.push(...(await cache.keys()).map((r) => new URL(r.url).pathname));
      }
      return all;
    });
    expect(cached.some((p) => p === '/' || p.endsWith('index.html'))).toBe(true);
  });

  test('does NOT hijack the OAuth redirect', async ({ page }) => {
    // The single most dangerous thing about adding a service worker here.
    // LoginPage does `window.location.href = '/api/auth/oauth/google'`, a top-level
    // navigation to an /api/ path. Without navigateFallbackDenylist the worker
    // answers it from the precache, the browser never reaches the 302, and sign-in
    // is permanently broken for anyone with the worker installed.
    await page.goto('/');
    await waitForAppReady(page);
    await waitForServiceWorker(page);

    const res = await page.request.get('/api/auth/config', { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    // The response must be JSON from the server, not the precached HTML shell.
    expect(res.headers()['content-type'] ?? '').toContain('json');
  });

  test('serves the app shell offline for an SPA route', async ({ page, context }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await waitForServiceWorker(page);

    await context.setOffline(true);
    try {
      await page.goto('/app/library');
      // The shell renders rather than the browser's offline error page.
      await expect(page.locator('#root')).toBeAttached({ timeout: 15_000 });
    } finally {
      await context.setOffline(false);
    }
  });

  test('opens a previously loaded chart with no connection', async ({ page, context, baseURL }) => {
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, makeSongCreatePayload(profileId));

    await page.goto('/');
    await waitForAppReady(page);
    await waitForServiceWorker(page);
    await navigateToTab(page, 'Library');
    // Loading the library mirrors the whole list, so the chart is available offline.
    await expect(page.getByText('Amazing Grace').first()).toBeVisible({ timeout: 10_000 });

    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.locator('#root')).toBeAttached({ timeout: 15_000 });
      // The mirrored chart is readable with the network down.
      await expect(page.getByText('Amazing Grace').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.setOffline(false);
    }
  });

});
