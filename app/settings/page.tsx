"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppShell, useSessionUser } from "../components/app-shell";

type StaffRole = "OPERATIONS_STAFF" | "LOGISTICS_MANAGER";
type UserRecord = {
  user_id: number;
  full_name: string;
  email: string;
  role: string;
  is_active: number | boolean;
  created_at: string;
};

function SettingsContent() {
  const currentUser = useSessionUser();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("OPERATIONS_STAFF");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createdEmployeeId, setCreatedEmployeeId] = useState<number | null>(null);

  const loadUsers = useCallback(async () => {
    if (currentUser?.role !== "ADMIN") return;
    try {
      const response = await fetch("/api/users", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Could not load employee accounts.");
      setUsers(body.users as UserRecord[]);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load employee accounts.");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.role]);

  useEffect(() => {
    if (currentUser?.role !== "ADMIN") return;
    let active = true;
    fetch("/api/users", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.message ?? "Could not load employee accounts.");
        if (active) { setUsers(body.users as UserRecord[]); setError(""); }
      })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load employee accounts."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentUser?.role]);

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    setCreatedEmployeeId(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: name, email, password, role }),
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Could not create the employee account.");
      setCreatedEmployeeId(Number(body.user.user_id));
      setMessage(`Account created for ${body.user.full_name}. Share the generated employee ID and sign-in details with them securely.`);
      setName("");
      setEmail("");
      setPassword("");
      setLoading(true);
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the employee account.");
    } finally {
      setSubmitting(false);
    }
  }

  if (currentUser?.role !== "ADMIN") {
    return <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8"><section className="rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-2xl font-bold text-slate-950">Administrator settings</h1><p className="mt-2 text-sm text-amber-900">Only an administrator can manage employee accounts.</p></section></main>;
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Administration</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Settings</h1><p className="mt-1 text-sm text-slate-600">Create and review employee accounts for your organization.</p></div><button type="button" onClick={() => { setLoading(true); void loadUsers(); }} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{loading ? "Refreshing…" : "Refresh accounts"}</button></div>
      {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {message && <div role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}{createdEmployeeId !== null && <p className="mt-2 font-semibold">Generated employee ID: {createdEmployeeId}</p>}</div>}

      <section className="mt-7 grid items-start gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5"><h2 className="text-lg font-semibold text-slate-950">Add employee</h2><p className="mt-1 text-sm text-slate-600">The employee ID is generated after account creation. Passwords are stored as hashes by the backend.</p></div>
          <form onSubmit={createEmployee} className="space-y-4">
            <Field label="Full name" htmlFor="employee-name"><input id="employee-name" name="name" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
            <Field label="Email" htmlFor="employee-email"><input id="employee-email" name="email" type="email" autoComplete="email" required maxLength={150} value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} /></Field>
            <Field label="Initial password" htmlFor="employee-password"><input id="employee-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} /><span className="mt-1 block text-xs text-slate-500">Use at least 12 characters. Give it to the employee through a secure channel.</span></Field>
            <Field label="Role" htmlFor="employee-role"><select id="employee-role" name="role" value={role} onChange={(event) => setRole(event.target.value as StaffRole)} className={inputClass}><option value="OPERATIONS_STAFF">Operations staff</option><option value="LOGISTICS_MANAGER">Logistics manager</option></select></Field>
            <button type="submit" disabled={submitting} className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60">{submitting ? "Creating account…" : "Add employee"}</button>
          </form>
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="accounts-heading">
          <div className="border-b border-slate-200 px-5 py-4"><h2 id="accounts-heading" className="font-semibold text-slate-950">Employee accounts</h2><p className="mt-1 text-sm text-slate-600">Email, generated ID, role and account status. Passwords are never displayed.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Name / ID</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">
            {users.filter((account) => account.user_id !== currentUser.user_id).map((account) => <tr key={account.user_id}><td className="px-4 py-3"><strong>{account.full_name}</strong><span className="block text-xs text-slate-500">ID {account.user_id}</span></td><td className="px-4 py-3">{account.email}</td><td className="px-4 py-3">{account.role.replaceAll("_", " ")}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${Boolean(account.is_active) ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{Boolean(account.is_active) ? "Active" : "Inactive"}</span></td></tr>)}
            {!loading && users.filter((account) => account.user_id !== currentUser.user_id).length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-500">No employee accounts yet. Use Add employee to create the first one.</td></tr>}
            {loading && <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-500">Loading accounts…</td></tr>}
          </tbody></table></div>
        </section>
      </section>
    </main>
  );
}

const inputClass = "w-full rounded-lg border border-slate-300 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100";
function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) { return <div><label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>{children}</div>; }
export default function SettingsPage() { return <AppShell><SettingsContent /></AppShell>; }
