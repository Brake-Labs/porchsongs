export async function tryRestoreSession(): Promise<null> {
  // OSS mode: no session to restore. Premium overrides this.
  return null;
}

export function getSubscription(): Promise<never> {
  throw new Error('Not available in OSS');
}

export function listPlans(): Promise<never> {
  throw new Error('Not available in OSS');
}

export function createCheckout(_plan: string): Promise<never> {
  throw new Error('Not available in OSS');
}

export function createPortal(): Promise<never> {
  throw new Error('Not available in OSS');
}

/**
 * Store a Follow diagnostic recording somewhere it can be read from another device.
 *
 * Inert in OSS: there is no server-side store to put it in, so callers fall back to
 * downloading the JSON. That fallback is the only option on a desktop anyway; the
 * reason this seam exists is that downloading a file on a phone, in an installed
 * PWA, and then getting it onto a laptop is not a workflow anyone completes.
 *
 * Returns false rather than throwing, because the caller's next move is to offer the
 * download instead, not to show an error.
 */
export async function uploadFollowLog(_recording: unknown): Promise<boolean> {
  return false;
}
