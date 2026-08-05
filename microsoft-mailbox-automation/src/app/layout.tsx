import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Advantage Foundry — Where hypotheses grow into edge",
  description:
    "A perpetual scientific-work game powered by mailbox evidence, where differentiated human–LLM hypotheses are distributed as missions, tested in real work, reverse-attributed through SPINOR-RL, and preserved as evolving Golden Node lineages.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
