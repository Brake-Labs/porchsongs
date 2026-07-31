import { describe, it, expect } from 'vitest';
import * as barrel from '@/extensions';
import * as auth from '@/extensions/auth';
import * as routes from '@/extensions/routes';
import * as settings from '@/extensions/settings';
import * as quota from '@/extensions/quota';
import * as extensionsApi from '@/extensions/api';

/**
 * Enforces the OSS <-> premium extensions contract. See ./README.md.
 *
 * Both repos carry a copy of every file in this directory, and
 * prepare-frontend.sh overlays the premium copies on top of the OSS ones. If the
 * two surfaces diverge, the merged build fails typecheck, and only premium CI
 * ever sees the merged build. This test runs in both repos, so a divergence is
 * caught in whichever repo introduced it.
 *
 * When a member is added or removed, update MANIFEST and both copies in the same
 * change. A deliberate rename is a two-repo change by definition.
 *
 * This file must be identical in both repos.
 */
const MANIFEST: Record<string, string[]> = {
  auth: ['isPremiumAuth'],
  routes: [
    'getAdminPageElement',
    'getDefaultSettingsTab',
    'getExtraTopLevelTabs',
    'getFeatureRequestUrl',
    'getLoginPageElement',
    'getPremiumProviders',
    'getPremiumRouteElements',
    'getReportIssueUrl',
    'shouldRedirectRootToApp',
  ],
  settings: ['getExtraSettingsTabs', 'renderPremiumSettingsTab', 'showOssSettingsTabs'],
  quota: [
    'OnboardingBanner',
    'QuotaBanner',
    'QuotaUpgradeLink',
    'SongCapNotice',
    'UsageFooter',
    'isQuotaError',
    'useReadOnly',
  ],
  api: [
    'createCheckout',
    'createPortal',
    'getSubscription',
    'listPlans',
    'tryRestoreSession',
  ],
};

/** Everything the barrel must re-export, flattened from the manifest. */
const BARREL_EXPORTS = Object.values(MANIFEST).flat().sort();

const MODULES: Record<string, Record<string, unknown>> = {
  auth,
  routes,
  settings,
  quota,
  api: extensionsApi,
};

/** Runtime value exports only. Types vanish at runtime and cannot be compared. */
function valueExports(mod: Record<string, unknown>): string[] {
  return Object.keys(mod)
    .filter((k) => k !== 'default' && k !== '__esModule')
    .sort();
}

describe('extensions seam contract', () => {
  describe.each(Object.entries(MANIFEST))('module %s', (name, members) => {
    it('exports exactly the manifest members', () => {
      expect(valueExports(MODULES[name] ?? {})).toEqual([...members].sort());
    });
  });

  it('the barrel re-exports every member', () => {
    const exported = valueExports(barrel as unknown as Record<string, unknown>);
    // Every manifest member must be reachable from '@/extensions'. Rule 3 in
    // README.md: consumers import from the barrel, so a member missing here is
    // invisible to well-behaved call sites even though its module exports it.
    for (const member of BARREL_EXPORTS) {
      expect(exported, `'${member}' is missing from extensions/index.ts`).toContain(member);
    }
  });

  it('the barrel exports nothing beyond the manifest', () => {
    // Catches a premium-only export leaking into the shared surface, which is how
    // getCatchAllRedirect ended up existing in one repo and not the other.
    expect(valueExports(barrel as unknown as Record<string, unknown>)).toEqual(BARREL_EXPORTS);
  });

  describe('OSS stubs are inert and total (rule 1)', () => {
    it('component stubs render nothing', () => {
      expect(quota.QuotaBanner()).toBeNull();
      expect(quota.QuotaUpgradeLink({})).toBeNull();
      expect(quota.SongCapNotice({ count: 0 })).toBeNull();
    });

    it('hook stubs return the off value, never undefined', () => {
      expect(quota.useReadOnly()).toBe(false);
      expect(auth.isPremiumAuth(null)).toBe(false);
      expect(quota.isQuotaError('anything')).toBe(false);
    });

    it('passthrough stubs return their children unchanged', () => {
      const child = 'sentinel';
      expect(routes.getPremiumProviders({ children: child })).toBe(child);
      expect(quota.OnboardingBanner({ children: child })).toBe(child);
    });

    it('list stubs return an empty array', () => {
      expect(routes.getExtraTopLevelTabs(false, false)).toEqual([]);
      expect(settings.getExtraSettingsTabs(false, false)).toEqual([]);
    });

    it('no stub throws when called with no configuration', () => {
      // Totality is the point of rule 1: self-hosted porchsongs must work with no
      // premium layer, so every stub has to be callable in a bare environment.
      expect(() => routes.getPremiumRouteElements()).not.toThrow();
      expect(() => routes.getDefaultSettingsTab(false)).not.toThrow();
      expect(() => routes.shouldRedirectRootToApp(false)).not.toThrow();
      expect(() => routes.getFeatureRequestUrl()).not.toThrow();
      expect(() => routes.getReportIssueUrl()).not.toThrow();
      expect(() => routes.getAdminPageElement()).not.toThrow();
      expect(() => routes.getLoginPageElement()).not.toThrow();
      expect(() => settings.showOssSettingsTabs(false)).not.toThrow();
    });
  });
});
