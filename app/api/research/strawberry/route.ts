import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { researchDataset, summarizeResearchRows, type ResearchRow } from "@/lib/research-dataset.mjs";

export async function GET() {
  try {
    const databaseName = process.env.MONGODB_DATABASE;
    if (!databaseName) throw new Error("Missing MongoDB database configuration.");
    const client = await clientPromise;
    const db = client.db(databaseName);
    const collection = db.collection<ResearchRow>("research_strawberry_windows");
    const rows = await collection.find(
      { dataset_revision: researchDataset.revision },
      { projection: { _id: 0 } },
    ).sort({ shipment_id: 1, Time: 1 }).toArray();
    const manifest = await db.collection<{ _id: string; imported_at?: Date }>("research_dataset_imports").findOne({ _id: researchDataset.id });

    return NextResponse.json({
      success: true,
      dataset: {
        id: researchDataset.id,
        revision: researchDataset.revision,
        file: researchDataset.file,
        sha256: researchDataset.sha256,
        expectedRows: researchDataset.rows,
        importedAt: manifest?.imported_at ?? null,
        status: rows.length === researchDataset.rows ? "imported" : rows.length === 0 ? "not_imported" : "incomplete",
        source: "Published historical research data; these are not live sensor measurements.",
      },
      analysis: summarizeResearchRows(rows),
    });
  } catch (error) {
    console.error("Failed to build strawberry research analysis:", error);
    return NextResponse.json({ success: false, message: "Unable to load research dataset analysis" }, { status: 500 });
  }
}
