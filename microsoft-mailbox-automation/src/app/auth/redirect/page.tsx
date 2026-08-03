"use client";

import { useEffect, useState } from "react";

export default function AuthRedirectPage() {
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const fragment = window.location.hash.substring(1);
    const params = new URLSearchParams(fragment);

    const accessToken = params.get("access_token");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    if (accessToken) {
      setToken(accessToken);
      setStatus("success");

      window.parent?.postMessage(
        {
          type: "auth-token",
          token: accessToken,
          name: "User",
          email: "",
        },
        "*"
      );

      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
    } else if (error) {
      console.error("Auth error:", error, errorDescription);
      setStatus("error");
    } else {
      setStatus("error");
    }
  }, []);

  return (
    <div className="flex min-h-[400px] items-center justify-center bg-slate-50">
      <div className="text-center">
        {status === "processing" && (
          <>
            <svg className="mx-auto h-8 w-8 animate-spin text-[#0078d4]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="mt-3 text-sm text-muted-foreground">Completing sign in...</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
              <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-medium text-green-700">Authentication successful!</p>
            <p className="mt-1 text-xs text-muted-foreground">Redirecting to dashboard...</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-medium text-red-700">Authentication failed</p>
            <p className="mt-1 text-xs text-muted-foreground">Please try again</p>
          </>
        )}
      </div>
    </div>
  );
}
