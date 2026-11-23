"use client";

// Minimal operator sign-in for the desk. Goes through the same
// /api/auth/login as members (username → synthetic email, cookie session).
// Membership in `admins` — not any client flag — decides whether the desk
// opens afterwards (app_admin_guard inside every admin RPC).

import { useState } from "react";
import { Btn, Card } from "@/components/ui";
import { login } from "@/lib/app/api";
import { inputCls, labelCls } from "./parts";
import type { DeskApi } from "./useDesk";

export function SignInCard({ desk }: { desk: DeskApi }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const submit = async () => {
    if (!username.trim() || !password) {
      setNotice("Username and password are required.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await login({ username: username.trim(), password });
      await desk.reload();
    } catch (e) {
      setNotice((e as Error).message || "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Operator sign-in"
      hint="The desk stays locked until app_admin_guard() finds your account in the admins table."
    >
      <div className="space-y-3">
        <div>
          <div className={labelCls}>Username</div>
          <input
            className={`${inputCls} mt-1`}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <div className={labelCls}>Password</div>
          <input
            className={`${inputCls} mt-1`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </div>
        {notice && <p className="text-[12px] text-amber-400">{notice}</p>}
        <div className="flex gap-2">
          <Btn disabled={busy} onClick={submit}>
            {busy ? "…" : "Sign in"}
          </Btn>
        </div>
        <p className="text-[11px] text-[#92a0b9] leading-snug">
          No account yet? Register at <code>/register</code> like any member, then have an existing
          admin grant your username on the Admins tab — or add it to the bootstrap list in
          <code>admin.sql</code> and re-run it.
        </p>
      </div>
    </Card>
  );
}
