"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { LoginForm, type SessionUser } from "../login-form";

const SessionContext = createContext<SessionUser | null>(null);
export function useSessionUser() { return useContext(SessionContext); }

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/alerts", label: "Alerts" },
  { href: "/reports", label: "Reports" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (response.status === 401) return null;
        if (!response.ok || !body.success) throw new Error(body.message ?? "Unable to check session.");
        return body.user as SessionUser;
      })
      .then((session) => { if (active) setUser(session); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Unable to check session."); })
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, []);

  async function signOut() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Unable to sign out.");
      setUser(null);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign out.");
    }
  }

  if (checkingSession) return <main className="flex min-h-screen items-center justify-center text-sm text-slate-600" role="status">Checking your session…</main>;
  if (!user) return <><LoginForm onAuthenticated={(session) => { setUser(session); setError(""); }} />{error && <p role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}</>;

  return (
    <SessionContext.Provider value={user}>
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
            <Link href="/" className="text-lg font-bold text-slate-950">ColdChain Guardian</Link>
            <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-2">
              {links.map((link) => <Link key={link.href} href={link.href} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">{link.label}</Link>)}
              {user.role === "ADMIN" && <Link href="/settings" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Settings</Link>}
            </nav>
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-slate-600 sm:inline">{user.full_name} · {user.role.replaceAll("_", " ")}</span>
              <button onClick={() => void signOut()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Sign out</button>
            </div>
          </div>
        </header>
        {error && <p role="alert" className="mx-auto mt-4 max-w-7xl rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
        {children}
      </div>
    </SessionContext.Provider>
  );
}
