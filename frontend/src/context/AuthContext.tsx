import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { verifyTokenOffline, verifyTokenOnline } from '../api/unifiedAuth';
import { clearSession, getStoredSession, saveSession, type UnifiedAuthSession } from '../services/unifiedAuth';

export interface AuthUser {
  username: string;
  role: string;
  display_name: string | null;
  account_id?: string;
  auth_source?: string;
  expires_at?: string | null;
  verify_mode?: 'online' | 'offline';
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  session: UnifiedAuthSession | null;
  authReady: boolean;
  login: (token: string, user: AuthUser) => void;
  setUnifiedSession: (session: UnifiedAuthSession) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const readUser = (): AuthUser | null => {
  const saved = localStorage.getItem('user');
  return saved ? JSON.parse(saved) : null;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  session: null,
  authReady: false,
  login: () => {},
  setUnifiedSession: () => {},
  logout: () => {},
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [user, setUser] = useState<AuthUser | null>(readUser);
  const [session, setSession] = useState<UnifiedAuthSession | null>(getStoredSession);
  const [authReady, setAuthReady] = useState(false);

  const loginFn = (newToken: string, newUser: AuthUser) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const setUnifiedSession = (nextSession: UnifiedAuthSession) => {
    saveSession(nextSession);
    setSession(nextSession);
    setToken(nextSession.token);
    // Read user back from what saveSession wrote (single source of truth)
    setUser(readUser());
  };

  const logoutFn = () => {
    clearSession();
    setToken(null);
    setUser(null);
    setSession(null);
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      // Skip bootstrap on auth callback page — let AuthCallback handle session
      if (window.location.pathname.startsWith('/auth/callback')) {
        setAuthReady(true);
        return;
      }

      const storedSession = getStoredSession();
      const storedToken = localStorage.getItem('token');
      if (!storedSession || !storedToken) {
        setAuthReady(true);
        return;
      }

      try {
        // Timeout protection: don't let bootstrap hang forever
        const verifyWithTimeout = Promise.race([
          verifyTokenOnline(storedToken).catch(async () => {
            const offline = await verifyTokenOffline(storedToken);
            return { ...offline, mode: 'offline' as const };
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        const verified = await verifyWithTimeout;

        if (cancelled) return;

        const nextSession: UnifiedAuthSession = {
          ...storedSession,
          token: storedToken,
          account_id: verified.account_id || storedSession.account_id,
          expires_at: verified.expires_at ?? storedSession.expires_at,
          verify_mode: verified.mode === 'offline' ? 'offline' : 'online',
          offline_validated_at: verified.mode === 'offline' ? new Date().toISOString() : null,
        };

        saveSession(nextSession);
        setSession(nextSession);
        setToken(nextSession.token);
        const storedUser = readUser();
        if (storedUser) {
          setUser(storedUser);
        } else {
          const authUser: AuthUser = {
            username: nextSession.account_id || 'wechat_user',
            role: 'user',
            display_name: null,
            account_id: nextSession.account_id,
            auth_source: nextSession.source || 'auth-platform',
            expires_at: nextSession.expires_at,
            verify_mode: nextSession.verify_mode as 'online' | 'offline' | undefined,
          };
          localStorage.setItem('user', JSON.stringify(authUser));
          setUser(authUser);
        }
      } catch {
        if (!cancelled) {
          clearSession();
          setToken(null);
          setUser(null);
          setSession(null);
        }
      } finally {
        if (!cancelled) {
          setAuthReady(true);
        }
      }
    };

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({
    user,
    token,
    session,
    authReady,
    login: loginFn,
    setUnifiedSession,
    logout: logoutFn,
    isAuthenticated: !!token && !!user,
  }), [authReady, session, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
