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
  /**
   * Path prefixes that light this tab up, defaulting to `[path]`.
   *
   * A surface with detail pages under it needs this: /app/friends/dave has to
   * keep Friends lit rather than falling through to the library. OSS used to
   * hardcode '/app/admin' in its own matcher for exactly this reason, which
   * meant every premium surface needed an OSS change to become highlightable.
   */
  match?: string[];
  /**
   * Rendered beside the label. A node rather than a number, so the extension
   * owns whatever it takes to know the count: this is called during render and
   * cannot fetch, but the node it returns can.
   */
  badge?: ReactNode;
}

export function getExtraTopLevelTabs(_isPremium: boolean, _isAdmin: boolean): TopLevelTab[] {
  return [];
}

/**
 * Extra routes inside the authenticated shell, at /app/<something>.
 *
 * `getPremiumRouteElements` covers the marketing site, which is outside /app and
 * outside auth. This is the counterpart for surfaces that live *in* the app.
 *
 * It exists so a new premium screen is a premium change. The admin panel got its
 * own hardcoded `<Route path="admin/*">` in OSS, and repeating that per surface
 * makes the OSS repo carry a list of things it does not have.
 */
export function getPremiumAppRoutes(): ReactNode {
  return null;
}

export function getAdminPageElement(): ReactNode {
  return <Navigate to="/app" replace />;
}
