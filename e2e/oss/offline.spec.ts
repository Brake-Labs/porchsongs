import { test, expect, type Page } from '@playwright/test';
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
async function waitForServiceWorker(page: Page): Promise<void> {
  // `ready` resolves once a worker is active; `controller` is only set once it has
  // claimed this page. Both matter: routing offline navigations needs a controller,
  // not merely an active worker.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
    timeout: 20_000,
  });
}

/** Uuids of the charts in the offline mirror (IndexedDB), read from the page. */
async function mirroredUuids(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('porchsongs-offline');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('songs')) {
            db.close();
            resolve([]);
            return;
          }
          const keys = db.transaction('songs').objectStore('songs').getAllKeys();
          keys.onsuccess = () => {
            db.close();
            resolve(keys.result as string[]);
          };
        };
        req.onerror = () => resolve([]);
      }),
  );
}

async function waitForMirrored(page: Page, uuids: string[]): Promise<void> {
  await expect
    .poll(async () => {
      const have = new Set(await mirroredUuids(page));
      return uuids.filter((u) => !have.has(u)).length;
    }, { timeout: 20_000 })
    .toBe(0);
}

interface SeededSong {
  id: number;
  uuid: string;
  line: string;
}

/**
 * Removes what seedLibrary created. The e2e database is shared by every spec, and a
 * second profile left behind changes which profile the smoke test sees first.
 */
let pendingCleanup: (() => Promise<void>) | null = null;

/**
 * A library bigger than any cache cap in the build (the pdf.js runtime cache keeps
 * 8), with its last chart in a second profile.
 */
async function seedLibrary(baseURL: string, count: number): Promise<SeededSong[]> {
  const profileId = await getDefaultProfileId(baseURL);
  const res = await fetch(`${baseURL}/api/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_default: false }),
  });
  if (!res.ok) throw new Error(`Failed to create profile: ${res.status}`);
  const second = (await res.json()) as { id: number };

  const seeded: SeededSong[] = [];
  const stamp = Date.now();
  for (let i = 0; i < count; i++) {
    const line = `offline line ${stamp}-${i}`;
    const created = await createSongViaApi(baseURL, {
      profile_id: i === count - 1 ? second.id : profileId,
      title: `Offline ${stamp}-${i}`,
      artist: 'Offline Band',
      original_content: line,
      rewritten_content: `[G]${line}`,
    });
    seeded.push({ id: created.id as number, uuid: created.uuid as string, line });
  }
  pendingCleanup = async () => {
    for (const song of seeded) {
      await fetch(`${baseURL}/api/songs/${song.uuid}`, { method: 'DELETE' });
    }
    await fetch(`${baseURL}/api/profiles/${second.id}`, { method: 'DELETE' });
  };
  return seeded;
}

const LIBRARY_SIZE = 25;

test.describe('OSS Offline', () => {
  test.afterEach(async () => {
    await pendingCleanup?.();
    pendingCleanup = null;
  });

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

  test('renders the app while the webfont host is unreachable', async ({ page }) => {
    // Issue #274: the iOS PWA showed a blank screen on launch before it loaded.
    //
    // A cross-origin stylesheet in <head> blocks first paint until its request
    // settles, and index.html links Google Fonts. Once the service worker landed,
    // every local asset came out of the precache in single-digit milliseconds, so
    // that one request was the only thing left between the user and a rendered
    // page. On a home-screen launch with a cold or absent radio it can take many
    // seconds to give up, and the app painted nothing for the whole wait.
    //
    // index.html parks the link at media="print" and src/lib/webfonts.ts promotes
    // it on load. This is the browser-level check that the wiring holds; no unit
    // test can observe render blocking.
    let markRequested!: () => void;
    const requested = new Promise<void>((resolve) => {
      markRequested = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Hold the stylesheet open the way an unreachable host does.
    await page.route('https://fonts.googleapis.com/**', async (route) => {
      markRequested();
      await released;
      await route.abort('failed');
    });

    try {
      await page.goto('/app', { waitUntil: 'commit' });
      // The stylesheet is in flight...
      await requested;
      // ...and the app renders anyway, rather than waiting it out.
      await waitForAppReady(page);
    } finally {
      release();
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

  test('every chart in the library opens offline, across profiles', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const songs = await seedLibrary(baseURL!, LIBRARY_SIZE);

    await page.goto('/app');
    await waitForAppReady(page);
    await waitForServiceWorker(page);
    await waitForMirrored(page, songs.map((s) => s.uuid));
    // The import tab lists one profile's songs. That list used to prune the mirror,
    // evicting every chart in any other profile.
    await navigateToTab(page, 'Import');
    await expect(page).toHaveURL(/\/app\/rewrite/);
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);
    try {
      for (const song of songs) {
        await page.goto(`/app/play/${song.uuid}`);
        await expect(page.getByText(song.line).first()).toBeVisible({ timeout: 10_000 });
      }
      // An old /app/library/:id bookmark carries a numeric id, not a uuid.
      const first = songs[0]!;
      await page.goto(`/app/library/${first.id}`);
      await expect(page.getByText(first.line).first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await context.setOffline(false);
    }
  });

  test('a session opened straight onto a chart mirrors the whole library', async ({
    page,
    context,
    baseURL,
  }) => {
    const songs = await seedLibrary(baseURL!, 5);
    const [opened, other] = [songs[0]!, songs[3]!];

    // Never visits the library tab, which used to be the only thing that mirrored
    // every chart. A PWA relaunch into a chart, or a shared link, looks like this.
    await page.goto(`/app/play/${opened.uuid}`);
    await expect(page.getByText(opened.line).first()).toBeVisible();
    await waitForServiceWorker(page);
    await waitForMirrored(page, songs.map((s) => s.uuid));

    await context.setOffline(true);
    try {
      await page.goto(`/app/play/${other.uuid}`);
      await expect(page.getByText(other.line).first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await context.setOffline(false);
    }
  });

});
