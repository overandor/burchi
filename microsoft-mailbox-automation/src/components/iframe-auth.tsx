"use client";

import { useEffect, useRef, useState } from "react";

interface IframeAuthPageProps {
  clientId: string;
  tenantId: string;
  redirectUri: string;
  scopes: string[];
  onToken: (token: string, accountInfo: { name: string; email: string }) => void;
  onBlocked: () => void;
}

export function IframeAuth({
  clientId,
  tenantId,
  redirectUri,
  scopes,
  onToken,
  onBlocked,
}: IframeAuthPageProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "blocked" | "error">("loading");
  const [authUrl, setAuthUrl] = useState<string>("");
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    if (!clientId || clientId === "00000000-0000-0000-0000-000000000000") {
      setStatus("error");
      return;
    }

    const scopeStr = scopes.join(" ");
    const url =
      `https://login.microsoftonline.com/${tenantId || "common"}/oauth2/v2.0/authorize` +
      `?client_id=${clientId}` +
      `&response_type=token` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scopeStr)}` +
      `&response_mode=fragment` +
      `&prompt=login` +
      `&nonce=${Date.now()}`;

    setAuthUrl(url);
  }, [clientId, tenantId, redirectUri, scopes]);

  useEffect(() => {
    if (!authUrl) return;

    let blocked = false;

    const timer = setTimeout(() => {
      const iframe = iframeRef.current;
      if (iframe) {
        try {
          const iframeWindow = iframe.contentWindow;
          if (!iframeWindow || iframeWindow.location.href === "about:blank") {
            blocked = true;
          }
        } catch {
          blocked = true;
        }
      }
      if (blocked) {
        setStatus("blocked");
        onBlocked();
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [authUrl, onBlocked]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "auth-token" && event.data?.token) {
        onToken(event.data.token, {
          name: event.data.name || "User",
          email: event.data.email || "",
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onToken]);

  const handlePopupFallback = () => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }

    const popup = window.open(
      authUrl,
      "microsoft-login",
      "width=500,height=650,scrollbars=yes,resizable=yes"
    );
    popupRef.current = popup;

    if (!popup) {
      setStatus("error");
      return;
    }

    const checkPopup = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkPopup);
        return;
      }

      try {
        const popupUrl = popup.location.href;
        if (popupUrl.includes("access_token=")) {
          const fragment = popupUrl.split("#")[1] || "";
          const params = new URLSearchParams(fragment);
          const token = params.get("access_token");
          if (token) {
            popup.close();
            clearInterval(checkPopup);
            onToken(token, { name: "User", email: "" });
          }
        }
      } catch {
        // Cross-origin - can't read URL, keep waiting
      }
    }, 500);
  };

  if (status === "error" || !clientId || clientId === "00000000-0000-0000-0000-000000000000") {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <svg className="h-8 w-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        <p className="text-sm font-medium text-muted-foreground">
          Azure AD App Registration required
        </p>
        <p className="text-xs text-muted-foreground">
          Enter your Client ID and Tenant ID above to enable Microsoft login
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {status === "blocked" ? (
        <>
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <svg className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 3.75 3 3m-9-3 3 3M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0Z" />
            </svg>
            <p className="text-sm text-muted-foreground">
              Microsoft&apos;s login page cannot be embedded in an iframe due to security restrictions.
            </p>
            <p className="text-xs text-muted-foreground">
              Click below to open the login window
            </p>
          </div>
          <button
            onClick={handlePopupFallback}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-[#0078d4] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#106ebe]"
          >
            <svg className="h-4 w-4" viewBox="0 0 23 23" fill="none">
              <path fill="#f25022" d="M1 1h10v10H1z" />
              <path fill="#7fba00" d="M12 1h10v10H12z" />
              <path fill="#00a4ef" d="M1 12h10v10H1z" />
              <path fill="#ffb900" d="M12 12h10v10H12z" />
            </svg>
            Open Microsoft Login
          </button>
        </>
      ) : (
        <>
          <div className="relative w-full overflow-hidden rounded-lg border border-slate-200" style={{ minHeight: "450px" }}>
            <iframe
              ref={iframeRef}
              src={authUrl}
              className="w-full"
              style={{ height: "450px", border: "none" }}
              title="Microsoft Login"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
          <button
            onClick={handlePopupFallback}
            className="text-xs text-[#0078d4] hover:underline"
          >
            Login not showing? Open in a new window
          </button>
        </>
      )}
    </div>
  );
}
