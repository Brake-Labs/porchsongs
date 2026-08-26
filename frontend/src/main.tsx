import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import App from '@/App';
import { getPremiumProviders } from '@/extensions';
import { registerServiceWorker } from '@/lib/registerSW';
import { enableWebFonts } from '@/lib/webfonts';
import './index.css';

// The webfont stylesheet is parked at media="print" in index.html so it cannot
// block first paint; this applies it once it has downloaded. See webfonts.ts.
enableWebFonts();

// Registered via the plugin's virtual module rather than an inline script, because
// the production CSP is `script-src 'self'` with no nonce. `registerSW` also gives us
// the one update mechanism the app uses: see UpdateBanner, which calls the returned
// updater instead of location.reload(). A precached index.html means a plain reload
// re-serves the same stale shell, so the banner could never clear itself.
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* Location updates are not wrapped in startTransition. React Router's
          default wraps them, which makes them interruptible, and the library's
          search box drives its value off the URL: a keystroke arriving mid
          transition re-rendered the input with the stale value and React's
          controlled-input restore threw the character away. Measured in
          Chromium, typing 26 characters with no gap kept 2 of them; anything
          under a 15ms gap lost some. That is faster than a person types but
          well inside key auto-repeat and mobile IME bursts. */}
      <BrowserRouter unstable_useTransitions={false}>
        <AuthProvider>
          {/* Inside AuthProvider so premium providers can read auth state. */}
          {getPremiumProviders({ children: <App /> })}
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
