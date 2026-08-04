import { beforeEach, describe, expect, it } from 'vitest';
import { isFollowDebugEnabled, setFollowDebugEnabled } from './followDebug';

beforeEach(() => {
  localStorage.clear();
});

describe('isFollowDebugEnabled', () => {
  it('is enabled by the followdebug query param', () => {
    expect(isFollowDebugEnabled('?followdebug')).toBe(true);
    expect(isFollowDebugEnabled('?followdebug=1')).toBe(true);
  });

  it('is off with no param and nothing stored', () => {
    expect(isFollowDebugEnabled('?foo=bar')).toBe(false);
    expect(isFollowDebugEnabled('')).toBe(false);
  });

  it('persists once opted in, so it survives into an installed PWA', () => {
    // The reason this exists: an installed PWA launches at a fixed start_url with
    // no address bar, so a query param cannot be added on the device where the
    // interesting sessions actually happen.
    isFollowDebugEnabled('?followdebug');
    expect(isFollowDebugEnabled('')).toBe(true);
  });

  it('can be switched off again from a device with no address bar', () => {
    isFollowDebugEnabled('?followdebug');
    expect(isFollowDebugEnabled('?followdebug=off')).toBe(false);
    // And the persisted flag is cleared, not just this call.
    expect(isFollowDebugEnabled('')).toBe(false);
  });

  it('treats 0 and false as off as well', () => {
    isFollowDebugEnabled('?followdebug');
    expect(isFollowDebugEnabled('?followdebug=0')).toBe(false);
    isFollowDebugEnabled('?followdebug');
    expect(isFollowDebugEnabled('?followdebug=false')).toBe(false);
  });

  it('can be set directly without a URL', () => {
    setFollowDebugEnabled(true);
    expect(isFollowDebugEnabled('')).toBe(true);
    setFollowDebugEnabled(false);
    expect(isFollowDebugEnabled('')).toBe(false);
  });

  it('does not throw when storage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      // Private browsing blocks storage; the query param must still work and the
      // read must not throw into a render.
      expect(isFollowDebugEnabled('?followdebug')).toBe(true);
      expect(isFollowDebugEnabled('')).toBe(false);
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
