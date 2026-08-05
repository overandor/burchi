"use client";

import { usePathname } from "next/navigation";
import { GameNav } from "@/components/GameNav";

/**
 * AppShell — wraps every route with the Advantage Foundry game shell.
 *
 * Auth/login and standalone connector routes render bare (no game nav) so
 * the player mission surface never competes with administrative or
 * authentication screens. Every canonical player route (today, inbox,
 * foundry, experiment, results, golden-nodes, history) gets the GameNav.
 */
const BARE_ROUTES = ["/login", "/auth"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const isBare = BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

  if (isBare) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-background">
      <GameNav />
      <main className="mx-auto max-w-7xl px-6 py-8 scrollbar-thin">{children}</main>
    </div>
  );
}
