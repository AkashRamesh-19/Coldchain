import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import ExcelJS from "exceljs";
import { MongoClient } from "mongodb";
import { buildResearchDocuments, normalizeCell, researchDataset, upsertResearchDocuments } from "../lib/research-dataset.mjs";

nextEnv.loadEnvConfig(process.cwd());

const url = `https://huggingface.co/datasets/NifferLi/Cold-Chain-Transportation-Strawberry/resolve/${researchDataset.revision}/${researchDataset.file}?download=true`;

async function main() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DATABASE) {
    throw new Error("MongoDB configuration is required; values are not displayed.");
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dataset download failed with HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== researchDataset.sha256) throw new Error("Dataset SHA-256 does not match the verified pinned file.");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet("data");
  if (!sheet) throw new Error("Expected worksheet 'data' was not found.");
  const headers = sheet.getRow(1).values.slice(1).map((value) => String(value ?? ""));
  if (headers.length !== researchDataset.columns || sheet.rowCount - 1 !== researchDataset.rows) {
    throw new Error(`Dataset shape mismatch: expected ${researchDataset.rows} rows and ${researchDataset.columns} columns.`);
  }
  const shipmentIndex = headers.indexOf("shipment_id");
  const timeIndex = headers.indexOf("Time");
  if (shipmentIndex < 0 || timeIndex < 0) throw new Error("Dataset is missing shipment_id or Time.");

  const sourceRows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    sourceRows.push(headers.map((_, index) => normalizeCell(row.getCell(index + 1).value)));
  });
  const documents = buildResearchDocuments(headers, sourceRows);
  if (documents.length !== researchDataset.rows) throw new Error("Parsed row count does not match the pinned manifest.");

  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE);
    const collection = db.collection("research_strawberry_windows");
    await collection.createIndex({ dataset_revision: 1, shipment_id: 1, Time: 1 }, { unique: true, name: "uq_research_revision_shipment_time" });
    await upsertResearchDocuments(collection, documents);
    await db.collection("research_dataset_imports").updateOne(
      { _id: researchDataset.id },
      { $set: { revision: researchDataset.revision, file: researchDataset.file, sha256: hash, row_count: documents.length, column_count: headers.length, imported_at: new Date(), source_url: url } },
      { upsert: true },
    );
    console.log(JSON.stringify({ imported: documents.length, collection: "research_strawberry_windows", revision: researchDataset.revision, sha256: hash }));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Research import failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
