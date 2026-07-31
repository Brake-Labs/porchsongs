import { describe, it, expect } from 'vitest';
import { _extractErrorType, isProviderError } from '@/api';

/**
 * The premium guard middleware and the OSS backend describe errors differently:
 *
 *   OSS      -> { detail: { detail: "...", error_type: "gateway_not_configured" } }
 *   premium  -> { detail: { error: "max_songs_exceeded", message: "...", ... } }
 *
 * `_extractErrorType` only read `error_type`, so every premium guard error
 * surfaced with `errorType === undefined`. The only way left to recognise one was
 * substring matching its English `message`, which coupled the upgrade affordances
 * to exact prose and broke silently on any copy edit.
 *
 * Tested directly rather than through an `api.*` call: the shared client is built
 * at module load with `baseUrl: ''` (api-client.ts), and undici cannot construct a
 * Request from a relative URL under jsdom, so a stubbed fetch is never reached.
 * See the note in lib/api-client.test.ts, which builds its own client for the same
 * reason. The `_throwApiError` wiring that assigns this onto `ApiError.errorType`
 * is unchanged by this commit.
 */
describe('_extractErrorType', () => {
  it('reads the premium guard shape (detail.error)', () => {
    expect(
      _extractErrorType({
        detail: {
          error: 'max_songs_exceeded',
          error_type: 'max_songs_exceeded',
          message: 'Your Free plan allows up to 40 songs. Upgrade for more.',
          current: 40,
          limit: 40,
        },
      }),
    ).toBe('max_songs_exceeded');
  });

  it('reads detail.error even when error_type is absent', () => {
    // Any guard body predating the change that emits both keys.
    expect(
      _extractErrorType({
        detail: {
          error: 'quota_exceeded',
          message: 'AI credit limit reached. Upgrade your plan for more credits.',
          credits_used: 200,
          credits_limit: 200,
        },
      }),
    ).toBe('quota_exceeded');
  });

  it.each([
    'max_songs_exceeded',
    'max_profiles_exceeded',
    'quota_exceeded',
    'rate_limited',
    'service_at_capacity',
    'content_too_large',
    'image_too_large',
  ])('recognises the %s guard slug', (slug) => {
    expect(_extractErrorType({ detail: { error: slug, message: 'irrelevant prose' } })).toBe(slug);
  });

  it('still reads the OSS shape (detail.error_type)', () => {
    expect(
      _extractErrorType({
        detail: {
          detail: 'No AI gateway is configured. Set LLM_API_BASE on the server.',
          error_type: 'gateway_not_configured',
        },
      }),
    ).toBe('gateway_not_configured');
  });

  it('reads a top-level error_type', () => {
    expect(_extractErrorType({ error_type: 'provider_timeout' })).toBe('provider_timeout');
  });

  it('prefers error_type when a body carries both and they disagree', () => {
    expect(
      _extractErrorType({
        detail: { error_type: 'specific_type', error: 'generic_error', message: 'boom' },
      }),
    ).toBe('specific_type');
  });

  it('returns undefined for a plain string detail', () => {
    expect(_extractErrorType({ detail: 'Internal Server Error' })).toBeUndefined();
  });

  it('returns undefined when neither key is present', () => {
    expect(_extractErrorType({ detail: { message: 'no slug here' } })).toBeUndefined();
    expect(_extractErrorType({})).toBeUndefined();
  });

  it('does not throw on a null detail', () => {
    // typeof null === 'object', so this guards a real crash path.
    expect(_extractErrorType({ detail: null })).toBeUndefined();
  });

  it.each([
    ['a nested object', { type: 'x', message: 'y' }],
    ['a boolean', true],
    ['a number', 42],
    ['an array', ['a', 'b']],
  ])('ignores a non-string detail.error (%s)', (_label, value) => {
    // Consumers do errorType.startsWith('provider_'), which throws on a
    // non-string. `{"error": {...}}` bodies already exist upstream, so this is a
    // real crash path, not a hypothetical one.
    expect(_extractErrorType({ detail: { error: value } })).toBeUndefined();
  });

  it('skips a non-string error_type and uses a valid error slug', () => {
    expect(
      _extractErrorType({ detail: { error_type: { nested: true }, error: 'quota_exceeded' } }),
    ).toBe('quota_exceeded');
  });

  it('feeds isProviderError, which keys off the provider_ prefix', () => {
    const err = Object.assign(new Error('upstream'), {
      errorType: _extractErrorType({ detail: { error_type: 'provider_rate_limit' } }),
    });
    expect(isProviderError(err)).toBe(true);

    const guardErr = Object.assign(new Error('cap'), {
      errorType: _extractErrorType({ detail: { error: 'max_songs_exceeded' } }),
    });
    expect(isProviderError(guardErr)).toBe(false);
  });
});
