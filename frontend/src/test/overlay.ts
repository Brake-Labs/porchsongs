import * as extensionsApi from '@/extensions/api';

/**
 * True when the tests run against the premium overlay rather than the OSS stubs.
 *
 * prepare-frontend.sh copies premium's `extensions/` over OSS's, and every other
 * test file runs unchanged against whichever copy is present. A test asserting
 * what an OSS stub returns (no Admin tab, a redirect instead of a login page)
 * guards that assertion with this rather than being shadowed by a premium copy,
 * because a shadowed test silently stops running the OSS fixes it was written for.
 *
 * Discriminated on a premium-only export rather than an env var so it works
 * identically in both CIs with no configuration.
 */
export const IS_PREMIUM_OVERLAY = 'verifyCheckoutSession' in extensionsApi;
