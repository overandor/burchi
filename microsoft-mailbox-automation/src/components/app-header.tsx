"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/territory", label: "Territory" },
  { href: "/commitments", label: "Commitments" },
  { href: "/field", label: "Field" },
  { href: "/roles", label: "Roles" },
  { href: "/spinor", label: "SPINOR" },
  { href: "/ventures", label: "Ventures" },
  { href: "/inbox", label: "Inbox" },
  { href: "/emails", label: "Emails" },
  { href: "/sheets", label: "Sheets" },
  { href: "/phones", label: "Phones" },
  { href: "/telemetry", label: "Telemetry" },
  { href: "/settings", label: "Settings" },
];

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setTheme("dark");
    }
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  return (
    <button
      onClick={toggle}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:bg-primary/5 hover:text-foreground"
      aria-label="Toggle dark mode"
    >
      {theme === "dark" ? (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1.5m0 15V21m9-9h-1.5M4.5 12H3m15.364 6.364l-1.06-1.06M6.696 6.696l-1.06-1.06m12.728 0l-1.06 1.06M6.696 17.304l-1.06 1.06M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ) : (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      )}
    </button>
  );
}

export function AppHeader() {
  const pathname = usePathname() ?? "";

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-3 transition-transform hover:scale-105">
          <div className="relative flex h-9 w-9 items-center justify-center">
            <div className="absolute inset-0 organic-border bg-gradient-to-br from-primary/80 to-accent/60 animate-glow-pulse" />
            <span className="relative text-xs font-bold text-primary-foreground">AF</span>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">Advantage Foundry</h1>
            <p className="text-[11px] font-medium text-muted-foreground">Hypothesis Garden</p>
          </div>
        </Link>
        <nav className="flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-primary/5 hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <ThemeToggle />
          <Link
            href="/dashboard"
            className="ml-2 inline-flex h-9 items-center justify-center rounded-xl bg-gradient-to-r from-primary to-accent px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-primary/40 hover:scale-105"
          >
            Launch App
          </Link>
        </nav>
      </div>
    </header>
  );
}
