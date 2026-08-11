"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizeOrigin, safeJson } from "@/lib/utils";

function ConnectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"exchanging" | "success" | "error">("exchanging");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    (async () => {
      const code = searchParams?.get("code");
      if (!code) {
        setStatus("error");
        setErrorMsg("No authorization code received from Google.");
        return;
      }
      if (code.length < 10) {
        setStatus("error");
        setErrorMsg("Authorization code is too short to be valid.");
        return;
      }

      const redirectUri = `${normalizeOrigin(window.location.origin)}/api/gmail/callback`;

      // Server-side exchange — uses env vars, client secret never reaches the browser
      try {
        const serverRes = await fetch("/api/gmail/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, redirectUri }),
        });
        const serverText = await serverRes.text();
        const serverData = serverText ? safeJson(serverText) : {};

        if (serverRes.ok && serverData.refreshToken) {
          // Get clientId from server config for localStorage
          let clientId = "";
          try {
            const cfgRes = await fetch("/api/gmail/config");
            const cfgText = await cfgRes.text();
            const cfgData = cfgText ? safeJson(cfgText) : {};
            clientId = cfgData?.clientId || "";
          } catch (e) { console.error("[gmail-connect] error:", e); }

          const gmailConfig: Record<string, string> = {
            clientId,
            refreshToken: serverData.refreshToken,
            accessToken: serverData.accessToken || "",
          };
          localStorage.setItem("gmail-config", JSON.stringify(gmailConfig));

          // Also persist to the server-side credential store so the server
          // can send experiment emails without the browser passing tokens.
          try {
            const expiresAt = new Date(Date.now() + (serverData.expiresIn || 3600) * 1000).toISOString();
            await fetch("/api/email-credentials", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: "gmail",
                email: serverData.email || "me@gmail.com",
                refreshToken: serverData.refreshToken,
                accessToken: serverData.accessToken || "",
                accessTokenExpiresAt: expiresAt,
                metadata: { clientId },
              }),
            });
          } catch (e) {
            console.error("[gmail-connect] server credential save error:", e);
          }

          setStatus("success");
          setTimeout(() => router.push("/?gmail_connected=true"), 1500);
          return;
        }

        // Server exchange failed
        setStatus("error");
        setErrorMsg(serverData.error || "Token exchange failed. Make sure Gmail OAuth credentials are configured on the server.");
      } catch (e: any) {
        console.error("[gmail-connect] error:", e);
        setStatus("error");
        setErrorMsg(e.message || "Failed to exchange authorization code.");
      }
    })();
  }, [searchParams, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="w-full max-w-md card p-8 shadow-lg text-center">
        {status === "exchanging" && (
          <>
            <svg className="mx-auto h-12 w-12 animate-spin text-[#0078d4]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <h2 className="mt-4 text-lg font-semibold">Connecting to Gmail...</h2>
            <p className="mt-1 text-sm text-muted-foreground">Exchanging authorization code for access token.</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-semibold">Gmail Connected!</h2>
            <p className="mt-1 text-sm text-muted-foreground">Redirecting to dashboard...</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-semibold">Connection Failed</h2>
            <p className="mt-2 text-sm text-destructive break-words">{errorMsg}</p>
            <button
              onClick={() => router.push("/")}
              className="btn btn-outline mt-4 !h-10 text-sm"
            >
              Back to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function GmailConnectPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <svg className="h-10 w-10 animate-spin text-[#0078d4]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    }>
      <ConnectContent />
    </Suspense>
  );
}
