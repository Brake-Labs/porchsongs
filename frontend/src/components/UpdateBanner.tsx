import { useEffect, useRef, useState } from 'react';
import { currentWebBuildId, isWebUpdateAvailable } from '@/lib/webBuildId';
import { applyUpdate, checkForUpdate, onNeedRefresh, needsRefresh } from '@/lib/registerSW';

// Re-check cadence floor. Visibility flips can arrive in bursts (iOS fires
// several when a PWA resumes); one request per window is plenty.
const CHECK_THROTTLE_MS = 30_000;

async function fetchServerBuildId(): Promise<string | null | undefined> {
  try {
    // `no-store`: the staleness check must never read a cached build id, or it
    // could miss the very deploy it exists to catch.
    const res = await fetch('/api/web-build-id', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { web_build_id?: string | null };
    return data.web_build_id ?? null;
  } catch {
    return undefined;
  }
}

/**
 * "A new version is available, reload" banner. A deploy swaps the bundle under
 * every connected client; a long-lived page (especially an installed PWA, which
 * has no refresh affordance on iOS) keeps running the old code until reloaded.
 * Compares this page's own entry-bundle hash against the server's reported build
 * id on mount, whenever the tab becomes visible or comes back online, and
 * immediately when a lazy chunk fails to load (`vite:preloadError`, the classic
 * stale-deploy signature).
 */
export default function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const lastCheckRef = useRef(0);

  useEffect(() => {
    const ownId = currentWebBuildId();
    // Vite dev server (no hashed entry): nothing to compare.
    if (!ownId) return;
    let cancelled = false;

    const check = async (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastCheckRef.current < CHECK_THROTTLE_MS) return;
      lastCheckRef.current = now;
      const serverId = await fetchServerBuildId();
      if (cancelled) return;
      if (isWebUpdateAvailable(ownId, serverId)) {
        // Ask the SW to fetch the new build before showing the banner. Without this
        // the banner can appear while the worker is still serving the old precached
        // shell, and clicking Reload would do nothing.
        void checkForUpdate();
        setUpdateAvailable(true);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check(false);
    };
    const onOnline = () => void check(false);
    // A failed dynamic import means the chunk this page wants no longer exists
    // on the server: the bundle changed underneath us. Surface the banner
    // without waiting for the next visibility flip.
    const onPreloadError = () => void check(true);

    void check(true);
    if (needsRefresh()) setUpdateAvailable(true);
    const offNeedRefresh = onNeedRefresh(() => setUpdateAvailable(true));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => {
      cancelled = true;
      offNeedRefresh();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('vite:preloadError', onPreloadError);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      aria-label="Update available"
      className="fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-3 bg-primary text-white px-4 py-2 text-sm font-ui shadow-md"
    >
      <span>A new version of porchsongs is available.</span>
      <button
        type="button"
        onClick={() => void applyUpdate()}
        className="font-semibold underline underline-offset-2 hover:opacity-80 cursor-pointer"
      >
        Reload
      </button>
    </div>
  );
}
