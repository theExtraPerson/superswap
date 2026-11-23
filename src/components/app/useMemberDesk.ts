"use client";

// Member desk state: one dashboard round-trip, guarded routes, and a mutate
// wrapper that runs any money action then reloads — rules live in Postgres.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { claimWelcomeBonus, getDashboard } from "@/lib/app/api";
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

  // Welcome bonus safety net. Sign-in claims it server-side, but a session
  // that predates the promo never passed through /api/auth/login — so try once
  // per desk mount. The claim is replay-safe in SQL; a reload only happens when
  // money actually arrived.
  const bonusTried = useRef(false);
  useEffect(() => {
    if (!data || bonusTried.current) return;
    bonusTried.current = true;
    claimWelcomeBonus(cfg)
      .then((res) => {
        if (Number(res?.credited ?? 0) > 0) void load();
      })
      .catch(() => {
        /* the bonus is never worth blocking the desk over */
      });
  }, [data, cfg, load]);

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
