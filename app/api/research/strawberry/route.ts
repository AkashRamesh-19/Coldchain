import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { researchDataset, summarizeResearchRows, type ResearchRow } from "@/lib/research-dataset.mjs";

function parseDateTime(value: string | null, edge: "start" | "end"): string | null {
  if (value === null) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) throw new Error("Dates must use YYYY-MM-DD or local YYYY-MM-DD HH:mm[:ss] format without a timezone.");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText ?? (edge === "end" ? 23 : 0));
  const minute = Number(minuteText ?? (edge === "end" ? 59 : 0));
  const second = Number(secondText ?? (hourText && edge === "end" ? 59 : 0));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) {
    throw new Error("Date or time is outside the valid calendar range.");
  }
  return `${yearText}-${monthText}-${dayText} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const shipmentId = params.get("shipmentId");
  const startValue = params.get("start");
  const endValue = params.get("end");
  const thresholdMinimum = params.get("minTemperatureC");
  const thresholdMaximum = params.get("maxTemperatureC");

  if (shipmentId !== null && !researchDataset.shipments.includes(shipmentId)) {
    return NextResponse.json({ success: false, message: "Unsupported research shipment ID", allowedShipmentIds: researchDataset.shipments }, { status: 400 });
  }
  if ((thresholdMinimum === null) !== (thresholdMaximum === null)) {
    return NextResponse.json({ success: false, message: "Provide both minTemperatureC and maxTemperatureC to calculate threshold excursions." }, { status: 400 });
  }

  let start: string | null;
  let end: string | null;
  let temperatureThreshold: { minimumC: number; maximumC: number } | null = null;
  try {
    start = parseDateTime(startValue, "start");
    end = parseDateTime(endValue, "end");
    if (start && end && start > end) throw new Error("Start time must be earlier than or equal to end time.");
    if (thresholdMinimum !== null && thresholdMaximum !== null) {
      const minimumC = Number(thresholdMinimum);
      const maximumC = Number(thresholdMaximum);
      if (!Number.isFinite(minimumC) || !Number.isFinite(maximumC) || minimumC >= maximumC) {
        throw new Error("Temperature thresholds must be finite numbers and minimum must be below maximum.");
      }
      temperatureThreshold = { minimumC, maximumC };
    }
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Invalid research filters" }, { status: 400 });
  }

  try {
    const databaseName = process.env.MONGODB_DATABASE;
    if (!databaseName) throw new Error("Missing MongoDB database configuration.");
    const client = await clientPromise;
    const db = client.db(databaseName);
    const collection = db.collection<ResearchRow>("research_strawberry_windows");
    const datasetFilter = { dataset_revision: researchDataset.revision };
    const totalRows = await collection.countDocuments(datasetFilter);
    const filter: Record<string, unknown> = { ...datasetFilter };
    if (shipmentId !== null) filter.shipment_id = shipmentId;
    if (start || end) {
      filter.Time = {
        ...(start ? { $gte: start } : {}),
        ...(end ? { $lte: end } : {}),
      };
    }
    const rows = await collection.find(
      filter,
      { projection: { _id: 0 } },
    ).sort({ shipment_id: 1, Time: 1 }).toArray();
    const manifest = await db.collection<{ _id: string; imported_at?: Date }>("research_dataset_imports").findOne({ _id: researchDataset.id });

    return NextResponse.json({
      success: true,
      filters: {
        shipmentId,
        start: startValue ? start : null,
        end: endValue ? end : null,
        timestampsAreTimezoneFreeWallClock: true,
      },
      dataset: {
        id: researchDataset.id,
        revision: researchDataset.revision,
        file: researchDataset.file,
        sha256: researchDataset.sha256,
        expectedRows: researchDataset.rows,
        importedAt: manifest?.imported_at ?? null,
        status: totalRows === researchDataset.rows ? "imported" : totalRows === 0 ? "not_imported" : "incomplete",
        source: "Published historical research data; these are not live sensor measurements.",
      },
      analysis: summarizeResearchRows(rows, temperatureThreshold),
    });
  } catch (error) {
    console.error("Failed to build strawberry research analysis:", error);
    return NextResponse.json({ success: false, message: "Unable to load research dataset analysis" }, { status: 500 });
  }
}
