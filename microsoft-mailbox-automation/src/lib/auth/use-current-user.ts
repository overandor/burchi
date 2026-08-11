"use client";

import { useState, useEffect, useCallback } from "react";

interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  therapeuticArea?: string;
  orgId: string;
  isAuthenticated: boolean;
}

interface UseCurrentUserResult {
  user: CurrentUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Client-side hook to get the current authenticated user.
 * Falls back to a demo user if not authenticated.
 *
 * Replaces hardcoded `employeeId = "emp-001"` across pages.
 */
export function useCurrentUser(): UseCurrentUserResult {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setUser(data);
        } else if (res.status === 401) {
          // Not authenticated — use demo fallback
          setUser({
            id: "emp-001",
            email: "",
            name: "Field Rep",
            role: "field_representative",
            orgId: "org-demo",
            isAuthenticated: false,
          });
        } else {
          setError(`Failed to load user (${res.status})`);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  return { user, loading, error, refresh };
}
