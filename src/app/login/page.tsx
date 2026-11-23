"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login } from "@/lib/app/api";
import { ApiError } from "@/lib/api/client";
import { BrandMark } from "@/components/ui";

/** /login — username + password (the DB maps the username to its account). */
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input = "field";

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
    <main className="min-h-dvh text-[#f6f8ff]">
      <div className="mx-auto max-w-md px-5 py-14 flex flex-col gap-5">
        <header className="flex flex-col items-center gap-2 text-center">
          <h1>
            <BrandMark height={44} priority />
          </h1>
          <p className="text-[#c3cfe4] text-sm">Sign in to save, earn yield and grow</p>
        </header>

        <form onSubmit={onSubmit} className="card-grad p-5 flex flex-col gap-4">
          <label className="block">
            <span className="text-xs font-semibold text-[#c3cfe4]">Username</span>
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
            <span className="text-xs font-semibold text-[#c3cfe4]">Password</span>
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
            className="btn-cta w-full py-4 text-[17px]"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-[#92a0b9]">
          New here?{" "}
          <Link href="/register" className="text-[#45e9ff] font-semibold">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
