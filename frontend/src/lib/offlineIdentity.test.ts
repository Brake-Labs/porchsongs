import { describe, it, expect, beforeEach } from 'vitest';
import {
  currentOwnerId,
  forgetIdentity,
  isNetworkFailure,
  lastKnownAuthConfig,
  lastKnownUser,
  rememberAuthConfig,
  rememberUser,
} from '@/lib/offlineIdentity';
import type { AuthConfig, AuthUser } from '@/types';

const CONFIG = { required: true, provider: 'google' } as unknown as AuthConfig;
const USER = { id: 7, email: 'a@b.c', name: 'A' } as unknown as AuthUser;

beforeEach(() => localStorage.clear());

describe('remembered auth config', () => {
  it('round-trips', () => {
    rememberAuthConfig(CONFIG);
    expect(lastKnownAuthConfig()).toEqual(CONFIG);
  });

  it('is null before anything is stored', () => {
    expect(lastKnownAuthConfig()).toBeNull();
  });

  it('survives corrupt storage without throwing', () => {
    // Boot must never break on bad localStorage.
    localStorage.setItem('porchsongs_auth_config', '{not json');
    expect(lastKnownAuthConfig()).toBeNull();
  });

  it('is kept across logout', () => {
    // It is not user data, and it is what lets the login page render correctly when
    // someone opens the app offline after signing out.
    rememberAuthConfig(CONFIG);
    rememberUser(USER);
    forgetIdentity();
    expect(lastKnownUser()).toBeNull();
    expect(lastKnownAuthConfig()).toEqual(CONFIG);
  });
});

describe('remembered user', () => {
  it('round-trips and is forgotten on logout', () => {
    rememberUser(USER);
    expect(lastKnownUser()).toEqual(USER);
    forgetIdentity();
    expect(lastKnownUser()).toBeNull();
  });
});

describe('isNetworkFailure', () => {
  it('treats a raw TypeError as a network failure', () => {
    // openapi-fetch rethrows fetch's TypeError and never runs its response hooks, so
    // this is what a dropped connection actually looks like at the call site.
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('does NOT treat an HTTP error as a network failure', () => {
    // The important negative case. Falling back to the mirror on a 401 would show a
    // signed-out user a cached library.
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    expect(isNetworkFailure(err)).toBe(false);
  });

  it.each([403, 404, 500])('does not fall back on a %d', (status) => {
    expect(isNetworkFailure(Object.assign(new Error('nope'), { status }))).toBe(false);
  });

  it('recognises network wording when no status is present', () => {
    expect(isNetworkFailure(new Error('NetworkError when attempting to fetch'))).toBe(true);
    expect(isNetworkFailure(new Error('Load failed'))).toBe(true);
  });

  it('does not treat an ordinary error as a network failure', () => {
    expect(isNetworkFailure(new Error('Something went wrong'))).toBe(false);
  });
});

describe('currentOwnerId', () => {
  it('uses the signed-in user id when there is one', () => {
    rememberUser(USER);
    expect(currentOwnerId()).toBe(7);
  });

  it('falls back to a stable single-user owner in OSS mode', () => {
    // OSS has no accounts: config.required is false, no session is restored, and
    // there is no AuthUser. Without this, the mirror is never written and offline
    // silently does nothing for every self-hosted install. Caught by the offline e2e.
    rememberAuthConfig({ required: false } as unknown as AuthConfig);
    expect(currentOwnerId()).toBe(0);
  });

  it('refuses to pick an owner when auth is required but nobody is known', () => {
    // Caching here would risk attributing one person's charts to another.
    rememberAuthConfig(CONFIG);
    expect(currentOwnerId()).toBeNull();
  });

  it('is null before anything at all is known', () => {
    expect(currentOwnerId()).toBeNull();
  });
});
