"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resetPassword } from "@/lib/app/api";
import { ApiError } from "@/lib/api/client";
import { BrandMark } from "@/components/ui";

/**
 * /forgot-password — the change-password form for members who cannot sign in.
 * There is no mail server (usernames log in as <name>@<synthetic host>), so
 * identity is proven the way the account was created: username + the phone
 * registered at sign-up. On success the route sets the new password through
 * the service role (future logins use it; sessions open elsewhere ride until
 * their next refresh) and we bounce back to /login.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input = "field";
  const mismatch = confirm.length > 0 && password !== confirm;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await resetPassword({ username: username.trim().toLowerCase(), phone: phone.trim(), password });
      // Reset landed — straight back to sign-in with a one-line receipt.
      router.replace("/login?reset=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed. Please try again.");
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
          <p className="text-[#c3cfe4] text-sm">
            Set a new password with the details you signed up with
          </p>
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
            <span className="text-xs font-semibold text-[#c3cfe4]">Registered phone</span>
            <input
              className={input}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.trim())}
              placeholder="077… or +25677…"
              autoComplete="tel"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-[#c3cfe4]">New password</span>
            <input
              className={input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-[#c3cfe4]">Repeat new password</span>
            <input
              className={input}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Once more"
              autoComplete="new-password"
              minLength={8}
              required
            />
            {mismatch && (
              <span className="mt-1 block text-[11px] text-red-300">The two passwords differ.</span>
            )}
          </label>

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !username || !phone || !password || mismatch}
            className="btn-cta w-full py-4 text-[17px]"
          >
            {busy ? "Resetting…" : "Set new password"}
          </button>
        </form>

        <p className="text-center text-xs text-[#92a0b9]">
          Remembered it?{" "}
          <Link href="/login" className="text-[#45e9ff] font-semibold">
            Back to sign-in
          </Link>
        </p>
      </div>
    </main>
  );
}
