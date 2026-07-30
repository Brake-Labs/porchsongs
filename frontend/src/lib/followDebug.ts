/**
 * Follow-mode debug gating. The diagnostics overlay is a development tool, not a
 * user feature, so it is off unless the URL opts in with `?followdebug`.
 */
export function isFollowDebugEnabled(search: string = window.location.search): boolean {
  try {
    return new URLSearchParams(search).has('followdebug');
  } catch {
    return false;
  }
}
