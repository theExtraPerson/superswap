"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { register } from "@/lib/app/api";
import { ApiError } from "@/lib/api/client";
import { PHONE_RE, USERNAME_RE } from "@/lib/supabase/config";

const REF_KEY = "ss_referral";

/**
 * /register — name, username, telephone, auto-filled referral code.
 * Username + password are the future login handle. All authoritative
 * validation re-happens inside Postgres (profile bootstrap trigger).
 */
export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [referral, setReferral] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Referral code arrives via ?code= (shared link) or a previously stored one.
  // Browser-only state by nature (URL + localStorage), adopted once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = (params.get("code") ?? "").toUpperCase();
    if (fromUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReferral(fromUrl);
      try {
        localStorage.setItem(REF_KEY, fromUrl);
      } catch {}
      params.delete("code");
      const clean = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
      window.history.replaceState({}, "", clean);
    } else {
      try {
        setReferral(localStorage.getItem(REF_KEY) ?? "");
      } catch {}
    }
  }, []);

  const problems = useMemo(() => {
    const p: string[] = [];
    if (fullName && (fullName.trim().length < 2 || fullName.trim().length > 60))
      p.push("Name must be 2-60 characters.");
    if (username && !USERNAME_RE.test(username))
      p.push("Username: 3-20 chars, lowercase letters, numbers or underscore.");
    if (phone && !PHONE_RE.test(phone)) p.push("Phone: a Ugandan mobile number, e.g. 0772123456.");
    if (password && password.length < 8) p.push("Password must be at least 8 characters.");
    return p;
  }, [fullName, username, phone, password]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await register({
        fullName: fullName.trim(),
        username: username.trim().toLowerCase(),
        phone: phone.trim(),
        password,
        referralCode: referral.trim().toUpperCase() || undefined,
      });
      if (res.signed_in) {
        router.replace("/app");
      } else {
        setNotice("Account created. Check your email to confirm, then sign in.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-xl bg-[#0a1430] border border-[#1d2c55] px-4 py-3 text-sm text-[#e8eefc] placeholder-[#42527c] outline-none focus:border-[#f5b301]";

  return (
    <main className="min-h-dvh bg-[#060b1f] text-[#e8eefc]">
      <div className="mx-auto max-w-md px-5 py-10 flex flex-col gap-5">
        <header className="text-center">
          <h1 className="text-3xl font-black tracking-tight">
            Super<span className="text-[#f5b301]">Swap</span>
          </h1>
          <p className="mt-1 text-[#9fb3e8] text-sm">Create your savings account</p>
        </header>

        {notice && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {notice}
            <Link href="/login" className="underline ml-1">Sign in</Link>
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="block">
            <span className="text-xs font-semibold text-[#9fb3e8]">Full name</span>
            <input
              className={input}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Sarah Namutebi"
              autoComplete="name"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-[#9fb3e8]">Username — your login handle</span>
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
            <span className="text-xs font-semibold text-[#9fb3e8]">Telephone (mobile money)</span>
            <input
              className={input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0772123456"
              inputMode="tel"
              autoComplete="tel"
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
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-[#9fb3e8]">Referral code</span>
            <input
              className={`${input} uppercase`}
              value={referral}
              onChange={(e) => {
                const v = e.target.value.toUpperCase();
                setReferral(v);
                try {
                  if (v) localStorage.setItem(REF_KEY, v);
                  else localStorage.removeItem(REF_KEY);
                } catch {}
              }}
              placeholder=" Friend's code (optional)"
              maxLength={10}
            />
            <span className="text-[11px] text-[#6b7fae] mt-1 block">
              Auto-filled from your friend&apos;s link. Attribution only — never required to join.
            </span>
          </label>

          {problems.length > 0 && (
            <ul className="text-xs text-amber-400 space-y-1">
              {problems.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          )}
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || problems.length > 0 || !fullName || !username || !phone || !password}
            className="rounded-2xl bg-[#f5b301] text-[#1a1400] font-black text-lg py-4 hover:bg-[#ffc93c] disabled:opacity-40"
          >
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-center text-xs text-[#6b7fae]">
          Already have an account?{" "}
          <Link href="/login" className="text-[#f5b301] font-semibold">
            Sign in
          </Link>
        </p>

        <footer className="text-center text-[10px] text-[#42527c] pt-2 leading-relaxed">
          Your username and password are the only way to sign in. Keep the password secret — staff
          will never ask for it.
        </footer>
      </div>
    </main>
  );
}
