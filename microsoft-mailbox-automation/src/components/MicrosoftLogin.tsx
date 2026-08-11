"use client";

import { useState, useEffect, useRef } from "react";

interface MicrosoftLoginProps {
  onConnected: (data: { token: string; refreshToken: string; name: string; email: string }) => void;
  onClose: () => void;
}

/**
 * MicrosoftLogin — Device code OAuth flow.
 *
 * The built-in Microsoft Graph Command Line Tools public client
 * (14d82eec-204b-4c2f-b7e8-296a70dab67e) supports the device code flow
 * without requiring an app registration. The user goes to
 * microsoft.com/link, enters a code, and signs in normally.
 *
 * After login, we fetch the user profile and trigger a 1000-email sync.
 */
export function MicrosoftLogin({ onConnected, onClose }: MicrosoftLoginProps) {
  const [step, setStep] = useState<"init" | "show-code" | "polling" | "success" | "error">("init");
  const [userCode, setUserCode] = useState("");
  const [verificationUri, setVerificationUri] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onConnectedRef = useRef(onConnected);
  const mountedRef = useRef(true);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startDeviceFlow = async () => {
    setStep("init");
    setError(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    try {
      const res = await fetch("/api/microsoft/devicecode", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start login");
        setStep("error");
        return;
      }
      setUserCode(data.user_code);
      setVerificationUri(data.verification_uri);
      setStep("show-code");

      // Open the Microsoft login page in a new tab
      window.open(data.verification_uri, "_blank", "noopener,noreferrer");

      const expiry = Date.now() + (data.expires_in - 30) * 1000;
      startPolling(
        data.device_code,
        data.client_id,
        data.tenant_id || "common",
        data.scopes,
        data.interval || 5,
        expiry,
      );
    } catch (e: any) {
      setError(e.message);
      setStep("error");
    }
  };

  const startPolling = (
    code: string,
    cId: string,
    tId: string,
    scps: string[],
    interval: number,
    expiry: number,
  ) => {
    setStep("polling");
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      if (!mountedRef.current) {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      if (Date.now() > expiry) {
        if (pollRef.current) clearInterval(pollRef.current);
        setError("Login timed out. Please try again.");
        setStep("error");
        return;
      }

      try {
        const res = await fetch("/api/microsoft/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_code: code, client_id: cId, tenant_id: tId, scopes: scps }),
        });
        const data = await res.json();

        if (data.access_token) {
          if (pollRef.current) clearInterval(pollRef.current);
          // Get user profile — pass id_token for personal account fallback
          const meRes = await fetch("/api/microsoft/me", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              access_token: data.access_token,
              id_token: data.id_token,
            }),
          });
          const me = await meRes.json();
          if (!mountedRef.current) return;
          setStep("success");
          onConnectedRef.current({
            token: data.access_token,
            refreshToken: data.refresh_token || "",
            name: me.displayName || me.name || "Microsoft User",
            email: me.email || me.preferred_username || "",
          });
        } else if (data.error === "authorization_pending") {
          // Keep polling
        } else if (data.error === "authorization_declined") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError("You declined the login. Click try again to retry.");
          setStep("error");
        } else if (data.error === "expired_token") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError("The login code expired. Please try again.");
          setStep("error");
        } else if (data.error && data.error !== "authorization_pending") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(data.error_description || data.error || "Login failed");
          setStep("error");
        }
      } catch (e) {
        console.error("[microsoft-login] poll error:", e);
      }
    }, (interval + 1) * 1000);
  };

  useEffect(() => {
    startDeviceFlow();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const copyCode = () => {
    navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0078d4]">
              <svg className="h-6 w-6 text-white" viewBox="0 0 23 23" fill="none">
                <path fill="#f25022" d="M1 1h10v10H1z" />
                <path fill="#7fba00" d="M12 1h10v10H12z" />
                <path fill="#00a4ef" d="M1 12h10v10H1z" />
                <path fill="#ffb900" d="M12 12h10v10H12z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Sign in to Microsoft</h2>
              <p className="text-xs text-slate-500">Mailbox & OneDrive access</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Init state */}
        {step === "init" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#0078d4]"></div>
            <p className="text-sm text-slate-500">Preparing login...</p>
          </div>
        )}

        {/* Show code */}
        {(step === "show-code" || step === "polling") && (
          <div className="space-y-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-medium text-blue-900">A new tab opened for Microsoft login</p>
              <p className="mt-1 text-xs text-blue-700">
                Sign in with any Microsoft account (Outlook, Hotmail, Xbox, work/school).
                We&apos;ll pull up to 1000 emails.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <p className="text-xs font-medium text-slate-500">Enter this code on the Microsoft login page:</p>
              <div className="mt-2 flex items-center justify-center gap-2">
                <code className="rounded-lg bg-white px-4 py-2 text-2xl font-bold tracking-widest text-slate-900 shadow-sm">
                  {userCode}
                </code>
                <button
                  onClick={copyCode}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600 hover:bg-slate-50"
                  title="Copy code"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <a
              href={verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0078d4] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#106ebe]"
            >
              <svg className="h-5 w-5" viewBox="0 0 23 23" fill="none">
                <path fill="#f25022" d="M1 1h10v10H1z" />
                <path fill="#7fba00" d="M12 1h10v10H12z" />
                <path fill="#00a4ef" d="M1 12h10v10H1z" />
                <path fill="#ffb900" d="M12 12h10v10H12z" />
              </svg>
              Open Microsoft Login
            </a>

            {step === "polling" && (
              <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-200 border-t-[#0078d4]"></div>
                Waiting for you to sign in...
              </div>
            )}
          </div>
        )}

        {/* Success */}
        {step === "success" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-900">Connected!</p>
            <p className="text-xs text-slate-500">Syncing up to 1000 emails...</p>
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-900">Login failed</p>
              <p className="mt-1 text-xs text-red-700 break-words">{error}</p>
            </div>
            <button
              onClick={startDeviceFlow}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0078d4] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#106ebe]"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
