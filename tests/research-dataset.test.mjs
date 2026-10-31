import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchDocuments, normalizeCell, researchDataset, summarizeResearchRows, upsertResearchDocuments } from "../lib/research-dataset.mjs";

const headers = [
  "Time", "shipment_id", "Front_Top", "Front_Middle", "Front_Bottom",
  "Middle_Top", "Middle_Middle", "Middle_Bottom", "Rear_Top", "Rear_Middle", "Rear_Bottom",
  "T_mean", "risk_level", "y_next_120_R2",
  ...Array.from({ length: researchDataset.columns - 14 }, (_, index) => `feature_${index}`),
];

function sourceRow({ time, shipment = "S1", top = null, probes = {}, mean, risk, future }) {
  const values = Array(headers.length).fill(null);
  const set = (field, value) => { values[headers.indexOf(field)] = value; };
  set("Time", time);
  set("shipment_id", shipment);
  set("Front_Top", top);
  for (const [probe, value] of Object.entries(probes)) set(probe, value);
  set("T_mean", mean);
  set("risk_level", risk);
  set("y_next_120_R2", future);
  return values;
}

test("normalization preserves blanks as null and timestamps as source wall-clock text", () => {
  assert.equal(normalizeCell(""), null);
  assert.equal(normalizeCell(undefined), null);
  assert.equal(normalizeCell(new Date("2019-03-12T12:30:00.000Z")), "2019-03-12 12:30:00");
});

test("research records preserve S IDs and source timestamps with a stable idempotency key", () => {
  const rows = [sourceRow({ time: "2019-03-12 12:30:00", top: 4.1, mean: 4.2, risk: 2, future: 1 })];
  const firstImport = buildResearchDocuments(headers, rows);
  const rerun = buildResearchDocuments(headers, rows);
  assert.equal(firstImport[0].shipment_id, "S1");
  assert.equal(firstImport[0].Time, "2019-03-12 12:30:00");
  assert.equal(firstImport[0]._id, rerun[0]._id);
  assert.equal(firstImport[0].Front_Top, 4.1);
  assert.equal(firstImport[0].Front_Middle, null);
});

test("import batches use replace-upsert keyed by the stable research record ID", async () => {
  const documents = buildResearchDocuments(headers, [sourceRow({ time: "2019-03-12 12:30:00", mean: 4, risk: 1, future: 0 })]);
  const writes = [];
  await upsertResearchDocuments({ bulkWrite: async (operations, options) => writes.push({ operations, options }) }, documents);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].operations[0].replaceOne.filter, { _id: documents[0]._id });
  assert.equal(writes[0].operations[0].replaceOne.upsert, true);
  assert.equal(writes[0].options.ordered, true);
});

test("research summaries count shipments, labels, missing probes, and missing future labels", () => {
  const rows = buildResearchDocuments(headers, [
    sourceRow({ time: "2019-03-12 12:30:00", shipment: "S1", top: 4.1, mean: 4.2, risk: 2, future: 1 }),
    sourceRow({ time: "2019-03-12 12:40:00", shipment: "S2", top: null, mean: 5.2, risk: null, future: null }),
  ]);
  const summary = summarizeResearchRows(rows, { minimumC: 4.2, maximumC: 4.5 });
  assert.equal(summary.rowCount, 2);
  assert.equal(summary.shipmentCounts.S1, 1);
  assert.equal(summary.shipmentCounts.S2, 1);
  assert.equal(summary.meanTMean, 4.7);
  assert.equal(summary.riskLevelCounts["2"], 1);
  assert.equal(summary.missingRiskLevelCount, 1);
  assert.equal(summary.missingProbeCounts.Front_Top, 1);
  assert.equal(summary.temperatureStats.probeMeasurementsCounted, 1);
  assert.equal(summary.temperatureStats.meanC, 4.1);
  assert.equal(summary.temperatureStats.probeStats.Front_Top.meanC, 4.1);
  assert.equal(summary.temperatureExcursions.threshold.minimumC, 4.2);
  assert.equal(summary.temperatureExcursions.threshold.maximumC, 4.5);
  assert.equal(summary.temperatureExcursions.excursionWindowCount, 1);
  assert.equal(summary.temperatureExcursions.excursionProbeCount, 1);
  assert.equal(summary.temperatureExcursions.exposureIndexPercent, 100);
  assert.deepEqual(summary.temperatureExcursions.probeProfile.find((probe) => probe.probe === "Front_Top"), {
    probe: "Front_Top",
    observedCount: 1,
    missingCount: 1,
    excursionCount: 1,
    excursionRatePercent: 100,
    missingRatePercent: 50,
  });
  assert.deepEqual(summary.temperatureTrend, [{ date: "2019-03-12", meanC: 4.1, measurementsCounted: 1 }]);
  assert.deepEqual(summary.next120R2, { positive: 1, negative: 0, missing: 1 });
  assert.deepEqual(summary.timeRange, { start: "2019-03-12 12:30:00", end: "2019-03-12 12:40:00" });
});

test("spatial exposure profile ranks probes from actual readings and excludes missing values from its denominator", () => {
  const rows = buildResearchDocuments(headers, [
    sourceRow({ time: "2019-03-12 12:30:00", probes: { Front_Top: 7, Front_Middle: 4, Rear_Bottom: 2 }, mean: null, risk: null, future: null }),
    sourceRow({ time: "2019-03-12 12:40:00", probes: { Front_Top: 6, Rear_Bottom: 3 }, mean: null, risk: null, future: null }),
  ]);
  const summary = summarizeResearchRows(rows, { minimumC: 3, maximumC: 5 });
  const profile = summary.temperatureExcursions.probeProfile;
  const frontTop = profile.find((probe) => probe.probe === "Front_Top");
  const frontMiddle = profile.find((probe) => probe.probe === "Front_Middle");
  const frontBottom = profile.find((probe) => probe.probe === "Front_Bottom");
  const rearBottom = profile.find((probe) => probe.probe === "Rear_Bottom");

  assert.equal(summary.temperatureExcursions.excursionWindowCount, 2);
  assert.equal(summary.temperatureExcursions.excursionProbeCount, 3);
  assert.equal(summary.temperatureExcursions.exposureIndexPercent, 60);
  assert.deepEqual(frontTop, { probe: "Front_Top", observedCount: 2, missingCount: 0, excursionCount: 2, excursionRatePercent: 100, missingRatePercent: 0 });
  assert.deepEqual(frontMiddle, { probe: "Front_Middle", observedCount: 1, missingCount: 1, excursionCount: 0, excursionRatePercent: 0, missingRatePercent: 50 });
  assert.deepEqual(frontBottom, { probe: "Front_Bottom", observedCount: 0, missingCount: 2, excursionCount: 0, excursionRatePercent: null, missingRatePercent: 100 });
  assert.deepEqual(rearBottom, { probe: "Rear_Bottom", observedCount: 2, missingCount: 0, excursionCount: 1, excursionRatePercent: 50, missingRatePercent: 0 });
});
