export const researchDataset = {
  id: "nifferli-strawberry-cold-chain-article-release",
  revision: "4f9541d8a20616b3c5fedc7d9fd27a8a0b6701dc",
  file: "article_release/ALL_benchmark_W60.xlsx",
  sha256: "d35ec35f55fbe602486b6548c921327de0f1b7b2c8673ecd838dc0e3236d8d36",
  rows: 14398,
  columns: 107,
  shipments: ["S1", "S2", "S3", "S4", "S5", "S6"],
  probes: [
    "Front_Top", "Front_Middle", "Front_Bottom",
    "Middle_Top", "Middle_Middle", "Middle_Bottom",
    "Rear_Top", "Rear_Middle", "Rear_Bottom",
  ],
};

export function normalizeCell(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) {
    const pad = (part) => String(part).padStart(2, "0");
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
  }
  return value;
}

export function buildResearchDocuments(headers, rows) {
  if (headers.length !== researchDataset.columns) {
    throw new Error(`Expected ${researchDataset.columns} dataset columns, received ${headers.length}.`);
  }
  if (!headers.includes("shipment_id") || !headers.includes("Time")) throw new Error("Dataset is missing shipment_id or Time.");

  return rows.map((values) => {
    const document = {};
    headers.forEach((header, index) => { document[header] = normalizeCell(values[index]); });
    const shipmentId = document.shipment_id;
    const time = document.Time;
    if (!researchDataset.shipments.includes(String(shipmentId))) throw new Error(`Unexpected research shipment ID: ${String(shipmentId)}.`);
    if (typeof time !== "string" || !time) throw new Error("Research row has no timestamp.");
    return {
      ...document,
      _id: `${researchDataset.id}:${shipmentId}:${time}`,
      shipment_id: String(shipmentId),
      Time: time,
      dataset_revision: researchDataset.revision,
    };
  });
}

export async function upsertResearchDocuments(collection, documents) {
  for (let offset = 0; offset < documents.length; offset += 500) {
    const batch = documents.slice(offset, offset + 500);
    if (batch.length) {
      await collection.bulkWrite(batch.map((document) => ({
        replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true },
      })), { ordered: true });
    }
  }
}

function numericMean(rows, field) {
  const values = rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined).map(Number).filter(Number.isFinite);
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : null;
}

export function summarizeResearchRows(rows) {
  const shipmentCounts = Object.fromEntries(researchDataset.shipments.map((id) => [id, 0]));
  const riskLevelCounts = {};
  const missingProbeCounts = Object.fromEntries(researchDataset.probes.map((probe) => [probe, 0]));
  let missingRiskLevelCount = 0;
  let positive = 0;
  let negative = 0;
  let missing = 0;
  for (const row of rows) {
    shipmentCounts[row.shipment_id] = (shipmentCounts[row.shipment_id] ?? 0) + 1;
    if (row.risk_level === null || row.risk_level === undefined) missingRiskLevelCount += 1;
    else riskLevelCounts[String(row.risk_level)] = (riskLevelCounts[String(row.risk_level)] ?? 0) + 1;
    for (const probe of researchDataset.probes) {
      if (row[probe] === null || row[probe] === undefined) missingProbeCounts[probe] += 1;
    }
    if (row.y_next_120_R2 === null || row.y_next_120_R2 === undefined) missing += 1;
    else if (Number(row.y_next_120_R2) === 1) positive += 1;
    else if (Number(row.y_next_120_R2) === 0) negative += 1;
  }
  const timestamps = rows.map((row) => String(row.Time)).sort();
  return {
    rowCount: rows.length,
    shipmentCounts,
    meanTMean: numericMean(rows, "T_mean"),
    riskLevelCounts,
    missingRiskLevelCount,
    missingProbeCounts,
    next120R2: { positive, negative, missing },
    timeRange: rows.length ? { start: timestamps[0], end: timestamps[timestamps.length - 1] } : null,
  };
}
