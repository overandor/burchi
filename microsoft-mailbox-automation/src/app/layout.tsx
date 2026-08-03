import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/app-header";

export const metadata: Metadata = {
  title: "Mailbox Automation — Scientific Data Extraction",
  description: "Microsoft Graph mailbox automation with LLM-powered scientific data extraction to spreadsheets",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-white antialiased">
        <div className="flex min-h-screen flex-col">
          <AppHeader />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-slate-200 py-6 text-center text-sm text-slate-400">
            Mailbox Automation — Scientific Data Extraction &copy; 2026
          </footer>
        </div>
      </body>
    </html>
  );
}
