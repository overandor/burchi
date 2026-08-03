"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { PublicClientApplication, AccountInfo, AuthenticationResult } from "@azure/msal-browser";
import { MsalProvider, useMsal, MsalAuthenticationTemplate } from "@azure/msal-react";
import { InteractionType } from "@azure/msal-browser";
import { getMsalConfig, GRAPH_SCOPES } from "@/lib/auth/msal-config";

interface AuthState {
  isAuthenticated: boolean;
  account: AccountInfo | null;
  accessToken: string | null;
  loading: boolean;
  error: string | null;
  login: () => void;
  logout: () => void;
  getValidToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState>({
  isAuthenticated: false,
  account: null,
  accessToken: null,
  loading: true,
  error: null,
  login: () => {},
  logout: () => {},
  getValidToken: async () => null,
});

export function useAuth() {
  return useContext(AuthContext);
}

function AuthContent({ children }: { children: React.ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const account = accounts[0] || null;
  const loading = inProgress !== "none" && !account;

  useEffect(() => {
    if (account) {
      instance
        .acquireTokenSilent({ scopes: GRAPH_SCOPES, account })
        .then((res: AuthenticationResult) => setAccessToken(res.accessToken))
        .catch(() => setAccessToken(null));
    }
  }, [account, instance]);

  const login = useCallback(() => {
    setError(null);
    instance
      .loginRedirect({ scopes: GRAPH_SCOPES, prompt: "select_account" })
      .catch((e: any) => {
        console.error("Login failed:", e);
        setError(e.message || "Login failed");
      });
  }, [instance]);

  const logout = useCallback(() => {
    sessionStorage.removeItem("msal-token");
    sessionStorage.removeItem("msal-user");
    instance.logoutRedirect({ account: account || undefined }).catch(() => {});
  }, [instance, account]);

  const getValidToken = useCallback(async (): Promise<string | null> => {
    if (!account) return null;
    try {
      const res = await instance.acquireTokenSilent({
        scopes: GRAPH_SCOPES,
        account,
      });
      setAccessToken(res.accessToken);
      return res.accessToken;
    } catch {
      try {
        await instance.acquireTokenRedirect({ scopes: GRAPH_SCOPES, account });
        return null;
      } catch (e: any) {
        console.error("Token acquisition failed:", e);
        return null;
      }
    }
  }, [instance, account]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!account,
        account,
        accessToken,
        loading,
        error,
        login,
        logout,
        getValidToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [msalInstance, setMsalInstance] = useState<PublicClientApplication | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let clientId = "";
        let tenantId = "";

        // Check server-side Azure config first (reads env vars)
        try {
          const azureRes = await fetch("/api/azure/config");
          const azureText = await azureRes.text();
          const azureData = azureText ? JSON.parse(azureText) : {};
          if (azureData.configured) {
            clientId = azureData.clientId || "";
            tenantId = azureData.tenantId || "common";
          }
        } catch {}

        // Fall back to localStorage
        if (!clientId) {
          const localConfig = localStorage.getItem("azure-ad-config");
          if (localConfig) {
            try {
              const parsed = JSON.parse(localConfig);
              clientId = parsed.clientId || "";
              tenantId = parsed.tenantId || "common";
            } catch {}
          }
        }

        // Fall back to app config file
        if (!clientId) {
          const res = await fetch("/api/config");
          const text = await res.text();
          const config = text ? JSON.parse(text) : {};
          clientId = config.graph?.clientId || "";
          tenantId = config.graph?.tenantId || "common";
        }

        const msalConfig = getMsalConfig(clientId, tenantId);
        const msal = new PublicClientApplication(msalConfig);
        await msal.initialize();

        try {
          await msal.handleRedirectPromise();
        } catch (e: any) {
          console.warn("Cleared stale redirect state:", e?.message);
        }

        setMsalInstance(msal);
      } catch (e: any) {
        console.error("MSAL init failed:", e);
        setInitError(e.message);
      }
    })();
  }, []);

  if (initError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive">Auth init failed: {initError}</p>
        </div>
      </div>
    );
  }

  if (!msalInstance) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <svg className="mx-auto h-10 w-10 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <MsalProvider instance={msalInstance}>
      <AuthContent>{children}</AuthContent>
    </MsalProvider>
  );
}
