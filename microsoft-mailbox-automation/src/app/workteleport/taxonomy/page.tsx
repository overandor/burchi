"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BookOpen, ArrowLeft, Search, Tag } from "lucide-react";

interface CoinedTerm {
  id: string;
  term: string;
  definition: string;
  experimentFamily: string;
  exampleHypothesis: string;
  metrics: string[];
  complianceNotes: string;
}

export default function TaxonomyPage() {
  const [terms, setTerms] = useState<CoinedTerm[]>([]);
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/workteleport/taxonomy")
      .then((r) => r.json())
      .then((data) => {
        setTerms(data.terms || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const families = Array.from(new Set(terms.map((t) => t.experimentFamily))).sort();

  const filtered = terms.filter((t) => {
    const matchesSearch =
      !search ||
      t.term.toLowerCase().includes(search.toLowerCase()) ||
      t.definition.toLowerCase().includes(search.toLowerCase()) ||
      t.experimentFamily.toLowerCase().includes(search.toLowerCase());
    const matchesFamily = familyFilter === "all" || t.experimentFamily === familyFilter;
    return matchesSearch && matchesFamily;
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <Link href="/workteleport" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold">40 Coined Terms</h1>
            <p className="text-xs text-muted-foreground">Experiment taxonomy library</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Search and Filter */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search terms, definitions, or families..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-4 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <select
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            <option value="all">All families ({terms.length})</option>
            {families.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-muted-foreground">Loading taxonomy...</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((term, i) => (
              <div key={term.id} className="rounded-xl border border-border bg-card p-5">
                <div className="mb-2 flex items-start justify-between">
                  <span className="text-xs font-mono text-muted-foreground">#{i + 1}</span>
                  <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    <Tag className="h-3 w-3" /> {term.experimentFamily}
                  </span>
                </div>
                <h3 className="mb-2 text-sm font-bold leading-tight">{term.term}</h3>
                <p className="mb-3 text-xs text-muted-foreground">{term.definition}</p>

                <div className="mb-2 rounded-lg border border-border/50 bg-background p-2">
                  <div className="text-xs text-muted-foreground">Example hypothesis:</div>
                  <p className="mt-0.5 text-xs italic">{term.exampleHypothesis}</p>
                </div>

                {term.metrics.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs text-muted-foreground">Metrics:</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {term.metrics.map((m) => (
                        <span key={m} className="rounded bg-blue-500/10 px-1.5 py-0.5 text-xs text-blue-500">{m}</span>
                      ))}
                    </div>
                  </div>
                )}

                {term.complianceNotes && (
                  <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-600 dark:text-amber-400">
                    {term.complianceNotes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {filtered.length === 0 && !loading && (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">No terms match your search.</p>
          </div>
        )}
      </main>
    </div>
  );
}
