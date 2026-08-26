import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Spinner from '@/components/ui/spinner';
import NotFoundPage from '@/components/NotFoundPage';
import ErrorBoundary from '@/components/ErrorBoundary';
import AppShell from '@/layouts/AppShell';
import UpdateBanner from '@/components/UpdateBanner';
import RewriteTab from '@/components/RewriteTab';
import LibraryTab from '@/components/LibraryTab';
import PlayPage from '@/pages/PlayPage';
import ChordsPage from '@/pages/ChordsPage';
import SettingsPage from '@/components/SettingsPage';
import { useAuth } from '@/contexts/AuthContext';
import {
  getLoginPageElement,
  getPremiumRouteElements,
  getDefaultSettingsTab,
  getAdminPageElement,
  shouldRedirectRootToApp,
} from '@/extensions';

/** Redirects legacy routes like /library/:id to /app/library/:id */
function LegacyRedirect({ prefix }: { prefix: string }) {
  const params = useParams();
  const suffix = params['*'] ?? Object.values(params)[0] ?? '';
  return <Navigate to={`${prefix}/${suffix}`} replace />;
}

export default function App() {
  const { authState, isPremium } = useAuth();

  if (authState === 'loading') {
    return (
      <>
        <UpdateBanner />
        <div className="flex flex-col items-center justify-center min-h-screen gap-3 text-muted-foreground">
          <Spinner />
          <span className="text-sm">Loading...</span>
        </div>
      </>
    );
  }

  return (
    <>
    <UpdateBanner />
    <Routes>
      {/* Premium route elements (marketing pages, etc.) */}
      {getPremiumRouteElements()}

      {/* Login: OSS redirects to /app, premium renders its LoginPage */}
      <Route path="/app/login" element={getLoginPageElement()} />

      {/* Authenticated app */}
      <Route path="/app" element={<AppShell />}>
        {/* Library is the front door: the app is for playing charts you already have. */}
        <Route index element={<Navigate to="/app/library" replace />} />
        <Route path="rewrite" element={<ErrorBoundary fallbackLabel="Rewrite"><RewriteTab /></ErrorBoundary>} />
        <Route path="library" element={<ErrorBoundary fallbackLabel="Library"><LibraryTab /></ErrorBoundary>} />
        <Route path="library/:id" element={<ErrorBoundary fallbackLabel="Library"><LibraryTab /></ErrorBoundary>} />
        {/* Chord dictionary. The chord is in the path so a shape can be linked and
            bookmarked; premium serves the same page publicly under /chords. */}
        <Route path="chords" element={<ErrorBoundary fallbackLabel="Chords"><ChordsPage /></ErrorBoundary>} />
        <Route path="chords/:instrument" element={<ErrorBoundary fallbackLabel="Chords"><ChordsPage /></ErrorBoundary>} />
        <Route path="chords/:instrument/:chord" element={<ErrorBoundary fallbackLabel="Chords"><ChordsPage /></ErrorBoundary>} />
        {/* Playing a chart is a destination, not a mode inside the library.
            AppShell renders this path without header, tabs, or footer. */}
        <Route path="play/:uuid" element={<ErrorBoundary fallbackLabel="Play"><PlayPage /></ErrorBoundary>} />
        <Route path="settings/:tab" element={<ErrorBoundary fallbackLabel="Settings"><SettingsPage /></ErrorBoundary>} />
        <Route path="settings" element={<Navigate to={`/app/settings/${getDefaultSettingsTab(isPremium)}`} replace />} />
        {/* Splat, so the admin surface can own everything below /app/admin and route
            its own sections and detail pages. An exact `admin` path matched only
            /app/admin and dropped anything deeper into the 404 below, which forced
            the panel to keep its sections in component state and made a per-user
            detail page unreachable. Harmless in OSS, where `getAdminPageElement`
            redirects to /app, so the splat just redirects a wider set of paths. */}
        <Route path="admin/*" element={<ErrorBoundary fallbackLabel="Admin">{getAdminPageElement()}</ErrorBoundary>} />
      </Route>

      {/* OSS root redirects to app; premium root handled by extension routes */}
      {shouldRedirectRootToApp(isPremium) && <Route path="/" element={<Navigate to="/app" replace />} />}

      {/* Legacy routes redirect to new paths */}
      <Route path="/rewrite" element={<Navigate to="/app/rewrite" replace />} />
      <Route path="/library" element={<Navigate to="/app/library" replace />} />
      <Route path="/library/:id" element={<LegacyRedirect prefix="/app/library" />} />
      <Route path="/settings" element={<Navigate to="/app/settings" replace />} />
      <Route path="/settings/:tab" element={<LegacyRedirect prefix="/app/settings" />} />

      {/* 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </>
  );
}
