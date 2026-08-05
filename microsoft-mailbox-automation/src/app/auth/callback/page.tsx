"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { safeJson } from "@/lib/utils";

export default function AuthCallbackPage() {
  const { loading } = useAuth();
  const [status, setStatus] = useState<"processing" | "done" | "error">("processing");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    const handleRedirect = async () => {
      try {
        const res = await fetch("/api/config");
        const text = await res.text();
        const config = text ? safeJson(text) : {};

        const { PublicClientApplication } = await import("@azure/msal-browser");
        const { getMsalConfig, GRAPH_SCOPES } = await import("@/lib/auth/msal-config");

        const msalConfig = getMsalConfig(config.graph?.clientId, config.graph?.tenantId);
        const msal = new PublicClientApplication(msalConfig);
        await msal.initialize();

        const result = await msal.handleRedirectPromise();
        if (result && result.accessToken) {
          msal.setActiveAccount(result.account);
          sessionStorage.setItem("msal-token", result.accessToken);
          sessionStorage.setItem("msal-user", JSON.stringify({
            name: result.account?.name || "User",
            email: result.account?.username || "",
          }));
          setStatus("done");
          setTimeout(() => {
            window.location.href = "/";
          }, 1500);
        } else {
          setStatus("done");
          setTimeout(() => {
            window.location.href = "/";
          }, 1500);
        }
      } catch (e: any) {
        console.error("[auth-callback] error:", e);
        setErrorMsg(e?.message || "An unexpected error occurred during authentication.");
        setStatus("error");
      }
    };

    handleRedirect();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        {status === "processing" && (
          <>
            <svg className="mx-auto h-10 w-10 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="mt-4 text-sm text-muted-foreground">Completing authentication...</p>
          </>
        )}
        {status === "done" && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Authentication successful. Redirecting...</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="mt-4 text-sm text-destructive">Authentication failed. Please try again.</p>
            {errorMsg && (
              <p className="mt-2 text-xs text-destructive/80 break-words">{errorMsg}</p>
            )}
            <a href="/login" className="mt-4 inline-block btn btn-primary">Back to Login</a>
          </>
        )}
        {loading && status === "processing" && (
          <p className="mt-2 text-xs text-muted-foreground">Initializing...</p>
        )}
      </div>
    </div>
  );
}
