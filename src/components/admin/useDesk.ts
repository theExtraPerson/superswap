"use client";

// Desk state hook: one dashboard round-trip + bearer-token plumbing.
// The gate is honest: 401 → sign in needed, 403 → not an admin. Both
// originate from Postgres (session + app_admin_guard), not from this file.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AdminDashboardPayload } from "@/lib/api/types";
import { adminDashboard } from "@/lib/app/adminApi";
import { ApiError, type ApiConfig } from "@/lib/api/client";

export interface DeskApi {
  cfg: ApiConfig;
  /** null when NEXT_PUBLIC_SUPABASE_* are not configured (server-backed variant off). */
  sb: SupabaseClient | null;
  dash: AdminDashboardPayload | null;
  loading: boolean;
  /** null = unknown yet, false = this visitor has no desk. */
  isAdmin: boolean | null;
  /** Why the desk is hidden: 401 → "auth", 403 → "denied". */
  gate: "none" | "auth" | "denied";
  errorMsg: string;
  /** Sections report their own local failures through this. */
  setErrorMsg: (msg: string) => void;
  reload: () => void;
  search: string;
  setSearch: (q: string) => void;
  /** Run a desk mutation; returns true on success, surfaces errors via errorMsg. */
  mutate: (
    label: string,
    fn: (cfg: ApiConfig) => Promise<unknown>,
    onDone?: () => void
  ) => Promise<boolean>;
}

export function useDesk(): DeskApi {
  const [dash, setDash] = useState<AdminDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [gate, setGate] = useState<"none" | "auth" | "denied">("none");
  const [errorMsg, setErrorMsg] = useState("");
  const [search, setSearch] = useState("");

  const sb = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null; // env is static in the browser bundle
    return createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }, []);

  const cfg = useMemo<ApiConfig>(
    () => ({
      getAccessToken: async () => {
        if (!sb) return null;
        const { data } = await sb.auth.getSession();
        return data.session?.access_token ?? null;
      },
    }),
    [sb]
  );

  const load = useCallback(async () => {
    try {
      const q = search.trim();
      const d = await adminDashboard(q || undefined, cfg);
      setDash(d);
      setIsAdmin(true);
      setGate("none");
      setErrorMsg("");
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        setIsAdmin(false);
        setGate("auth");
      } else if (err.status === 403) {
        setIsAdmin(false);
        setGate("denied");
      }
      setErrorMsg(err.message ?? "Failed to load the desk.");
    } finally {
      setLoading(false);
    }
  }, [cfg, search]);

  useEffect(() => {
    // Intentional initial fetch; every setState below happens after an await,
    // never synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const mutate = useCallback(
    async (label: string, fn: (cfg: ApiConfig) => Promise<unknown>, onDone?: () => void) => {
      try {
        await fn(cfg);
        setErrorMsg("");
        onDone?.();
        await load();
        return true;
      } catch (e) {
        const err = e as ApiError;
        setErrorMsg(`${label}: ${err.message ?? "failed"}`);
        return false;
      }
    },
    [cfg, load]
  );

  const reload = useCallback(() => void load(), [load]);

  return { cfg, sb, dash, loading, isAdmin, gate, errorMsg, setErrorMsg, reload, search, setSearch, mutate };
}
