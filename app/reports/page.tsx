"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppShell } from "../components/app-shell";

type ResearchAnalysis = {
  rowCount: number;
  shipmentCounts: Record<string, number>;
  meanTMean: number | null;
  temperatureStats: {
    measurementBasis: string;
    meanC: number | null;
    minimumC: number | null;
    maximumC: number | null;
    probeMeasurementsCounted: number;
    probeStats: Record<string, { count: number; meanC: number | null; minimumC: number | null; maximumC: number | null }>;
  };
  temperatureTrend: Array<{ date: string; meanC: number; measurementsCounted: number }>;
  temperatureExcursions: null | {
    threshold: { minimumC: number; maximumC: number };
    excursionWindowCount: number;
    excursionProbeCount: number;
    exposureIndexPercent: number | null;
    probeProfile: Array<{ probe: string; observedCount: number; missingCount: number; excursionCount: number; excursionRatePercent: number | null; missingRatePercent: number | null }>;
  };
  riskLevelCounts: Record<string, number>;
  missingRiskLevelCount: number;
  missingProbeCounts: Record<string, number>;
  next120R2: { positive: number; negative: number; missing: number };
  timeRange: { start: string; end: string } | null;
};

type ResearchResponse = {
  dataset: { id: string; revision: string; file: string; sha256: string; expectedRows: number; importedAt: string | null; status: string; source: string };
  analysis: ResearchAnalysis;
};
type OperationalReport = {
  dataNote: string;
  shipmentCountsByStatus: Array<{ status: string; shipment_count: number | string }>;
  alertTotals: { total_alerts: number | string; unresolved_alerts: number | string; resolved_alerts: number | string };
  alertCountsBySeverity: Array<{ severity: string; total_alerts: number | string; unresolved_alerts: number | string; resolved_alerts: number | string }>;
  shipmentsByRoute: Array<Record<string, string | number | null>>;
  monthlyShipments: Array<{ month: string; shipment_count: number | string; delivered_shipments: number | string; active_shipments: number | string }>;
};

function ReportsContent() {
  const [research, setResearch] = useState<ResearchResponse | null>(null);
  const [operational, setOperational] = useState<OperationalReport | null>(null);
  const [shipmentId, setShipmentId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [minimumTemperature, setMinimumTemperature] = useState("");
  const [maximumTemperature, setMaximumTemperature] = useState("");
  const [researchLoading, setResearchLoading] = useState(true);
  const [operationalLoading, setOperationalLoading] = useState(true);
  const [researchError, setResearchError] = useState("");
  const [operationalError, setOperationalError] = useState("");

  const loadResearch = useCallback(async (filters?: { shipmentId?: string; start?: string; end?: string; minTemperatureC?: string; maxTemperatureC?: string }) => {
    const params = new URLSearchParams();
    if (filters?.shipmentId) params.set("shipmentId", filters.shipmentId);
    if (filters?.start) params.set("start", filters.start);
    if (filters?.end) params.set("end", filters.end);
    if (filters?.minTemperatureC) params.set("minTemperatureC", filters.minTemperatureC);
    if (filters?.maxTemperatureC) params.set("maxTemperatureC", filters.maxTemperatureC);
    try {
      const response = await fetch(`/api/research/strawberry${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Could not load research analysis.");
      setResearch(body as ResearchResponse);
      setResearchError("");
    } catch (caught) {
      setResearchError(caught instanceof Error ? caught.message : "Could not load research analysis.");
    } finally {
      setResearchLoading(false);
    }
  }, []);

  const loadOperational = useCallback(async () => {
    try {
      const response = await fetch("/api/reports", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Could not load operational reports.");
      setOperational(body as OperationalReport);
      setOperationalError("");
    } catch (caught) {
      setOperationalError(caught instanceof Error ? caught.message : "Could not load operational reports.");
    } finally {
      setOperationalLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/research/strawberry", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.message ?? "Could not load research analysis.");
        if (active) { setResearch(body as ResearchResponse); setResearchError(""); }
      })
      .catch((caught: unknown) => { if (active) setResearchError(caught instanceof Error ? caught.message : "Could not load research analysis."); })
      .finally(() => { if (active) setResearchLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/reports", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.message ?? "Could not load operational reports.");
        if (active) { setOperational(body as OperationalReport); setOperationalError(""); }
      })
      .catch((caught: unknown) => { if (active) setOperationalError(caught instanceof Error ? caught.message : "Could not load operational reports."); })
      .finally(() => { if (active) setOperationalLoading(false); });
    return () => { active = false; };
  }, []);

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (start && end && start > end) {
      setResearchError("Start date must be earlier than or equal to the end date.");
      return;
    }
    if (Boolean(minimumTemperature) !== Boolean(maximumTemperature)) {
      setResearchError("Enter both temperature bounds to calculate the spatial exposure profile, or leave both blank.");
      return;
    }
    if (minimumTemperature && maximumTemperature && Number(minimumTemperature) >= Number(maximumTemperature)) {
      setResearchError("The minimum temperature must be lower than the maximum temperature.");
      return;
    }
    setResearchLoading(true);
    await loadResearch({ shipmentId, start, end, minTemperatureC: minimumTemperature, maxTemperatureC: maximumTemperature });
  }

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-5 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Data and operational analytics</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Reports</h1><p className="mt-1 text-sm text-slate-600">Research analysis uses published historical records; operational summaries use current shipment APIs.</p></div><button type="button" onClick={() => { setResearchLoading(true); setOperationalLoading(true); void loadResearch({ shipmentId, start, end, ...(minimumTemperature && maximumTemperature ? { minTemperatureC: minimumTemperature, maxTemperatureC: maximumTemperature } : {}) }); void loadOperational(); }} disabled={researchLoading || operationalLoading} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Refresh reports</button></div>

      <section className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm" aria-labelledby="research-heading">
        <div className="border-b border-slate-200 px-5 py-5 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">Published historical data</p><h2 id="research-heading" className="mt-1 text-2xl font-bold text-slate-950">Research Dataset Analysis</h2><p className="mt-1 text-sm text-slate-600">Strawberry cold-chain research windows, kept separate from operational shipment records.</p></div><StatusBadge status={research?.dataset.status ?? (researchLoading ? "loading" : "unavailable")} />
          </div>
          {research && <p className="mt-3 break-words text-xs leading-5 text-slate-500">Source: {research.dataset.source} · Revision {research.dataset.revision} · {research.dataset.file} · SHA-256 {research.dataset.sha256}</p>}
          {research?.dataset.importedAt && <p className="mt-1 text-xs text-slate-500">Imported at {new Date(research.dataset.importedAt).toLocaleString()} · Expected full dataset: {research.dataset.expectedRows.toLocaleString()} windows</p>}
        </div>
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <form onSubmit={applyFilters} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 2xl:items-end">
            <label className="block text-sm font-medium text-slate-700">Research shipment<select value={shipmentId} onChange={(event) => setShipmentId(event.target.value)} className={inputClass}><option value="">All research shipments</option>{Object.keys(research?.analysis.shipmentCounts ?? {}).map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
            <label className="block text-sm font-medium text-slate-700">From date<input type="date" value={start} onChange={(event) => setStart(event.target.value)} className={inputClass} /></label>
            <label className="block text-sm font-medium text-slate-700">To date<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className={inputClass} /></label>
            <label className="block text-sm font-medium text-slate-700">Minimum °C<input type="number" step="any" value={minimumTemperature} onChange={(event) => setMinimumTemperature(event.target.value)} placeholder="Optional" className={inputClass} /></label>
            <label className="block text-sm font-medium text-slate-700">Maximum °C<input type="number" step="any" value={maximumTemperature} onChange={(event) => setMaximumTemperature(event.target.value)} placeholder="Optional" className={inputClass} /></label>
            <button type="submit" disabled={researchLoading} className="rounded-lg bg-blue-700 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">{researchLoading ? "Loading…" : "Apply filters"}</button>
          </form>
        </div>
        {researchError && <p role="alert" className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:mx-6">{researchError}</p>}
        {researchLoading && <p className="px-5 py-8 text-center text-sm text-slate-500" role="status">Loading research dataset analysis…</p>}
        {!researchLoading && research && <div className="p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Filtered windows" value={research.analysis.rowCount} detail={`of ${research.dataset.expectedRows.toLocaleString()} pinned research windows`} />
            <Metric label="Mean recorded T_mean" value={temperature(research.analysis.meanTMean)} detail="Computed over the current filter" />
            <Metric label="Available probe mean" value={temperature(research.analysis.temperatureStats.meanC)} detail={`${research.analysis.temperatureStats.probeMeasurementsCounted.toLocaleString()} non-missing measurements`} />
            <Metric label="Unlabeled risk rows" value={research.analysis.missingRiskLevelCount} detail="Missing labels are preserved" />
          </div>
          <section className="mt-7 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 sm:p-5" aria-labelledby="novelty-heading">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">Project novelty · deterministic, no LLM</p><h3 id="novelty-heading" className="mt-1 text-lg font-semibold text-slate-950">Spatial excursion and data-completeness profile</h3><p className="mt-1 text-sm text-slate-700">Uses the published nine-probe layout to show which container positions exceed the bounds you enter and where source measurements are missing. This is a transparent rule-based analysis, not a prediction.</p></div>
            {research.analysis.temperatureExcursions ? <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2"><Metric label="Spatial exposure index" value={research.analysis.temperatureExcursions.exposureIndexPercent === null ? null : `${research.analysis.temperatureExcursions.exposureIndexPercent}%`} detail={`Out-of-range probe measurements ÷ available probe measurements · bounds ${research.analysis.temperatureExcursions.threshold.minimumC} to ${research.analysis.temperatureExcursions.threshold.maximumC} °C`} /><Metric label="Windows with excursions" value={research.analysis.temperatureExcursions.excursionWindowCount} detail={`${research.analysis.temperatureExcursions.excursionProbeCount.toLocaleString()} out-of-range probe measurements`} /></div>
              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2.5">Rank</th><th className="px-3 py-2.5">Probe position</th><th className="px-3 py-2.5">Valid readings</th><th className="px-3 py-2.5">Excursions</th><th className="px-3 py-2.5">Excursion rate</th><th className="px-3 py-2.5">Missing values</th></tr></thead><tbody className="divide-y divide-slate-100">{research.analysis.temperatureExcursions.probeProfile.map((probe, index) => <tr key={probe.probe}><td className="px-3 py-2.5 text-slate-500">{probe.excursionRatePercent === null ? "—" : index + 1}</td><td className="px-3 py-2.5 font-medium">{probe.probe.replaceAll("_", " ")}</td><td className="px-3 py-2.5">{probe.observedCount.toLocaleString()}</td><td className="px-3 py-2.5">{probe.excursionCount.toLocaleString()}</td><td className="px-3 py-2.5">{probe.excursionRatePercent === null ? "No readings" : `${probe.excursionRatePercent}%`}</td><td className="px-3 py-2.5">{probe.missingCount.toLocaleString()} ({probe.missingRatePercent === null ? "—" : `${probe.missingRatePercent}%`})</td></tr>)}</tbody></table><p className="px-3 py-2 text-xs text-slate-500">Sorted by per-position excursion rate; positions without valid measurements have no rate and appear last.</p></div>
            </> : <p className="mt-4 rounded-lg border border-indigo-100 bg-white px-4 py-3 text-sm text-slate-600">Enter both temperature bounds above and apply filters to calculate position-level exposure. Missing probe values are excluded from the exposure denominator and reported separately.</p>}
          </section>
          <div className="mt-7 grid gap-7 xl:grid-cols-2">
            <section><h3 className="font-semibold text-slate-950">Windows by research shipment</h3><div className="mt-4 space-y-3">{Object.entries(research.analysis.shipmentCounts).map(([id, count]) => <HorizontalBar key={id} label={id} value={count} max={Math.max(...Object.values(research.analysis.shipmentCounts), 1)} />)}{research.analysis.rowCount === 0 && <p className="text-sm text-slate-500">No rows match the selected filters.</p>}</div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3"><SmallStat label="Risk 0" value={research.analysis.riskLevelCounts["0"] ?? 0} /><SmallStat label="Risk 1" value={research.analysis.riskLevelCounts["1"] ?? 0} /><SmallStat label="Risk 2" value={research.analysis.riskLevelCounts["2"] ?? 0} /><SmallStat label="Missing risk" value={research.analysis.missingRiskLevelCount} /></div>
            </section>
            <section><h3 className="font-semibold text-slate-950">Future R2 label (120 minutes)</h3><div className="mt-3 grid gap-3 sm:grid-cols-3"><SmallStat label="Positive" value={research.analysis.next120R2.positive} /><SmallStat label="Negative" value={research.analysis.next120R2.negative} /><SmallStat label="Missing" value={research.analysis.next120R2.missing} /></div>
              <h3 className="mt-7 font-semibold text-slate-950">Missing values by probe</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(research.analysis.missingProbeCounts).map(([probe, count]) => <SmallStat key={probe} label={probe.replaceAll("_", " ")} value={count} />)}</div>
            </section>
          </div>
          <section className="mt-8"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold text-slate-950">Daily average probe temperature</h3><p className="text-xs text-slate-500">{research.analysis.temperatureStats.measurementBasis}</p></div><div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-100 p-3">{research.analysis.temperatureTrend.map((point) => <HorizontalBar key={point.date} label={point.date} value={point.meanC} max={Math.max(...research.analysis.temperatureTrend.map((item) => item.meanC), 1)} suffix={`°C · ${point.measurementsCounted.toLocaleString()} values`} />)}{research.analysis.temperatureTrend.length === 0 && <p className="py-5 text-center text-sm text-slate-500">No temperature measurements in this filter.</p>}</div>
            {research.analysis.timeRange && <p className="mt-3 text-xs text-slate-500">Selected data time range: {research.analysis.timeRange.start} to {research.analysis.timeRange.end} · Recorded probe range {temperature(research.analysis.temperatureStats.minimumC)} to {temperature(research.analysis.temperatureStats.maximumC)}</p>}
          </section>
        </div>}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="operational-heading">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:px-6"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Current operational records</p><h2 id="operational-heading" className="mt-1 text-2xl font-bold text-slate-950">Operational Shipment Analytics</h2><p className="mt-1 text-sm text-slate-600">Separate SQL shipment, route, and alert summaries. Historical research windows are not treated as live readings.</p></div>{operational && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{Object.values(operational.shipmentCountsByStatus).reduce((sum, row) => sum + Number(row.shipment_count), 0).toLocaleString()} shipments</span>}</div>
        {operationalError && <p role="alert" className="m-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{operationalError}</p>}
        {operationalLoading && <p className="px-5 py-8 text-center text-sm text-slate-500" role="status">Loading operational reports…</p>}
        {!operationalLoading && operational && <div className="p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-3"><Metric label="All alerts" value={operational.alertTotals.total_alerts} detail="Operational shipment alerts" /><Metric label="Unresolved" value={operational.alertTotals.unresolved_alerts} detail="Still need review" /><Metric label="Solved" value={operational.alertTotals.resolved_alerts} detail="Resolved alerts reflected in these totals" /></div>
          <div className="mt-7 grid gap-7 xl:grid-cols-2">
            <section><h3 className="font-semibold text-slate-950">Operational alerts by severity</h3><div className="mt-3 space-y-2">{operational.alertCountsBySeverity.map((row) => <div key={row.severity} className="grid grid-cols-[80px_1fr_1fr_1fr] items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><strong>{row.severity}</strong><span>{Number(row.total_alerts).toLocaleString()} total</span><span>{Number(row.unresolved_alerts).toLocaleString()} open</span><span>{Number(row.resolved_alerts).toLocaleString()} solved</span></div>)}{operational.alertCountsBySeverity.length === 0 && <p className="text-sm text-slate-500">No operational alerts.</p>}</div></section>
            <section><h3 className="font-semibold text-slate-950">Shipments by status</h3><div className="mt-3 space-y-2">{operational.shipmentCountsByStatus.map((row) => <div key={row.status} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-sm"><span>{row.status.replaceAll("_", " ")}</span><strong>{Number(row.shipment_count).toLocaleString()}</strong></div>)}{operational.shipmentCountsByStatus.length === 0 && <p className="text-sm text-slate-500">No operational shipments are available.</p>}</div></section>
          </div>
          <div className="mt-7 grid gap-7 xl:grid-cols-2">
            <section><h3 className="font-semibold text-slate-950">Monthly shipment activity</h3><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[440px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Month</th><th className="py-2">Shipments</th><th className="py-2">Active</th><th className="py-2">Delivered</th></tr></thead><tbody className="divide-y divide-slate-100">{operational.monthlyShipments.map((row) => <tr key={row.month}><td className="py-2">{row.month}</td><td className="py-2">{Number(row.shipment_count).toLocaleString()}</td><td className="py-2">{Number(row.active_shipments).toLocaleString()}</td><td className="py-2">{Number(row.delivered_shipments).toLocaleString()}</td></tr>)}</tbody></table>{operational.monthlyShipments.length === 0 && <p className="py-4 text-sm text-slate-500">No monthly shipment figures yet.</p>}</div></section>
            <section><h3 className="font-semibold text-slate-950">Route performance</h3><div className="mt-3 space-y-2">{operational.shipmentsByRoute.map((route) => <div key={String(route.route_id)} className="rounded-lg bg-slate-50 px-3 py-3 text-sm"><div className="flex justify-between gap-3"><strong>{String(route.route_name ?? "Route")}</strong><span>{Number(route.shipment_count ?? 0).toLocaleString()} shipments</span></div><p className="mt-1 text-xs text-slate-600">{Number(route.unresolved_alerts ?? 0).toLocaleString()} unresolved alerts · Avg delay {route.average_delay_hours === null ? "—" : `${Number(route.average_delay_hours).toFixed(1)} hours`}</p></div>)}{operational.shipmentsByRoute.length === 0 && <p className="text-sm text-slate-500">No operational route figures yet.</p>}</div></section>
          </div>
          <p className="mt-5 text-xs text-slate-500">{operational.dataNote}</p>
        </div>}
      </section>
    </main>
  );
}

export default function ReportsPage() { return <AppShell><ReportsContent /></AppShell>; }

const inputClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100";
function Metric({ label, value, detail }: { label: string; value: number | string | null; detail: string }) { const display = value === null ? "—" : typeof value === "string" ? value : Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3); return <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-950">{display}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>; }
function SmallStat({ label, value }: { label: string; value: number | string }) { return <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm"><span>{label}</span><strong>{Number(value).toLocaleString()}</strong></div>; }
function HorizontalBar({ label, value, max, suffix }: { label: string; value: number; max: number; suffix?: string }) { const width = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 2; return <div className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 text-sm"><span className="truncate text-slate-700">{label}</span><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${width}%` }} /></div><span className="min-w-16 text-right font-medium text-slate-700">{value.toLocaleString()}{suffix ? ` ${suffix}` : ""}</span></div>; }
function StatusBadge({ status }: { status: string }) { const styles: Record<string, string> = { imported: "bg-emerald-100 text-emerald-800", incomplete: "bg-amber-100 text-amber-800", not_imported: "bg-red-100 text-red-800", loading: "bg-slate-100 text-slate-700", unavailable: "bg-red-100 text-red-800" }; return <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${styles[status] ?? styles.unavailable}`}>Dataset {status.replaceAll("_", " ")}</span>; }
function temperature(value: number | null) { return value === null ? "—" : `${value.toFixed(3)} °C`; }
