"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

export type SessionUser = {
  user_id: number;
  full_name: string;
  email: string;
  role: string;
};

export function LoginForm({ onAuthenticated }: { onAuthenticated: (user: SessionUser) => void }) {
  const [audience, setAudience] = useState<"employee" | "admin">("employee");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${audience}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Sign in failed.");
      setPassword("");
      onAuthenticated(body.user as SessionUser);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page relative isolate min-h-screen overflow-hidden px-5 py-8 sm:px-8 lg:px-12">
      <div className="login-glow login-glow-one" aria-hidden="true" />
      <div className="login-glow login-glow-two" aria-hidden="true" />
      <div className="relative mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-7xl items-center gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16">
        <section className="mx-auto w-full max-w-2xl py-4 text-white lg:mx-0 lg:py-12" aria-label="Cold chain platform introduction">
          <Link href="/" className="inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold tracking-wide text-white shadow-lg shadow-slate-950/10 backdrop-blur transition hover:bg-white/10">
            <span className="grid size-9 place-items-center rounded-full bg-cyan-300 text-blue-950">
              <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true"><path d="M12 2v20M4.93 6l14.14 12M4.93 18 19.07 6M2 12h20M8.5 3.5l3.5 2 3.5-2M8.5 20.5l3.5-2 3.5 2M3.5 8.5l2 3.5-2 3.5M20.5 8.5l-2 3.5 2 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span>ColdChain <span className="text-cyan-200">Guardian</span></span>
          </Link>

          <div className="mt-9 max-w-xl sm:mt-12 lg:mt-16">
            <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200"><span className="size-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.8)]" />Cold chain, in motion</p>
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">Every mile.<br /><span className="text-cyan-200">At the right temperature.</span></h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-blue-100/75 sm:text-lg">Follow sensitive shipments from warehouse to delivery with route visibility and product-aware temperature monitoring.</p>
          </div>

          <div className="route-card relative mt-9 overflow-hidden rounded-3xl border border-white/15 bg-[#0c2550]/80 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur sm:mt-11 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.19em] text-blue-200/65">Cold chain route</p>
                <div className="mt-2 flex items-center gap-2 text-sm font-medium text-white sm:text-base"><span>Bengaluru</span><span className="text-cyan-300">→</span><span>Mysuru</span></div>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-200"><span className="size-1.5 animate-pulse rounded-full bg-emerald-300" />Route preview</span>
            </div>
            <div className="mt-2" aria-hidden="true">
              <svg viewBox="0 0 720 190" className="h-auto w-full overflow-visible">
                <defs>
                  <linearGradient id="roadGlow" x1="0" x2="1"><stop stopColor="#38bdf8" stopOpacity=".08" /><stop offset=".48" stopColor="#67e8f9" stopOpacity=".85" /><stop offset="1" stopColor="#38bdf8" stopOpacity=".08" /></linearGradient>
                  <linearGradient id="truckBox" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f8fafc" /><stop offset="1" stopColor="#cbdff2" /></linearGradient>
                </defs>
                <path d="M16 148 C130 148 132 108 247 108 S372 148 470 148 S591 112 704 112" fill="none" stroke="#183966" strokeWidth="30" strokeLinecap="round" />
                <path d="M16 148 C130 148 132 108 247 108 S372 148 470 148 S591 112 704 112" fill="none" stroke="url(#roadGlow)" strokeWidth="2" strokeDasharray="7 12" className="route-dashes" />
                <circle cx="46" cy="145" r="7" fill="#67e8f9" /><circle cx="682" cy="114" r="7" fill="#6ee7b7" />
                <circle cx="46" cy="145" r="13" fill="none" stroke="#67e8f9" strokeOpacity=".25" />
                <circle cx="682" cy="114" r="13" fill="none" stroke="#6ee7b7" strokeOpacity=".25" />
                <g className="login-truck">
                  <ellipse cx="350" cy="153" rx="83" ry="9" fill="#06142b" fillOpacity=".45" />
                  <rect x="287" y="76" width="112" height="67" rx="10" fill="url(#truckBox)" />
                  <path d="M298 76h89a12 12 0 0 1 12 12v7H287v-7a12 12 0 0 1 11-12Z" fill="#38bdf8" />
                  <path d="M304 110h78" stroke="#a8c1dc" strokeWidth="2" />
                  <path d="M304 119h78" stroke="#a8c1dc" strokeWidth="2" />
                  <path d="M345 101v20m-10-17 20 14m-20 0 20-14m-16-2 6 3 6-3m-12 18 6-3 6 3" stroke="#1682b7" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M399 99h28a12 12 0 0 1 10 6l17 25v13h-55V99Z" fill="#30b8dd" />
                  <path d="M405 106h20a6 6 0 0 1 5 3l9 14h-34v-17Z" fill="#d9f5fb" />
                  <path d="M452 130h6v8h-6z" fill="#fb923c" />
                  <circle cx="317" cy="144" r="13" fill="#0a1830" /><circle cx="317" cy="144" r="6" fill="#9ab4d0" />
                  <circle cx="421" cy="144" r="13" fill="#0a1830" /><circle cx="421" cy="144" r="6" fill="#9ab4d0" />
                  <path d="M454 119h-8" stroke="#e0f2fe" strokeWidth="2" strokeLinecap="round" />
                </g>
                <g fill="#b7d7f4" fontFamily="Arial, sans-serif" fontSize="11" fontWeight="600"><text x="19" y="180">WAREHOUSE</text><text x="637" y="150">DELIVERY</text></g>
                <g className="route-ping"><circle cx="540" cy="132" r="4" fill="#67e8f9" /><circle cx="540" cy="132" r="11" fill="none" stroke="#67e8f9" strokeOpacity=".55" /></g>
              </svg>
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-blue-100/80">Temperature monitoring</span>
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-blue-100/80">Shipment visibility</span>
            </div>
          </div>
          <p className="mt-5 text-xs tracking-wide text-blue-100/45">PROTECTING EVERY DELIVERY, FROM SOURCE TO DESTINATION</p>
        </section>

        <section className="mx-auto w-full max-w-md rounded-3xl border border-white/65 bg-white p-7 shadow-[0_30px_100px_-30px_rgba(0,0,0,0.55)] sm:p-9 lg:p-10" aria-labelledby="login-title">
          <div className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Secure access</p>
            <h2 id="login-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Welcome back</h2>
            <p className="mt-2 text-sm text-slate-600">Sign in to your ColdChain Guardian account.</p>
          </div>
          <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="Account type">
            <button type="button" aria-pressed={audience === "employee"} onClick={() => setAudience("employee")} className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${audience === "employee" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}>Employee</button>
            <button type="button" aria-pressed={audience === "admin"} onClick={() => setAudience("admin")} className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${audience === "admin" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}>Administrator</button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email or employee ID</label>
              <input id="login-email" name="email" type="text" autoComplete="username" required maxLength={150}
                value={email} onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100" />
            </div>
            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
              <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={200}
                value={password} onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100" />
            </div>
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</p>}
            <button type="submit" disabled={submitting}
              className="w-full rounded-xl bg-blue-700 px-4 py-3.5 font-semibold text-white shadow-lg shadow-blue-950/15 transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-wait disabled:opacity-60">
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div className="mt-6 flex items-start gap-3 rounded-xl bg-slate-50 px-3.5 py-3 text-xs leading-5 text-slate-500">
            <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 size-4 shrink-0 text-blue-700" aria-hidden="true"><path d="M12 3 5 6v5c0 4.3 2.9 8.1 7 9.5 4.1-1.4 7-5.2 7-9.5V6l-7-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <p>Employee accounts are created by an administrator. Your credentials are verified securely by ColdChain Guardian.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
