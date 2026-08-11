/**
 * Per-DEVICE Follow capture gating. The diagnostics overlay is a development tool,
 * not a user feature, so it is off unless something opts in.
 *
 * This is the self-hosted route, and the only one that works with no account
 * settings behind it: `?followdebug` for the desktop tab, persisted to localStorage
 * so opting in once survives into the installed PWA, where `start_url` is fixed at
 * /app and there is no address bar to add a query string to. `?followdebug=off` is
 * the way back out on a device with no address bar to edit.
 *
 * A deployment with accounts should prefer the per-ACCOUNT setting
 * (`useFollowCaptureEnabled` in the extensions seam): it follows the operator onto
 * whatever device they are about to reproduce the problem on, rather than having to
 * be armed on each one. PlayView honours either.
 */

const STORAGE_KEY = 'porchsongs_follow_debug';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private mode or blocked storage. The query param still works.
    return false;
  }
}

function writeStored(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do, and nothing that should throw into a render */
  }
}

/** Turn capture on or off for this device. Survives a reload and a PWA relaunch. */
export function setFollowDebugEnabled(on: boolean): void {
  writeStored(on);
}

export function isFollowDebugEnabled(search: string = window.location.search): boolean {
  let param: string | null = null;
  try {
    const params = new URLSearchParams(search);
    if (params.has('followdebug')) param = params.get('followdebug') ?? '';
  } catch {
    param = null;
  }

  if (param !== null) {
    const on = param !== 'off' && param !== '0' && param !== 'false';
    writeStored(on);
    return on;
  }

  return readStored();
}
