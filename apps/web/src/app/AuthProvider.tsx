import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AuthenticatedUserDTO } from "@veridi/shared";
import { UNAUTHENTICATED_EVENT } from "../lib/api";
import { fetchCurrentUser, logout as logoutRequest } from "../lib/auth-api";

interface AuthContextValue {
  user: AuthenticatedUserDTO | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Sessão do usuário no frontend.
 *
 * O token vive só no cookie HttpOnly — o React nunca vê nem guarda token.
 * Aqui existe apenas o usuário atual, resolvido por `GET /auth/me`. Um 401
 * em qualquer chamada dispara `UNAUTHENTICATED_EVENT`, e o app volta ao
 * Login de forma limpa, sem cada tela tratar isso por conta própria.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUserDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUser(await fetchCurrentUser());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleUnauthenticated = () => setUser(null);
    window.addEventListener(UNAUTHENTICATED_EVENT, handleUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, handleUnauthenticated);
  }, []);

  const signOut = useCallback(async () => {
    await logoutRequest();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return context;
}
