"use client";

import { FormEvent, useState } from "react";

export type SessionUser = {
  user_id: number;
  full_name: string;
  email: string;
  role: string;
};

export function LoginForm({ onAuthenticated }: { onAuthenticated: (user: SessionUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
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
    <main className="flex min-h-screen items-center justify-center bg-blue-700 px-5 py-10">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl sm:p-10" aria-labelledby="login-title">
        <div className="mb-7 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Cold chain operations</p>
          <h1 id="login-title" className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Guardian sign in</h1>
          <p className="mt-2 text-sm text-slate-600">Sign in with your assigned ColdChain account.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <input id="login-email" name="email" type="email" autoComplete="username" required maxLength={150}
              value={email} onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-3 text-slate-900 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100" />
          </div>
          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
            <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={200}
              value={password} onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-3 text-slate-900 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100" />
          </div>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</p>}
          <button type="submit" disabled={submitting}
            className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-wait disabled:opacity-60">
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-center text-xs leading-5 text-slate-500">Access is managed by your ColdChain administrator. Passwords are never shown or stored in this page.</p>
      </section>
    </main>
  );
}
