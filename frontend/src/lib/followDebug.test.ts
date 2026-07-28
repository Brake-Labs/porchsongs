import { isFollowDebugEnabled } from './followDebug';

describe('isFollowDebugEnabled', () => {
  it('is enabled only when the followdebug query param is present', () => {
    expect(isFollowDebugEnabled('?followdebug')).toBe(true);
    expect(isFollowDebugEnabled('?followdebug=1')).toBe(true);
    expect(isFollowDebugEnabled('?foo=bar')).toBe(false);
    expect(isFollowDebugEnabled('')).toBe(false);
  });
});
