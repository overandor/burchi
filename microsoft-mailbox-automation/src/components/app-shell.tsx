"use client";

import { usePathname } from "next/navigation";
import { GameNav } from "@/components/GameNav";
import { CommandPalette } from "@/components/CommandPalette";
import { VoiceOrb } from "@/components/VoiceOrb";
import { VoiceProvider } from "@/components/VoiceContext";
import { AssistantTerminal } from "@/components/AssistantTerminal";

const BARE_ROUTES = ["/login", "/auth"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const isBare = BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

  if (isBare) {
    return <>{children}</>;
  }

  return (
    <VoiceProvider>
      <div className="relative min-h-screen bg-background">
        <GameNav />
        <main className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6" key={pathname}>
          {children}
        </main>
        <CommandPalette />
        <VoiceOrb />
        <AssistantTerminal />
      </div>
    </VoiceProvider>
  );
}
