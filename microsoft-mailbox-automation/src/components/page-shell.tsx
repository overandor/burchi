"use client";

import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function PageSection({
  title,
  icon: Icon,
  children,
  actions,
  className,
}: {
  title?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-border/50 bg-card/60 p-5 backdrop-blur-sm ${className || ""}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {title && (
            <div className="flex items-center gap-2 text-muted-foreground">
              {Icon && <Icon className="h-4 w-4" />}
              <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
            </div>
          )}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  icon: Icon,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  detail?: string;
  tone?: "neutral" | "primary" | "accent" | "red" | "green";
}) {
  const toneClass = {
    neutral: "border-border/50 bg-card/60 text-foreground",
    primary: "border-primary/20 bg-primary/10 text-primary",
    accent: "border-accent/20 bg-accent/10 text-accent",
    red: "border-red-500/20 bg-red-500/10 text-red-400",
    green: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
        {Icon && <Icon className="h-4 w-4 opacity-60" />}
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      {detail && <p className="mt-1 text-xs opacity-70">{detail}</p>}
    </div>
  );
}

export function Loading({ children, message }: { children?: React.ReactNode; message?: string }) {
  return (
    <div className="flex h-64 w-full items-center justify-center rounded-2xl border border-dashed border-border/50 bg-card/40">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        {message && <p className="text-sm">{message}</p>}
        {children && <p className="text-sm">{children}</p>}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry, title, message }: { error?: string; onRetry?: () => void; title?: string; message?: string }) {
  const text = error || message || "Something went wrong";
  return (
    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center">
      <h3 className="text-base font-semibold text-red-200">{title || "Error"}</h3>
      <p className="mt-1 text-sm text-red-300/80">{text}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn btn-primary btn-sm mt-4">Retry</button>
      )}
    </div>
  );
}

export function PageSkeleton({
  title = "Loading",
  count = 1,
}: {
  title?: string;
  count?: number;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 pt-4">
      <div className="skeleton h-8 w-64 rounded-lg" />
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton h-48 w-full rounded-2xl" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  message?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const body = message || description || "";
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-card/40 p-10 text-center">
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border/50 bg-muted/30 text-muted-foreground">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {body && <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
