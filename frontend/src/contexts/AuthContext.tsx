import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import api from '@/api';
import type { AuthConfig, AuthUser } from '@/types';
import { isPremiumAuth } from '@/extensions';
import {
  forgetIdentity,
  lastKnownAuthConfig,
  lastKnownUser,
  rememberAuthConfig,
  rememberUser,
} from '@/lib/offlineIdentity';
import * as offlineStore from '@/lib/offlineStore';

type AuthState = 'loading' | 'login' | 'ready';

interface AuthContextValue {
  authState: AuthState;
  authConfig: AuthConfig | null;
  currentAuthUser: AuthUser | null;
  isPremium: boolean;
  handleLogin: (user: AuthUser) => void;
  handleLogout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [currentAuthUser, setCurrentAuthUser] = useState<AuthUser | null>(null);

  const isPremium = isPremiumAuth(authConfig);

  // Check auth requirement on mount
  useEffect(() => {
    const bootstrap = (config: AuthConfig, fromCache: boolean) => {
      setAuthConfig(config);
      if (!config.required) {
        // OSS mode: no auth needed, immediately ready
        setAuthState('ready');
        return;
      }
      // Premium mode: try to restore existing session with timeout
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000));
      Promise.race([api.tryRestoreSession(), timeout]).then((user) => {
        if (user) {
          rememberUser(user);
          offlineStore.setOwner(user.id).catch(() => {});
          setCurrentAuthUser(user);
          setAuthState('ready');
          return;
        }
        // Restoring needs POST /api/auth/refresh, which cannot work offline. Falling
        // back to the login screen there would be wrong: the user is signed in, they
        // simply have no signal, and the login page cannot help them either. Render
        // the app from the remembered identity instead, degraded but usable.
        const remembered = fromCache ? lastKnownUser() : null;
        if (remembered) {
          setCurrentAuthUser(remembered);
          setAuthState('ready');
        } else {
          setAuthState('login');
        }
      });
    };

    api.getAuthConfig()
      .then((config) => {
        rememberAuthConfig(config);
        bootstrap(config, false);
      })
      .catch((err: unknown) => {
        // Previously this set authState='ready' with a null config, which makes
        // isPremiumAuth(null) false: a premium install then renders as OSS, with the
        // root route redirecting into the app and the model picker appearing.
        const cached = lastKnownAuthConfig();
        if (cached) {
          console.warn('[AuthContext] Using last known auth config (offline?):', err);
          bootstrap(cached, true);
        } else {
          console.error('[AuthContext] Failed to fetch auth config:', err);
          setAuthState('ready');
        }
      });
  }, []);

  // Listen for logout events (e.g. 401 from expired/changed token)
  useEffect(() => {
    const handler = () => {
      if (authConfig?.required) {
        api.logout();
        forgetIdentity();
        offlineStore.clear().catch(() => {});
        setCurrentAuthUser(null);
        setAuthState('login');
      }
    };
    window.addEventListener('porchsongs-logout', handler);
    return () => window.removeEventListener('porchsongs-logout', handler);
  }, [authConfig]);

  const handleLogout = useCallback(() => {
    api.logout();
    // Wipe the mirror too. IndexedDB is origin-scoped, so leaving it would show the
    // next person to sign in on a shared tablet the previous person's library.
    forgetIdentity();
    offlineStore.clear().catch(() => {});
    setCurrentAuthUser(null);
    if (isPremium) {
      window.location.href = '/';
    } else {
      setAuthState('login');
    }
  }, [isPremium]);

  const handleLogin = useCallback((user: AuthUser) => {
    setCurrentAuthUser(user);
    setAuthState('ready');
  }, []);

  return (
    <AuthContext value={{
      authState,
      authConfig,
      currentAuthUser,
      isPremium,
      handleLogin,
      handleLogout,
    }}>
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
