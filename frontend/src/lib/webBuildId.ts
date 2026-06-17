// Frontend build identity, used to detect a stale client after a deploy swaps
// the bundle under a long-lived page. Installed PWAs are the motivating case:
// iOS resumes the same page for days with no refresh affordance, so without an
// explicit prompt a phone keeps running old code (and old bugs) indefinitely.
// See UpdateBanner.

/** The content-hashed entry bundle name (`index-<hash>.js`) this page booted
 *  from, read off its own `<script type="module">` tag. Returns null on the
 *  Vite dev server (entry is `/src/main.tsx`), which disables the staleness
 *  check there. */
export function currentWebBuildId(doc: Document = document): string | null {
  const scripts = doc.querySelectorAll<HTMLScriptElement>('script[type=module][src]');
  for (const script of Array.from(scripts)) {
    const m = script.src.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)(?:\?|$)/);
    if (m) return m[1]!;
  }
  return null;
}

/** True when the server reports a different entry bundle than the one this page
 *  booted from. Either side missing disables the check (dev server, or a server
 *  that doesn't report a build id). */
export function isWebUpdateAvailable(
  current: string | null,
  server: string | null | undefined,
): boolean {
  return !!current && !!server && current !== server;
}
