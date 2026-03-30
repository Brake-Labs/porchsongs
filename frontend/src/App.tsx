import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Spinner from '@/components/ui/spinner';
import NotFoundPage from '@/components/NotFoundPage';
import ErrorBoundary from '@/components/ErrorBoundary';
import AppShell from '@/layouts/AppShell';
import RewriteTab from '@/components/RewriteTab';
import LibraryTab from '@/components/LibraryTab';
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
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 text-muted-foreground">
        <Spinner />
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <Routes>
      {/* Premium route elements (marketing pages, etc.) */}
      {getPremiumRouteElements()}

      {/* Login: OSS redirects to /app, premium renders its LoginPage */}
      <Route path="/app/login" element={getLoginPageElement()} />

      {/* Authenticated app */}
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="/app/rewrite" replace />} />
        <Route path="rewrite" element={<ErrorBoundary fallbackLabel="Rewrite"><RewriteTab /></ErrorBoundary>} />
        <Route path="library" element={<ErrorBoundary fallbackLabel="Library"><LibraryTab /></ErrorBoundary>} />
        <Route path="library/:id" element={<ErrorBoundary fallbackLabel="Library"><LibraryTab /></ErrorBoundary>} />
        <Route path="settings/:tab" element={<ErrorBoundary fallbackLabel="Settings"><SettingsPage /></ErrorBoundary>} />
        <Route path="settings" element={<Navigate to={`/app/settings/${getDefaultSettingsTab(isPremium)}`} replace />} />
        <Route path="admin" element={<ErrorBoundary fallbackLabel="Admin">{getAdminPageElement()}</ErrorBoundary>} />
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
  );
}
