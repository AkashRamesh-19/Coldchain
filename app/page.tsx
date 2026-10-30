"use client";

import { useCallback, useEffect, useState } from "react";
import { LoginForm, type SessionUser } from "./login-form";

type TemperatureReport = {
  shipmentId: number;
  averageTemperatureC: number;
  readingsCounted: number;
  excursionReadingCount: number;
  outOfRangeProductComparisons: number;
};

type Shipment = {
  shipment_id: number;
  shipment_code: string;
  supplier_name: string;
  source_warehouse: string;
  destination_warehouse: string;
  vehicle_number: string;
  driver_name: string;
  status: string;
};

type Reports = {
  dataNote: string;
  temperatureByShipment: TemperatureReport[];
  unresolvedAlertsBySeverity: Array<{ severity: string; unresolved_count: number }>;
  shipmentCountsByStatus: Array<{ status: string; shipment_count: number }>;
  shipmentOverview: Shipment[];
};

type ResearchReport = {
  dataset: { status: string; revision: string; file: string; source: string; expectedRows: number };
  analysis: {
    rowCount: number;
    shipmentCounts: Record<string, number>;
    meanTMean: number | null;
    riskLevelCounts: Record<string, number>;
    missingRiskLevelCount: number;
    missingProbeCounts: Record<string, number>;
    next120R2: { positive: number; negative: number; missing: number };
    timeRange: { start: string; end: string } | null;
  };
};

export default function Home() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [reports, setReports] = useState<Reports | null>(null);
  const [research, setResearch] = useState<ResearchReport | null>(null);
  const [researchError, setResearchError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState("");

  const loadReports = useCallback(async () => {
    try {
      const response = await fetch("/api/reports", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Could not load reports.");
      setReports(body);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadResearch = useCallback(async () => {
    try {
      const response = await fetch("/api/research/strawberry", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Could not load research analysis.");
      setResearch(body);
      setResearchError("");
    } catch (caught) {
      setResearchError(caught instanceof Error ? caught.message : "Could not load research analysis.");
    }
  }, []);

  const activateSession = useCallback(async (signedIn: SessionUser) => {
    setUser(signedIn);
    setAuthError("");
    setReports(null);
    setResearch(null);
    setLoading(true);
    await Promise.all([loadReports(), loadResearch()]);
  }, [loadReports, loadResearch]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (response.status === 401) return null;
        if (!response.ok || !body.success) throw new Error(body.message ?? "Could not verify your session.");
        return body.user as SessionUser;
      })
      .then(async (sessionUser) => { if (active && sessionUser) await activateSession(sessionUser); })
      .catch((caught: unknown) => {
        if (active) setAuthError(caught instanceof Error ? caught.message : "Could not verify your session.");
      })
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, [activateSession]);

  async function refreshReports() {
    setLoading(true);
    await Promise.all([loadReports(), loadResearch()]);
  }

  async function checkTemperature(shipmentId: number) {
    setChecking(shipmentId);
    setActionMessage("");
    try {
      const response = await fetch(`/api/shipments/${shipmentId}/check-temperature`, { method: "POST" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Temperature check failed.");
      setActionMessage(
        `Shipment ${shipmentId}: checked ${body.readingsChecked} readings, found ${body.excursionReadingCount} excursion readings, and created ${body.alertsCreated} new alerts.`,
      );
      setLoading(true);
      await loadReports();
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : "Temperature check failed.");
    } finally {
      setChecking(null);
    }
  }

  const totalUnresolved = reports?.unresolvedAlertsBySeverity.reduce(
    (total, row) => total + Number(row.unresolved_count),
    0,
  ) ?? 0;
  const totalShipments = reports?.shipmentCountsByStatus.reduce(
    (total, row) => total + Number(row.shipment_count),
    0,
  ) ?? 0;

  if (authLoading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-slate-600" role="status">Checking your ColdChain session…</main>;
  }

  if (!user) {
    return <><LoginForm onAuthenticated={activateSession} />{authError && <p role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{authError}</p>}</>;
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 lg:py-12">
      <header className="flex flex-col gap-6 border-b border-slate-200 pb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">Cold chain operations</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">Guardian</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
            Operational shipment monitoring and separate analysis of published historical strawberry research data.
          </p>
        </div>
        <button
          className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void refreshReports()}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh reports"}
        </button>
      </header>

      <section aria-label="Project status" className="mt-7 grid gap-4 sm:grid-cols-3">
        <Metric label="Shipments" value={loading ? "—" : String(totalShipments)} detail="Current relational records" />
        <Metric label="Unresolved alerts" value={loading ? "—" : String(totalUnresolved)} detail="Grouped by severity below" />
        <Metric label="Research windows" value={research ? String(research.analysis.rowCount) : "—"} detail="Imported historical dataset records" />
      </section>

      {error && <p role="alert" className="mt-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">{error}</p>}
      {actionMessage && <p role="status" className="mt-6 rounded-lg border border-teal-200 bg-teal-50 p-4 text-teal-900">{actionMessage}</p>}

      <section aria-labelledby="research-heading" className="mt-9 rounded-xl border border-sky-200 bg-white shadow-sm">
        <div className="border-b border-sky-100 px-5 py-4 sm:px-6">
          <h2 id="research-heading" className="text-xl font-semibold text-slate-950">Research Dataset Analysis</h2>
          <p className="mt-1 text-sm text-slate-600">Published historical strawberry cold-chain windows, stored separately from operational shipments.</p>
          {research && <p className="mt-2 text-xs text-slate-500">Revision {research.dataset.revision} · {research.dataset.file} · {research.dataset.source}</p>}
        </div>
        {researchError && <p role="alert" className="m-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{researchError}</p>}
        {research?.dataset.status === "not_imported" && <p className="m-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">The verified research file has not been imported. Run <code>npm run import:research</code> to load it into <code>research_strawberry_windows</code>.</p>}
        {research?.dataset.status === "incomplete" && <p role="alert" className="m-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">The research collection has {research.analysis.rowCount.toLocaleString()} of {research.dataset.expectedRows.toLocaleString()} expected records. Re-run the idempotent import to complete it.</p>}
        {research?.dataset.status === "imported" && <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2">
          <div>
            <h3 className="font-semibold text-slate-900">Windows by research shipment</h3>
            <div className="mt-3 space-y-3">{Object.entries(research.analysis.shipmentCounts).map(([id, count]) => <ResearchBar key={id} label={id} value={count} max={Math.max(...Object.values(research.analysis.shipmentCounts), 1)} />)}</div>
            <p className="mt-4 text-sm text-slate-600">Mean recorded window temperature (T_mean): {research.analysis.meanTMean === null ? "No values" : `${research.analysis.meanTMean.toFixed(3)} °C`}</p>
            <p className="mt-1 text-xs text-slate-500">Research time range: {research.analysis.timeRange?.start ?? "—"} to {research.analysis.timeRange?.end ?? "—"}</p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Published labels and missing probe values</h3>
            <div className="mt-3 grid grid-cols-2 gap-2">{Object.entries(research.analysis.riskLevelCounts).map(([risk, count]) => <Breakdown key={risk} label={`Risk ${risk}`} value={count} />)}<Breakdown label="Missing risk label" value={research.analysis.missingRiskLevelCount} /></div>
            <p className="mt-4 text-sm font-medium text-slate-700">Future R2 label (120 minutes)</p>
            <div className="mt-2 grid grid-cols-3 gap-2"><Breakdown label="Positive" value={research.analysis.next120R2.positive} /><Breakdown label="Negative" value={research.analysis.next120R2.negative} /><Breakdown label="Missing" value={research.analysis.next120R2.missing} /></div>
            <p className="mt-4 text-sm font-medium text-slate-700">Missing values by probe</p>
            <div className="mt-2 grid grid-cols-3 gap-2">{Object.entries(research.analysis.missingProbeCounts).map(([probe, count]) => <Breakdown key={probe} label={probe.replaceAll("_", " ")} value={count} />)}</div>
          </div>
        </div>}
      </section>

      <section aria-labelledby="operations-heading" className="mt-9">
      <div className="mb-4"><h2 id="operations-heading" className="text-xl font-semibold text-slate-950">Operational Shipment Monitoring</h2><p className="mt-1 text-sm text-slate-600">Current operational records from MySQL and shipment-linked MongoDB readings.</p></div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
            <h2 className="text-lg font-semibold text-slate-950">Shipment overview</h2>
            <p className="mt-1 text-sm text-slate-600">Supplier, route endpoints, vehicle and status from the MySQL view.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-3">Shipment</th><th className="px-5 py-3">Route</th><th className="px-5 py-3">Vehicle / driver</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(reports?.shipmentOverview ?? []).map((shipment) => (
                  <tr key={shipment.shipment_id}>
                    <td className="px-5 py-4"><span className="font-semibold text-slate-900">{shipment.shipment_code}</span><span className="mt-1 block text-xs text-slate-500">{shipment.supplier_name}</span></td>
                    <td className="px-5 py-4 text-slate-700">{shipment.source_warehouse} → {shipment.destination_warehouse}</td>
                    <td className="px-5 py-4 text-slate-700">{shipment.vehicle_number}<span className="mt-1 block text-xs text-slate-500">{shipment.driver_name}</span></td>
                    <td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{shipment.status.replaceAll("_", " ")}</span></td>
                    <td className="px-5 py-4"><button onClick={() => void checkTemperature(shipment.shipment_id)} disabled={checking !== null} className="whitespace-nowrap rounded-md bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{checking === shipment.shipment_id ? "Checking…" : "Check temperatures"}</button></td>
                  </tr>
                ))}
                {!loading && reports?.shipmentOverview.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">No shipments are available.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-8">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold text-slate-950">Shipment status</h2>
            <div className="mt-4 space-y-3">
              {(reports?.shipmentCountsByStatus ?? []).map((row) => <Breakdown key={row.status} label={row.status.replaceAll("_", " ")} value={row.shipment_count} />)}
              {!loading && reports?.shipmentCountsByStatus.length === 0 && <p className="text-sm text-slate-500">No status records.</p>}
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold text-slate-950">Unresolved alerts</h2>
            <div className="mt-4 space-y-3">
              {(reports?.unresolvedAlertsBySeverity ?? []).map((row) => <Breakdown key={row.severity} label={row.severity} value={row.unresolved_count} />)}
              {!loading && reports?.unresolvedAlertsBySeverity.length === 0 && <p className="text-sm text-slate-500">No unresolved alerts.</p>}
            </div>
          </section>
        </aside>
      </div>

      <section className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
          <h2 className="text-lg font-semibold text-slate-950">Temperature report</h2>
          <p className="mt-1 text-sm text-slate-600">Average is computed from MongoDB sensor readings. An excursion reading is outside at least one carried product’s MySQL range.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Shipment ID</th><th className="px-5 py-3">Average recorded °C</th><th className="px-5 py-3">Readings</th><th className="px-5 py-3">Excursion readings</th><th className="px-5 py-3">Out-of-range product comparisons</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(reports?.temperatureByShipment ?? []).map((row) => <tr key={row.shipmentId}><td className="px-5 py-4 font-semibold text-slate-900">{row.shipmentId}</td><td className="px-5 py-4">{row.averageTemperatureC.toFixed(2)} °C</td><td className="px-5 py-4">{row.readingsCounted}</td><td className="px-5 py-4">{row.excursionReadingCount}</td><td className="px-5 py-4">{row.outOfRangeProductComparisons}</td></tr>)}
              {!loading && reports?.temperatureByShipment.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">No shipment readings are available.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-4 text-xs leading-5 text-slate-500 sm:px-6">{reports?.dataNote ?? "Operational readings are shown only for operational shipments."} Readings are shipment-level and are compared against every distinct product range; they are not mapped to individual items.</p>
      </section>
      </section>
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

function Breakdown({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5"><span className="text-sm font-medium text-slate-700">{label}</span><span className="text-sm font-semibold text-slate-950">{value}</span></div>;
}

function ResearchBar({ label, value, max }: { label: string; value: number; max: number }) {
  return <div className="grid grid-cols-[2rem_1fr_4rem] items-center gap-3 text-sm"><span className="font-medium text-slate-600">{label}</span><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-600" style={{ width: `${Math.max(0, Math.min(100, value / max * 100))}%` }} /></div><span className="text-right tabular-nums text-slate-700">{value.toLocaleString()}</span></div>;
}
