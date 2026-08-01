import type { AuthConfig, AuthUser } from '@/types';

/**
 * Just enough identity to boot the app with no connection.
 *
 * Without this, offline support cannot work at all, whatever is cached:
 *
 *  - `getAuthConfig()` is a bare fetch. Offline it rejects, AuthContext catches and
 *    leaves `authConfig` null, and `isPremiumAuth(null)` is false, so a premium
 *    install silently renders as OSS: the root route redirects into the app, the
 *    model picker appears, and the default settings tab changes.
 *  - The access token is a module variable that is never persisted, and the only way
 *    to mint a new one is `POST /api/auth/refresh`, which needs the network. So after
 *    an offline reload there is no credential and no local record of being signed in.
 *
 * Nothing secret is stored here. The refresh token already lives in localStorage; the
 * snapshot below is the user's own id, email, and name, which they can see anyway.
 * It is a hint for rendering, never an authorisation decision: every request still
 * carries a real token, and the server is still the only thing that grants access.
 */

const CONFIG_KEY = 'porchsongs_auth_config';
const USER_KEY = 'porchsongs_auth_user';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Corrupt or unavailable storage must never break boot.
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private-browsing. Offline simply will not work; online is unaffected.
  }
}

export function rememberAuthConfig(config: AuthConfig): void {
  write(CONFIG_KEY, config);
}

/** The last successfully fetched auth config, for use when the fetch fails. */
export function lastKnownAuthConfig(): AuthConfig | null {
  return read<AuthConfig>(CONFIG_KEY);
}

export function rememberUser(user: AuthUser): void {
  write(USER_KEY, user);
}

/** The last signed-in user, for rendering while offline. Not an auth decision. */
export function lastKnownUser(): AuthUser | null {
  return read<AuthUser>(USER_KEY);
}

/**
 * Owner id for the offline store, or null when nothing should be cached.
 *
 * OSS runs single-user with no accounts at all: `config.required` is false, no
 * session is ever restored, and there is no AuthUser to key on. Without a stable
 * owner for that case the mirror is never written and offline silently does nothing
 * for every self-hosted install.
 *
 * Premium is the opposite: when auth IS required and no user is known, caching would
 * risk attributing one person's charts to another, so it returns null instead.
 */
const OSS_SINGLE_USER = 0;

export function currentOwnerId(): number | null {
  const user = lastKnownUser();
  if (user) return user.id;
  const config = lastKnownAuthConfig();
  if (config && !config.required) return OSS_SINGLE_USER;
  return null;
}

export function forgetIdentity(): void {
  try {
    localStorage.removeItem(USER_KEY);
    // The auth config is not user data and is the same for every visitor, so it is
    // deliberately kept across logout: it is what lets the login page render
    // correctly when someone opens the app offline after signing out.
  } catch {
    /* ignore */
  }
}

/**
 * Whether a failure looks like "the network is gone" rather than a real error.
 *
 * openapi-fetch rethrows fetch's raw TypeError and never runs its response hooks, so
 * a dropped connection arrives here as a TypeError rather than an ApiError with a
 * status. Distinguishing the two matters: falling back to the mirror on a 401 would
 * show a signed-out user somebody else's cached charts.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const status = (err as { status?: number } | undefined)?.status;
  if (typeof status === 'number') return false;
  const message = (err as Error | undefined)?.message ?? '';
  return /network|fetch|load failed|connection/i.test(message);
}
