import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import useIsStandalone from '@/hooks/useIsStandalone';

type LoginView = 'sign-in' | 'sign-up' | 'magic-link';

/**
 * Read auth_error from the URL hash fragment and clean the URL.
 * The OAuth callback redirects here with #auth_error=<encoded message>
 * when sign-in fails.
 */
function consumeAuthError(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#auth_error=')) return null;
  const encoded = hash.slice('#auth_error='.length);
  const message = decodeURIComponent(encoded);
  // Clean the hash so the error doesn't persist on refresh
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return message;
}

export default function LoginPage() {
  const { authConfig } = useAuth();
  const navigate = useNavigate();
  const isStandalone = useIsStandalone();
  const magicLinkAvailable = authConfig?.magic_link_enabled ?? false;
  // In standalone PWA mode, prefer magic link to avoid OAuth opening the system browser
  const [view, setView] = useState<LoginView>(
    isStandalone && magicLinkAvailable ? 'magic-link' : 'sign-in'
  );
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  // Magic link state
  const [magicLinkEmail, setMagicLinkEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [magicLinkIsSignUp, setMagicLinkIsSignUp] = useState(false);

  useEffect(() => {
    const error = consumeAuthError();
    if (error) setAuthError(error);
  }, []);

  const method = authConfig?.method ?? 'none';
  const requireInviteCode = authConfig?.require_invite_code ?? false;
  const openSignup = authConfig?.open_signup ?? false;
  const magicLinkEnabled = authConfig?.magic_link_enabled ?? false;
  // When open signup is active, the invite code is optional (users can sign up without one)
  const inviteCodeRequired = requireInviteCode && !openSignup;

  const isSignUp = view === 'sign-up';

  function handleGoogleSignIn() {
    if (isSignUp && inviteCode.trim()) {
      window.location.href = `/api/auth/oauth/google?invite_code=${encodeURIComponent(inviteCode)}`;
    } else {
      window.location.href = '/api/auth/oauth/google';
    }
  }

  async function handleMagicLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!magicLinkEmail.trim()) return;

    setMagicLinkLoading(true);
    setAuthError(null);
    try {
      const body: Record<string, string> = { email: magicLinkEmail.trim() };
      if (magicLinkIsSignUp && inviteCode.trim()) {
        body.invite_code = inviteCode.trim();
      }
      const resp = await fetch('/api/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        setMagicLinkSent(true);
      } else {
        setAuthError('Failed to send sign-in link. Please try again.');
      }
    } catch {
      setAuthError('Network error. Please check your connection and try again.');
    } finally {
      setMagicLinkLoading(false);
    }
  }

  function switchView(newView: LoginView) {
    if (newView === 'magic-link') {
      setMagicLinkIsSignUp(view === 'sign-up');
    }
    setView(newView);
    setTermsAccepted(false);
    setInviteCode('');
    setMagicLinkEmail('');
    setMagicLinkSent(false);
    setAuthError(null);
  }

  // In premium mode the primary login method is Google OAuth
  if (method === 'oauth_google') {
    // Magic link sent confirmation screen
    if (view === 'magic-link' && magicLinkSent) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <Card className="p-8 sm:p-10 w-full max-w-[360px] mx-4 text-center flex flex-col items-center gap-3 shadow-md">
            <img src="/logo.svg" alt="" className="w-16 h-16 mb-1" />
            <h1 className="text-2xl font-bold text-foreground">porchsongs</h1>
            <p className="text-sm text-muted-foreground mb-2">Check your email</p>
            <p className="text-sm text-muted-foreground">
              We sent a sign-in link to <strong>{magicLinkEmail}</strong>. Click the link in the email to sign in.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              The link expires in 10 minutes. Check your spam folder if you don&apos;t see it.
            </p>
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground underline mt-3"
              onClick={() => switchView('sign-in')}
            >
              Back to sign in
            </button>
          </Card>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="p-8 sm:p-10 w-full max-w-[360px] mx-4 text-center flex flex-col items-center gap-3 shadow-md">
          <img src="/logo.svg" alt="" className="w-16 h-16 mb-1" />
          <h1 className="text-2xl font-bold text-foreground">porchsongs</h1>
          <p className="text-sm text-muted-foreground mb-2">
            {(isSignUp || (view === 'magic-link' && magicLinkIsSignUp))
              ? 'Create your account'
              : 'Sign in to continue'}
          </p>

          {authError && (
            <div className="w-full rounded-md border border-error-border bg-error-bg px-3 py-2 text-sm text-error-text">
              {authError}
            </div>
          )}

          {isSignUp && (
            <>
              {(requireInviteCode || openSignup) && (
                <div className="w-full flex flex-col gap-1">
                  <Input
                    placeholder={inviteCodeRequired ? 'Invite code (e.g. PORCH-A1B2C3)' : 'Invite code (optional)'}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    aria-label="Invite code"
                  />
                  {!inviteCodeRequired && (
                    <p className="text-xs text-muted-foreground">
                      No invite code? No problem. Sign up is open.
                    </p>
                  )}
                </div>
              )}
              <label className="flex items-start gap-2 text-left text-sm text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  aria-label="Accept Terms and Privacy Policy"
                />
                <span>
                  I agree to the{' '}
                  <Link to="/terms" className="text-primary underline hover:opacity-80">Terms of Service</Link>
                  {' '}and{' '}
                  <Link to="/privacy" className="text-primary underline hover:opacity-80">Privacy Policy</Link>
                </span>
              </label>
            </>
          )}

          {isStandalone && view !== 'magic-link' && (
            <p className="text-xs text-warning-text bg-warning-bg border border-warning-border rounded-md px-3 py-2 w-full">
              Google sign-in will open your browser. After signing in, return to this app from your home screen.
              {magicLinkAvailable && ' Or use an email link below to stay in the app.'}
            </p>
          )}

          <Button
            className="w-full mt-1"
            disabled={isSignUp && (!termsAccepted || (inviteCodeRequired && !inviteCode.trim()))}
            onClick={handleGoogleSignIn}
          >
            {isSignUp ? 'Sign up with Google' : 'Sign in with Google'}
          </Button>

          {magicLinkEnabled && view !== 'magic-link' && (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground underline"
              onClick={() => switchView('magic-link')}
            >
              {isSignUp ? 'Sign up with email link' : 'Sign in with email link'}
            </button>
          )}

          {view === 'magic-link' && (
            <form onSubmit={handleMagicLinkSubmit} className="w-full flex flex-col gap-2 mt-1">
              <Input
                type="email"
                placeholder="you@example.com"
                value={magicLinkEmail}
                onChange={(e) => setMagicLinkEmail(e.target.value)}
                aria-label="Email address"
                required
              />
              {magicLinkIsSignUp && (requireInviteCode || openSignup) && (
                <div className="w-full flex flex-col gap-1">
                  <Input
                    placeholder={inviteCodeRequired ? 'Invite code (e.g. PORCH-A1B2C3)' : 'Invite code (optional)'}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    aria-label="Invite code"
                  />
                  {!inviteCodeRequired && (
                    <p className="text-xs text-muted-foreground">
                      No invite code? No problem. Sign up is open.
                    </p>
                  )}
                </div>
              )}
              <Button
                type="submit"
                variant="secondary"
                className="w-full"
                disabled={magicLinkLoading || !magicLinkEmail.trim()}
              >
                {magicLinkLoading ? 'Sending...' : 'Send sign-in link'}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                By continuing, you agree to the{' '}
                <Link to="/terms" className="text-primary underline hover:opacity-80">Terms</Link>
                {' '}and{' '}
                <Link to="/privacy" className="text-primary underline hover:opacity-80">Privacy Policy</Link>.
              </p>
            </form>
          )}

          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground underline mt-1"
            onClick={() => {
              const currentlySignUp = isSignUp || (view === 'magic-link' && magicLinkIsSignUp);
              switchView(currentlySignUp ? 'sign-in' : 'sign-up');
            }}
          >
            {(isSignUp || (view === 'magic-link' && magicLinkIsSignUp))
              ? 'Already have an account? Sign in'
              : "Don't have an account? Sign up"}
          </button>

          <a href="/" className="text-sm text-muted-foreground hover:text-foreground underline">
            Back to homepage
          </a>
        </Card>
      </div>
    );
  }

  // Fallback: redirect to app if no auth needed
  navigate('/app', { replace: true });
  return null;
}
