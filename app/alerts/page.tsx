"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, useSessionUser } from "../components/app-shell";

type AlertRecord = {
  alert_id: number;
  shipment_id: number;
  shipment_code: string;
  alert_type: string;
  severity: string;
  message: string;
  sensor_value: number | string | null;
  threshold_value: number | string | null;
  is_resolved: number | boolean;
  created_at: string;
  resolved_at: string | null;
  shipment_status: string;
  supplier_name: string;
  source_warehouse: string;
  destination_warehouse: string;
  route_name: string;
  vehicle_number: string;
  driver_name: string;
  products: string | null;
};

type AlertTotals = { total_alerts: number | string; unresolved_alerts: number | string; resolved_alerts: number | string };
type AlertFilter = "unresolved" | "resolved" | "all";

function AlertsContent() {
  const user = useSessionUser();
  const [filter, setFilter] = useState<AlertFilter>("unresolved");
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [totals, setTotals] = useState<AlertTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadAlerts = useCallback(async () => {
    try {
      const response = await fetch(`/api/alerts?status=${filter}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Could not load alerts.");
      setAlerts(body.alerts as AlertRecord[]);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load alerts.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadTotals = useCallback(async () => {
    try {
      const response = await fetch("/api/reports", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Could not refresh alert totals.");
      setTotals(body.alertTotals as AlertTotals);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not refresh alert totals.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/alerts?status=${filter}`, { cache: "no-store" }),
      fetch("/api/reports", { cache: "no-store" }),
    ])
      .then(async ([alertsResponse, reportsResponse]) => {
        const [alertsBody, reportsBody] = await Promise.all([alertsResponse.json(), reportsResponse.json()]);
        if (!alertsResponse.ok || !alertsBody.success) throw new Error(alertsBody.message ?? "Could not load alerts.");
        if (!reportsResponse.ok || !reportsBody.success) throw new Error(reportsBody.message ?? "Could not load alert totals.");
        if (active) { setAlerts(alertsBody.alerts as AlertRecord[]); setTotals(reportsBody.alertTotals as AlertTotals); setError(""); }
      })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load alerts."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filter]);

  async function resolveAlert(alertId: number) {
    setResolving(alertId);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Could not resolve this alert.");
      setLoading(true);
      await Promise.all([loadAlerts(), loadTotals()]);
      setMessage(`Alert ${alertId} was marked solved. The operational analytics totals have been refreshed.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resolve this alert.");
    } finally {
      setResolving(null);
    }
  }

  const canResolve = user?.role === "ADMIN" || user?.role === "LOGISTICS_MANAGER";
  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
      <PageHeading eyebrow="Operational shipment monitoring" title="Alerts" description="Review current alert details alongside the affected shipment and route." onRefresh={() => { setLoading(true); void loadAlerts(); void loadTotals(); }} loading={loading} />
      <section className="mt-6 grid gap-4 sm:grid-cols-3" aria-label="Alert totals from operational reports">
        <Metric label="All alerts" value={totals ? totals.total_alerts : "—"} />
        <Metric label="Unresolved" value={totals ? totals.unresolved_alerts : "—"} />
        <Metric label="Solved" value={totals ? totals.resolved_alerts : "—"} />
      </section>
      {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}

      <section className="mt-7 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div><h2 className="font-semibold text-slate-950">Shipment alerts</h2><p className="mt-1 text-sm text-slate-600">Alert status and counts come from the current operational API records.</p></div>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Filter alerts">
            {(["unresolved", "resolved", "all"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setLoading(true); setFilter(value); }} className={`rounded-md px-3 py-2 text-sm font-medium capitalize ${filter === value ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{value === "resolved" ? "Solved" : value}</button>)}
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {loading && <p className="px-5 py-10 text-center text-sm text-slate-500" role="status">Loading alerts…</p>}
          {!loading && alerts.length === 0 && <p className="px-5 py-12 text-center text-sm text-slate-500">No {filter === "all" ? "operational" : filter} alerts are available.</p>}
          {!loading && alerts.map((alert) => {
            const solved = Boolean(alert.is_resolved);
            return <article key={alert.alert_id} className="px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-950">{alert.shipment_code}</h3><Badge tone={alert.severity === "CRITICAL" || alert.severity === "HIGH" ? "red" : alert.severity === "MEDIUM" ? "amber" : "slate"}>{alert.severity}</Badge><Badge tone={solved ? "green" : "blue"}>{solved ? "Solved" : "Unresolved"}</Badge></div>
                  <p className="mt-2 max-w-3xl text-sm text-slate-700">{alert.message}</p>
                </div>
                <p className="text-xs text-slate-500">{formatDate(alert.created_at)}</p>
              </div>
              <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="Shipment status" value={alert.shipment_status.replaceAll("_", " ")} />
                <Detail label="Supplier" value={alert.supplier_name} />
                <Detail label="Route" value={alert.route_name} />
                <Detail label="Vehicle / driver" value={`${alert.vehicle_number} · ${alert.driver_name}`} />
                <Detail label="From" value={alert.source_warehouse} />
                <Detail label="To" value={alert.destination_warehouse} />
                <Detail label="Products" value={alert.products || "No product details"} />
                <Detail label="Measurement / threshold" value={`${formatNumber(alert.sensor_value)} °C / ${formatNumber(alert.threshold_value)} °C`} />
              </dl>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                {solved ? <p className="text-xs text-slate-500">Solved {alert.resolved_at ? `on ${formatDate(alert.resolved_at)}` : ""}</p> : <p className="text-xs text-slate-500">Shipment ID {alert.shipment_id} · Alert ID {alert.alert_id}</p>}
                {!solved && canResolve && <button type="button" onClick={() => void resolveAlert(alert.alert_id)} disabled={resolving !== null} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60">{resolving === alert.alert_id ? "Saving…" : "Mark solved"}</button>}
                {!solved && !canResolve && <p className="text-xs text-amber-800">Only a logistics manager or administrator can resolve alerts.</p>}
              </div>
            </article>;
          })}
        </div>
      </section>
    </main>
  );
}

export default function AlertsPage() { return <AppShell><AlertsContent /></AppShell>; }

function PageHeading({ eyebrow, title, description, onRefresh, loading }: { eyebrow: string; title: string; description: string; onRefresh: () => void; loading: boolean }) {
  return <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">{eyebrow}</p><h1 className="mt-2 text-3xl font-bold text-slate-950">{title}</h1><p className="mt-1 text-sm text-slate-600">{description}</p></div><button type="button" onClick={onRefresh} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{loading ? "Refreshing…" : "Refresh"}</button></div>;
}
function Metric({ label, value }: { label: string; value: number | string }) { return <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-950">{Number(value).toLocaleString()}</p></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-800">{value}</dd></div>; }
function Badge({ children, tone }: { children: string; tone: "red" | "amber" | "green" | "blue" | "slate" }) {
  const classes = { red: "bg-red-100 text-red-800", amber: "bg-amber-100 text-amber-800", green: "bg-emerald-100 text-emerald-800", blue: "bg-blue-100 text-blue-800", slate: "bg-slate-100 text-slate-700" };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classes[tone]}`}>{children}</span>;
}
function formatNumber(value: number | string | null) { if (value === null || value === "") return "—"; const number = Number(value); return Number.isFinite(number) ? number.toFixed(2) : "—"; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
