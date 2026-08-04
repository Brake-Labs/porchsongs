/**
 * Follow-mode debug gating. The diagnostics overlay is a development tool, not a
 * user feature, so it is off unless something opts in.
 *
 * Two ways in, for a reason. `?followdebug` is the quick desktop route. The
 * persisted flag exists because the interesting sessions happen on a phone, usually
 * an installed PWA, where `start_url` is fixed at /app and there is no address bar
 * to add a query string to. Without a persisted flag, diagnosing the case this
 * exists for was only possible on the machine least likely to reproduce it.
 *
 * `?followdebug` also turns the persisted flag ON, so opting in once from a browser
 * tab survives into the installed app, and `?followdebug=off` is the way back out on
 * a device with no address bar to edit.
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
