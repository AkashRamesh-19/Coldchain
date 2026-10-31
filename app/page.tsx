"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./components/app-shell";

type ReportData = {
  dataNote: string;
  shipmentOverview: Array<{ shipment_id: number; shipment_code: string; supplier_name: string; source_warehouse: string; destination_warehouse: string; vehicle_number: string; driver_name: string; status: string }>;
  shipmentCountsByStatus: Array<{ status: string; shipment_count: number }>;
  alertTotals: { total_alerts: number; unresolved_alerts: number; resolved_alerts: number };
  unresolvedAlertsBySeverity: Array<{ severity: string; unresolved_count: number }>;
  temperatureByShipment: Array<{ shipmentId: number; averageTemperatureC: number; readingsCounted: number; excursionReadingCount: number }>;
  alertCountsBySeverity: Array<{ severity: string; total_alerts: number; unresolved_alerts: number; resolved_alerts: number }>;
};

function DashboardContent() {
  const [reports, setReports] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  const loadReports = useCallback(async () => {
    try {
      const response = await fetch("/api/reports", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Could not load dashboard data.");
      setReports(body);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load dashboard data.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/reports", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.message ?? "Could not load dashboard data.");
        if (active) { setReports(body); setError(""); }
      })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load dashboard data."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function checkTemperature(shipmentId: number) {
    setChecking(shipmentId);
    setMessage("");
    try {
      const response = await fetch(`/api/shipments/${shipmentId}/check-temperature`, { method: "POST" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Temperature check failed.");
      setMessage(`Checked ${body.readingsChecked} readings for ${shipmentId}; found ${body.excursionReadingCount} excursions and created ${body.alertsCreated} alerts.`);
      setLoading(true);
      await loadReports();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Temperature check failed."); }
    finally { setChecking(null); }
  }

  const shipmentCount = reports?.shipmentCountsByStatus.reduce((sum, row) => sum + Number(row.shipment_count), 0);
  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Cold chain operations</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Dashboard</h1><p className="mt-1 text-sm text-slate-600">Operational shipment status and current alerts.</p></div>
        <button onClick={() => { setLoading(true); void loadReports(); }} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      <section className="grid gap-4 sm:grid-cols-3">
        <Metric label="Operational shipments" value={loading || shipmentCount === undefined ? "—" : shipmentCount.toLocaleString()} detail="Excludes classified demo records" />
        <Metric label="Unresolved alerts" value={loading || !reports ? "—" : String(reports.alertTotals.unresolved_alerts)} detail="Across operational shipments" />
        <Metric label="Resolved alerts" value={loading || !reports ? "—" : String(reports.alertTotals.resolved_alerts)} detail="Refreshed from current database totals" />
      </section>
      {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="mt-5 rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">{message}</p>}
      <section className="mt-7 grid gap-6 lg:grid-cols-[1.6fr_0.8fr]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-950">Shipments</h2><p className="mt-1 text-sm text-slate-600">Generated `SAMPLE-CCG-*` entries are demonstration scenarios, not real freight.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Shipment</th><th className="px-4 py-3">Route</th><th className="px-4 py-3">Vehicle / driver</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">
            {reports?.shipmentOverview.map((shipment) => <tr key={shipment.shipment_id}><td className="px-4 py-4"><strong>{shipment.shipment_code}</strong><span className="block text-xs text-slate-500">{shipment.supplier_name}</span></td><td className="px-4 py-4">{shipment.source_warehouse} → {shipment.destination_warehouse}</td><td className="px-4 py-4">{shipment.vehicle_number}<span className="block text-xs text-slate-500">{shipment.driver_name}</span></td><td className="px-4 py-4">{shipment.status.replaceAll("_", " ")}</td><td className="px-4 py-4"><button onClick={() => void checkTemperature(shipment.shipment_id)} disabled={checking !== null} className="rounded-md bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{checking === shipment.shipment_id ? "Checking…" : "Check temperatures"}</button></td></tr>)}
            {!loading && reports?.shipmentOverview.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No operational shipments yet.</td></tr>}
          </tbody></table></div>
        </div>
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-950">Shipment status</h2><div className="mt-3 space-y-2">{reports?.shipmentCountsByStatus.map((row) => <Breakdown key={row.status} label={row.status.replaceAll("_", " ")} value={row.shipment_count} />)}{!loading && reports?.shipmentCountsByStatus.length === 0 && <p className="text-sm text-slate-500">No status records.</p>}</div></section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-950">Unresolved alerts</h2><div className="mt-3 space-y-2">{reports?.unresolvedAlertsBySeverity.map((row) => <Breakdown key={row.severity} label={row.severity} value={row.unresolved_count} />)}{!loading && reports?.unresolvedAlertsBySeverity.length === 0 && <p className="text-sm text-slate-500">No unresolved alerts.</p>}</div></section>
        </div>
      </section>
      <section className="mt-7 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-950">Temperature summary</h2><p className="mt-1 text-sm text-slate-600">Shipment-level MongoDB readings compared with carried products’ MySQL temperature limits.</p></div><div className="divide-y divide-slate-100">{reports?.temperatureByShipment.map((row) => <div key={row.shipmentId} className="grid grid-cols-2 gap-2 px-5 py-3 text-sm sm:grid-cols-4"><span>Shipment {row.shipmentId}</span><span>Avg {row.averageTemperatureC.toFixed(2)} °C</span><span>{row.readingsCounted} readings</span><span>{row.excursionReadingCount} excursions</span></div>)}{!loading && reports?.temperatureByShipment.length === 0 && <p className="px-5 py-7 text-center text-sm text-slate-500">No sensor readings available.</p>}</div></section>
      <p className="mt-4 text-xs text-slate-500">{reports?.dataNote}</p>
    </main>
  );
}

export default function Home() { return <AppShell><DashboardContent /></AppShell>; }
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>; }
function Breakdown({ label, value }: { label: string; value: number }) { return <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-sm"><span>{label}</span><strong>{Number(value).toLocaleString()}</strong></div>; }
