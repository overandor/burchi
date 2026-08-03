"use client";

import { useAuth } from "@/lib/auth/auth-context";
import LoginPage from "@/app/login/page";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, account, logout } = useAuth();

  if (loading) {
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

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
              M
            </div>
            <div>
              <h1 className="text-lg font-semibold">Mailbox Automation</h1>
              <p className="text-xs text-muted-foreground">Scientific Data Extraction Pipeline</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-1">
              <a href="/" className="btn btn-outline !h-9 !px-3 text-sm">Dashboard</a>
              <a href="/emails" className="btn btn-outline !h-9 !px-3 text-sm">Emails</a>
              <a href="/sheets" className="btn btn-outline !h-9 !px-3 text-sm">Sheets</a>
              <a href="/settings" className="btn btn-outline !h-9 !px-3 text-sm">Settings</a>
            </nav>
            <div className="flex items-center gap-3 border-l pl-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0078d4] text-xs font-semibold text-white">
                  {account?.name?.charAt(0).toUpperCase() || "U"}
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs font-medium">{account?.name || "User"}</p>
                  <p className="text-xs text-muted-foreground">{account?.username}</p>
                </div>
              </div>
              <button
                onClick={logout}
                className="btn btn-outline !h-9 !px-3 text-sm"
                title="Sign out"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 container px-6 py-8">{children}</main>
      <footer className="border-t py-4 text-center text-sm text-muted-foreground">
        Microsoft Mailbox API Automation &copy; 2026
      </footer>
    </div>
  );
}
