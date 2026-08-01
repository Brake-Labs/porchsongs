/**
 * Service worker registration, and the app's single update mechanism.
 *
 * Two things previously competed to decide when a new build was live:
 *
 *  - UpdateBanner compares the hash in its own `<script type=module src>` against
 *    `GET /api/web-build-id`, fetched with `cache: 'no-store'` so it is always the
 *    server's current build.
 *  - The service worker precaches `index.html`.
 *
 * Together those deadlock. Navigations are served the precached shell, so the page
 * keeps booting the old entry bundle while the endpoint reports the new one, and
 * `location.reload()` re-serves the same stale shell. The banner would never clear.
 *
 * So the SW is the authority on shell updates: `applyUpdate()` activates the waiting
 * worker and reloads, and the build-id check is only a trigger that first asks the
 * registration to look for one.
 */

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

let _updateSW: UpdateSW | null = null;
let _registration: ServiceWorkerRegistration | null = null;
let _needRefresh = false;

const NEED_REFRESH_EVENT = 'porchsongs-sw-need-refresh';

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // Dynamic import so test and SSR environments never resolve the virtual module.
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      _updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          _needRefresh = true;
          window.dispatchEvent(new CustomEvent(NEED_REFRESH_EVENT));
        },
        onRegisteredSW(_url, registration) {
          _registration = registration ?? null;
        },
      });
    })
    .catch((err: unknown) => console.warn('[SW] registration failed', err));
}

/** True when a new build has been downloaded and is waiting to activate. */
export function needsRefresh(): boolean {
  return _needRefresh;
}

/** Subscribe to the SW reporting a waiting update. Returns an unsubscribe. */
export function onNeedRefresh(handler: () => void): () => void {
  window.addEventListener(NEED_REFRESH_EVENT, handler);
  return () => window.removeEventListener(NEED_REFRESH_EVENT, handler);
}

/**
 * Ask the browser to check for a new service worker.
 *
 * Called when `/api/web-build-id` reports a build we are not running, so the two
 * signals cooperate instead of racing.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    await _registration?.update();
  } catch {
    /* offline, or no registration yet */
  }
}

/**
 * Activate a waiting worker and reload onto the new shell.
 *
 * Falls back to a plain reload when there is no service worker at all, which is the
 * correct behaviour for a browser that does not support them.
 */
export async function applyUpdate(): Promise<void> {
  if (_updateSW) {
    _needRefresh = false;
    await _updateSW(true);
    return;
  }
  window.location.reload();
}
