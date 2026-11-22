"use client";

// Member desk state: one dashboard round-trip, guarded routes, and a mutate
// wrapper that runs any money action then reloads — rules live in Postgres.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getDashboard } from "@/lib/app/api";
import { browserApiConfig } from "@/lib/app/session";
import { ApiError } from "@/lib/api/client";
import type { DashboardPayload } from "@/lib/api/types";
import { errText } from "./parts";

export function useMemberDesk() {
  const router = useRouter();
  const cfg = useMemo(() => browserApiConfig(), []);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await getDashboard(cfg);
      setData(next);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace("/login");
        return;
      }
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [cfg, router]);

  useEffect(() => {
    // Initial fetch: every setState below happens after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await load();
        return true;
      } catch (e) {
        setError(errText(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  return { data, loading, busy, error, setError, reload: load, mutate };
}

export type MemberDeskApi = ReturnType<typeof useMemberDesk>;
