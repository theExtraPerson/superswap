"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { register } from "@/lib/app/api";
import { ApiError } from "@/lib/api/client";
import { PHONE_RE, USERNAME_RE } from "@/lib/supabase/config";
import { BrandMark } from "@/components/ui";

const REF_KEY = "ss_referral";

/**
 * The /register form. Kept separate from the route file so /register can stay a
 * server component and publish the invite code in its Open Graph tags — the
 * share card is what convinces a friend to tap the link, and the code in it is
 * what gets them attributed to the referrer.
 *
 * `initialCode` arrives from the URL server-side (no window sniffing, so no
 * hydration delta). A code already stored from an earlier visit is restored,
 * which keeps attribution alive if the friend opened the link, left, and came
 * back through a plain /register.
 */
export default function RegisterForm({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [referral, setReferral] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Persist the invite the moment it is known; fall back to a stored one when
  // this visit arrived without ?code=. localStorage is browser-only state by
  // nature, so reading it here (rather than in a useState initializer) is what
  // keeps the server and first client render identical — no hydration delta.
  useEffect(() => {
    try {
      if (initialCode) localStorage.setItem(REF_KEY, initialCode);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      else setReferral(localStorage.getItem(REF_KEY) ?? "");
    } catch {}
  }, [initialCode]);

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
        try {
          localStorage.removeItem(REF_KEY);
        } catch {}
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

  const input = "field";

  return (
    <main className="min-h-dvh text-[#f6f8ff]">
      <div className="mx-auto max-w-md px-5 py-10 flex flex-col gap-5">
        <header className="flex flex-col items-center gap-2 text-center">
          <BrandMark height={44} priority />
          <p className="text-[#c3cfe4] text-sm">Create your account</p>
        </header>

        {notice && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {notice}
            <Link href="/login" className="underline ml-1">Sign in</Link>
          </div>
        )}

        <form onSubmit={onSubmit} className="card-grad p-5 flex flex-col gap-4">
          <label className="block">
            <span className="text-xs font-semibold text-[#c3cfe4]">Full name</span>
            <input
              className={input}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder=" "
              autoComplete="name"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-[#c3cfe4]">Username — your login handle</span>
            <input
              className={input}
              value={username}
              onChange={(e) => setUsername(e.target.value.trim().toLowerCase())}
              placeholder=" "
              autoComplete="username"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-[#c3cfe4]">Phone Number</span>
            <input
              className={input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder=" "
              inputMode="tel"
              autoComplete="tel"
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
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-[#c3cfe4]">Referral code</span>
            <input
              className={`${input} uppercase tracking-widest font-bold`}
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
            <span className="text-[11px] text-[#92a0b9] mt-1 block">
              Auto-filled from your friend&apos;s link.
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
            className="btn-cta w-full py-4 text-[17px]"
          >
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-center text-xs text-[#92a0b9]">
          Already have an account?{" "}
          <Link href="/login" className="text-[#45e9ff] font-semibold">
            Sign in 
          </Link>
        </p>

        <footer className="text-center text-[10px] text-[#5d6f93] pt-2 leading-relaxed">
          Keep your password secret — staff will never ask for it.
        </footer>
      </div>
    </main>
  );
}
