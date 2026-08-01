import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import App from '@/App';
import { getPremiumProviders } from '@/extensions';
import { registerServiceWorker } from '@/lib/registerSW';
import './index.css';

// Registered via the plugin's virtual module rather than an inline script, because
// the production CSP is `script-src 'self'` with no nonce. `registerSW` also gives us
// the one update mechanism the app uses: see UpdateBanner, which calls the returned
// updater instead of location.reload(). A precached index.html means a plain reload
// re-serves the same stale shell, so the banner could never clear itself.
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          {/* Inside AuthProvider so premium providers can read auth state. */}
          {getPremiumProviders({ children: <App /> })}
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
