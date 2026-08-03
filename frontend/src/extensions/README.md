# The extensions seam

This directory is the contract between open-source porchsongs and the hosted
premium layer. **Every file here exists twice**: once in this repo (inert) and
once in `porchsongs-premium/frontend/src/extensions/` (the real implementation).

Until this document existed the contract was undocumented, and the two copies had
already drifted. `contract.test.ts` now enforces it.

## How the overlay works

`porchsongs-premium/scripts/prepare-frontend.sh` runs, in effect:

```
cp -r porchsongs-premium/frontend/src/.  ->  porchsongs/frontend/src/
```

Premium sources land **on top of** OSS sources. Any file present at the same path
in both repos is silently replaced by the premium copy. That is the mechanism, and
it has three consequences worth internalising:

1. **A file at a shared path is a two-repo change.** Editing only the OSS copy
   has no effect on the hosted product, and editing only the premium copy has no
   effect on self-hosters.
2. **Adding a seam member is a two-step landing.** If OSS code imports a member
   the premium copy does not export yet, the premium `frontend` CI job fails
   typecheck the moment the OSS change reaches the ref it builds against. Land the
   premium side first, or land both together.
3. **Only premium CI can catch a mismatch.** OSS CI never sees the merged tree.

Currently shadowed paths (premium wins):

```
extensions/*                      components/LoginPage.tsx    test/setup.ts
components/CookieBanner.tsx       components/Tabs.test.tsx
components/LoginPage.test.tsx     layouts/MarketingLayout.tsx
pages/marketing/*                 data/howto-articles.ts
```

## Rules

**1. The OSS version must be inert and total.**
Never throw, never fetch, never require configuration. Return `null`, `false`,
`[]`, or the children unchanged. Self-hosted porchsongs must work fully without a
premium layer, so an OSS stub is a real implementation of "this feature is off",
not a placeholder.

**2. Both copies must export the same names.**
`contract.test.ts` asserts each module's export set against a checked-in manifest
and runs in both repos' CI. Add a member to the manifest and both copies in the
same change.

**3. Import from the barrel, not the module.**
Use `from '@/extensions'`, not `from '@/extensions/quota'`. Deep imports bypass
`index.ts`, which is the one place the two repos' surfaces are compared. Some
older call sites still deep-import; do not add more.

**4. UI stubs render nothing; hooks return the "off" value.**
A component stub returns `null`. A hook stub returns the falsy default. Do not
return `undefined` from a hook, since call sites destructure it.

**5. State belongs in a provider, not a module singleton.**
`getPremiumProviders` wraps the app so premium can supply context. If a new member
needs shared state, put it there. Do not fetch per call site, and do not
monkey-patch `window.fetch` (`quota.tsx` does this today for quota invalidation;
it is the pattern to replace, not to copy).

## Members

| Member | Module | OSS returns | Premium supplies |
| --- | --- | --- | --- |
| `isPremiumAuth` | `auth` | `false` | whether the auth config is premium |
| `tryRestoreSession` | `api` | no-op | silent OAuth session restore |
| `getSubscription`, `listPlans`, `createCheckout`, `createPortal` | `api` | throw/no-op | billing calls |
| `getPremiumRouteElements` | `routes` | `null` | marketing `<Route>` tree |
| `getPremiumProviders` | `routes` | children | subscription context provider |
| `getLoginPageElement` | `routes` | redirect to `/app` | the real login page |
| `getDefaultSettingsTab` | `routes` | `'models'` | `'account'` |
| `shouldRedirectRootToApp` | `routes` | `true` | `false` (marketing owns `/`) |
| `getFeatureRequestUrl`, `getReportIssueUrl` | `routes` | GitHub issue URLs | support mailtos |
| `getExtraTopLevelTabs` | `routes` | `[]` | the Admin tab |
| `getAdminPageElement` | `routes` | redirect to `/app` | the admin panel |
| `getExtraSettingsTabs`, `renderPremiumSettingsTab`, `showOssSettingsTabs` | `settings` | `[]`, `null`, `true` | the Account tab |
| `QuotaBanner` | `quota` | `null` | AI credit status |
| `OnboardingBanner` | `quota` | children | first-run welcome |
| `QuotaUpgradeLink` | `quota` | `null` | upgrade link |
| `isQuotaError` | `quota` | `false` | whether an error is quota related |
| `UsageFooter` | `quota` | token counts | token counts |
| `SongCapNotice` | `quota` | `null` | chart count and cap banner |
| `useReadOnly` | `quota` | `false` | whether the account is over its cap |
| `FeedbackButton` | `feedback` | `null` | header button and send-feedback dialog |

## Adding a member: worked example

Adding `useReadOnly`, a hook telling the UI the account may read but not write.

1. **OSS stub** in `quota.tsx`. Inert, total, documented with the rule consumers
   must follow:

   ```tsx
   export function useReadOnly(): boolean {
     return false;
   }
   ```

2. **Export from the barrel** in `index.ts`, alphabetically within its group.

3. **Add to the manifest** in `contract.test.ts`. Both repos' CI now require both
   copies to export it.

4. **Consume it** in OSS via `import { useReadOnly } from '@/extensions'`. Because
   the stub is total, OSS behaves as though the feature is off.

5. **Implement in premium**, reading context from `getPremiumProviders`.

Land step 5 before or with step 4. See consequence 2 above.
