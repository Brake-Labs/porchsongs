import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

export function getPremiumRouteElements(): ReactNode {
  return null;
}

/**
 * Wraps the whole app so the premium overlay can supply React context.
 *
 * OSS returns the children untouched. This exists because the only other
 * injection point, `getPremiumRouteElements`, returns `<Route>` elements and so
 * cannot provide context. Without a provider slot, any stateful seam member
 * (`useReadOnly`, for example) would have to either fetch per call site or hide a
 * module-level singleton, and the existing precedent for shared premium state is
 * monkey-patching `window.fetch`. Do not extend that.
 */
export function getPremiumProviders({ children }: { children: ReactNode }): ReactNode {
  return children;
}

export function getLoginPageElement(): ReactNode {
  // OSS has no login, redirect to app
  return <Navigate to="/app" replace />;
}

export function getDefaultSettingsTab(_isPremium: boolean): string {
  return 'models';
}

export function shouldRedirectRootToApp(_isPremium: boolean): boolean {
  return true;
}

export function getFeatureRequestUrl(): string {
  return 'https://github.com/Brake-Labs/porchsongs/issues/new?title=Feature+request:+&labels=enhancement';
}

export function getReportIssueUrl(): string {
  return 'https://github.com/Brake-Labs/porchsongs/issues/new?title=Bug:+&labels=bug';
}

export interface TopLevelTab {
  key: string;
  path: string;
  label: string;
}

export function getExtraTopLevelTabs(_isPremium: boolean, _isAdmin: boolean): TopLevelTab[] {
  return [];
}

export function getAdminPageElement(): ReactNode {
  return <Navigate to="/app" replace />;
}
