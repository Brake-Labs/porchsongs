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

/** How long to wait for the new worker to take control before reloading anyway. */
const CONTROL_TIMEOUT_MS = 3_000;

/**
 * Resolve to the waiting worker, waiting out an in-flight install first.
 *
 * `registration.update()` resolving does not mean a new worker is ready: if one was
 * found it still has to install, and it only lands in `waiting` at the end of that.
 */
async function waitForWaitingWorker(
  reg: ServiceWorkerRegistration,
): Promise<ServiceWorker | null> {
  if (reg.waiting) return reg.waiting;
  const installing = reg.installing;
  if (!installing) return null;
  await new Promise<void>(resolve => {
    const onStateChange = () => {
      if (installing.state === 'installed' || installing.state === 'redundant') {
        installing.removeEventListener('statechange', onStateChange);
        resolve();
      }
    };
    installing.addEventListener('statechange', onStateChange);
    // Never hang the button on a worker that stalls mid-install.
    window.setTimeout(() => {
      installing.removeEventListener('statechange', onStateChange);
      resolve();
    }, CONTROL_TIMEOUT_MS);
  });
  return reg.waiting ?? null;
}

/**
 * Activate a waiting worker and reload onto the new shell.
 *
 * This does more than call `updateSW(true)` because that call is not enough, and the
 * shape of vite-plugin-pwa's `prompt` mode is why. Its `updateServiceWorker` ignores
 * its `reloadPage` argument entirely and only sends SKIP_WAITING; the reload comes
 * from a `controlling` listener that it attaches *inside* the handler for the
 * `waiting` event. So when the banner is raised by the build-id check rather than by
 * `onNeedRefresh`, there is no waiting worker to message and no listener to reload,
 * and the button does nothing at all. That was the reported bug, and it is not
 * browser-specific: it is whatever state the page happens to be in when clicked.
 *
 * So: ask for an update and wait for the answer, activate a worker if one is now
 * waiting, and reload regardless. The button must never be inert.
 */
export async function applyUpdate(): Promise<void> {
  _needRefresh = false;
  const reg = _registration;
  if (!_updateSW || !reg) {
    // No service worker at all, which is also the right path for a browser that
    // does not support them or has them disabled (Firefox private windows).
    window.location.reload();
    return;
  }

  // The banner can be shown before the worker has even looked for a new build,
  // because UpdateBanner fires this check without awaiting it.
  try {
    await reg.update();
  } catch {
    /* offline, or the update check failed; fall through and decide on what we have */
  }

  const waiting = await waitForWaitingWorker(reg);
  if (!waiting) {
    // Nothing to activate. Reload anyway rather than leave the click unanswered:
    // worst case the page comes back on the same build and the banner returns,
    // which is still an honest outcome and not a dead button.
    window.location.reload();
    return;
  }

  // Reload once the new worker takes control. A timeout backs this up, because a
  // SKIP_WAITING that is somehow not honoured must not strand the user either.
  let reloaded = false;
  const reloadOnce = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
  window.setTimeout(reloadOnce, CONTROL_TIMEOUT_MS);

  await _updateSW(true);
}
