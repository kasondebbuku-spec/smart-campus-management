"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createApiClient, type ApiClient, type SessionUser } from "./api";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "signed-in"; user: SessionUser }
  | { status: "signed-out"; user: null };

type AuthContextValue = AuthState & {
  api: ApiClient;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  // One client for the whole app, so concurrent requests share a single token refresh.
  const api = useMemo(
    () =>
      createApiClient({
        onSession: (s) => setState(s ? { status: "signed-in", user: s.user } : { status: "signed-out", user: null }),
      }),
    [],
  );

  // On page load the access token is gone (it only lives in memory), so ask for a new one
  // using the refresh cookie. If that works, the user stays signed in across reloads.
  useEffect(() => {
    void api.refresh();
  }, [api]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      api,
      login: async (email, password) => (await api.login(email, password)).user,
      logout: () => api.logout().catch(() => undefined),
    }),
    [state, api],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
