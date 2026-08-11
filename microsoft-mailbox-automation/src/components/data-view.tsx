"use client";

import { PageHeader, PageSection, Stat, EmptyState, Loading, ErrorState } from "./page-shell";
import { useApi } from "./use-api";
import type { LucideIcon } from "lucide-react";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function renderValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-muted-foreground">None</span>;
    return (
      <ul className="space-y-1">
        {v.map((item, i) => (
          <li key={i} className="text-sm text-foreground/80">
            {isObject(item) ? <ObjectTable obj={item} /> : String(item)}
          </li>
        ))}
      </ul>
    );
  }
  if (isObject(v)) return <ObjectTable obj={v} />;
  return String(v);
}

function ObjectTable({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj).filter(([, v]) => typeof v !== "function");
  if (entries.length === 0) return <span className="text-muted-foreground">Empty</span>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-muted/10">
      <table className="w-full text-sm">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-border last:border-0">
              <td className="w-1/3 p-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {k.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}
              </td>
              <td className="p-2.5 text-foreground/90">{renderValue(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecordList({
  items,
  keyFn,
  render,
  empty,
}: {
  items: any[];
  keyFn: (item: any) => string;
  render: (item: any) => React.ReactNode;
  empty?: React.ReactNode;
}) {
  if (items.length === 0) return empty || <p className="text-sm text-muted-foreground">No records found.</p>;
  return <div className="space-y-3">{items.map((item) => <div key={keyFn(item)}>{render(item)}</div>)}</div>;
}

export function GenericDataPage({
  icon: Icon,
  title,
  subtitle,
  endpoint,
  listKey,
  renderItem,
  listItemKey,
  stats,
  renderOverview,
  hideOverview,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  endpoint: string;
  listKey?: string;
  listItemKey?: (item: any) => string;
  renderItem?: (item: any) => React.ReactNode;
  stats?: { label: string; path: string }[];
  renderOverview?: (data: any) => React.ReactNode;
  hideOverview?: boolean;
}) {
  const { data, loading, error, refetch } = useApi(endpoint);

  if (loading) return <Loading message={`Loading ${title.toLowerCase()}…`} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const list = listKey && data ? data[listKey] : data;
  const values = stats
    ? stats.map((s: any) => {
        const v = s.path.split(".").reduce((acc: any, k: string) => acc?.[k], data);
        return { ...s, value: v };
      })
    : [];

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 page-enter">
      <PageHeader icon={Icon} title={title} subtitle={subtitle}>
        <button onClick={refetch} className="btn btn-ghost text-xs">Refresh</button>
      </PageHeader>

      {values.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {values.map((s: any) => (
            <Stat key={s.label} label={s.label} value={s.value ?? 0} />
          ))}
        </div>
      )}

      {listKey && Array.isArray(list) ? (
        <PageSection title={listKey.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())} className="mt-6">
          {list.length === 0 ? (
            <EmptyState title="No records" description={`The ${title.toLowerCase()} ledger is empty.`} />
          ) : (
            <div className="space-y-3">
              {list.map((item: any) => (
                <div key={(listItemKey ? listItemKey(item) : item.id) || Math.random()} className="card card-hover p-4">
                  {renderItem ? renderItem(item) : <ObjectTable obj={item} />}
                </div>
              ))}
            </div>
          )}
        </PageSection>
      ) : !hideOverview ? (
        <PageSection title="Overview" className="mt-6">
          {renderOverview ? renderOverview(data) : <ObjectTable obj={data || {}} />}
        </PageSection>
      ) : null}
    </div>
  );
}
