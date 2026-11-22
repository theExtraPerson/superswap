"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login } from "@/lib/app/api";
import { ApiError } from "@/lib/api/client";

/** /login — username + password (the DB maps the username to its account). */
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input =
    "w-full rounded-xl bg-[#0a1430] border border-[#1d2c55] px-4 py-3 text-sm text-[#e8eefc] placeholder-[#42527c] outline-none focus:border-[#f5b301]";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ username: username.trim().toLowerCase(), password });
      router.replace("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#060b1f] text-[#e8eefc]">
      <div className="mx-auto max-w-md px-5 py-14 flex flex-col gap-5">
        <header className="text-center">
          <h1 className="text-3xl font-black tracking-tight">
            Super<span className="text-[#f5b301]">Swap</span>
          </h1>
          <p className="mt-1 text-[#9fb3e8] text-sm">Sign in to your savings</p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="block">
            <span className="text-xs font-semibold text-[#9fb3e8]">Username</span>
            <input
              className={input}
              value={username}
              onChange={(e) => setUsername(e.target.value.trim().toLowerCase())}
              placeholder="sarah_n"
              autoComplete="username"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-[#9fb3e8]">Password</span>
            <input
              className={input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !username || !password}
            className="rounded-2xl bg-[#f5b301] text-[#1a1400] font-black text-lg py-4 hover:bg-[#ffc93c] disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-[#6b7fae]">
          New here?{" "}
          <Link href="/register" className="text-[#f5b301] font-semibold">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
