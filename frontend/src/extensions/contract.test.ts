import { describe, it, expect } from 'vitest';
import * as barrel from '@/extensions';
import * as auth from '@/extensions/auth';
import * as routes from '@/extensions/routes';
import * as settings from '@/extensions/settings';
import * as quota from '@/extensions/quota';
import * as extensionsApi from '@/extensions/api';
import * as feedback from '@/extensions/feedback';

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
    'uploadFollowLog',
  ],
  feedback: ['FeedbackButton'],
};

/** Everything the barrel must re-export, flattened from the manifest. */
const BARREL_EXPORTS = Object.values(MANIFEST).flat().sort();

/**
 * Members that exist only in the premium copy, and are therefore allowed to be
 * absent from OSS.
 *
 * The contract is a floor, not an equality: OSS code can only import what BOTH
 * copies export, so the failure that actually breaks a build is a manifest member
 * missing from one side. A premium-only helper is harmless because it ships
 * together with the premium code that uses it.
 *
 * This list is an allowlist so the drift stays deliberate and visible rather than
 * accumulating silently, which is how these three got here in the first place.
 * `getCatchAllRedirect` is imported by nothing and should be deleted.
 */
const PREMIUM_ONLY = [
  'getCatchAllRedirect',
  'notifyQuotaChanged',
  'deleteAccount',
  'verifyCheckoutSession',
];

/**
 * True when running against the premium overlay rather than the OSS stubs.
 *
 * This file is shared: prepare-frontend.sh copies premium's extensions over the
 * OSS ones, and this test is not shadowed, so it executes against whichever
 * implementation is present. The export-shape assertions apply to both. The
 * inertness assertions describe the OSS stubs specifically, because in premium
 * these same functions correctly render real UI and fetch real data.
 *
 * Discriminated on a premium-only export rather than an env var so it works
 * identically in both CIs with no configuration.
 */
const IS_PREMIUM_OVERLAY = 'verifyCheckoutSession' in extensionsApi;

const MODULES: Record<string, Record<string, unknown>> = {
  auth,
  routes,
  settings,
  quota,
  api: extensionsApi,
  feedback,
};

/** Runtime value exports only. Types vanish at runtime and cannot be compared. */
function valueExports(mod: Record<string, unknown>): string[] {
  return Object.keys(mod)
    .filter((k) => k !== 'default' && k !== '__esModule')
    .sort();
}

describe('extensions seam contract', () => {
  describe.each(Object.entries(MANIFEST))('module %s', (name, members) => {
    it('exports every manifest member', () => {
      const exported = valueExports(MODULES[name] ?? {});
      for (const member of members) {
        expect(exported, `'${member}' is missing from extensions/${name}`).toContain(member);
      }
    });

    it('exports nothing undocumented', () => {
      const allowed = new Set([...members, ...PREMIUM_ONLY]);
      const extras = valueExports(MODULES[name] ?? {}).filter((k) => !allowed.has(k));
      expect(extras, `undocumented exports in extensions/${name}`).toEqual([]);
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

  it('the barrel exports nothing undocumented', () => {
    // Catches a new premium-only export leaking into the shared surface without
    // being declared, which is how the three in PREMIUM_ONLY got here.
    const allowed = new Set([...BARREL_EXPORTS, ...PREMIUM_ONLY]);
    const extras = valueExports(barrel as unknown as Record<string, unknown>).filter(
      (k) => !allowed.has(k),
    );
    expect(extras, 'undocumented exports in extensions/index.ts').toEqual([]);
  });

  // Skipped under the premium overlay: these assert the OSS stubs are inert, and
  // premium's implementations of the same members render real UI by design.
  describe.skipIf(IS_PREMIUM_OVERLAY)('OSS stubs are inert and total (rule 1)', () => {
    it('component stubs render nothing', () => {
      expect(quota.QuotaBanner()).toBeNull();
      expect(quota.QuotaUpgradeLink({})).toBeNull();
      expect(quota.SongCapNotice({ count: 0 })).toBeNull();
      expect(feedback.FeedbackButton()).toBeNull();
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
