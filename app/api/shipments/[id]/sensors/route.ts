
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import clientPromise from "@/lib/mongodb";
import { createHash } from "node:crypto";
import { authorize, shipmentAccessCondition, staffAndAbove } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};
type SensorReadingDocument = {
  _id: string;
  shipment_id: number;
  sensor_id: string;
  timestamp: Date;
  temperature?: number;
  humidity?: number;
  latitude?: number;
  longitude?: number;
  battery_level?: number;
};

export async function GET(
  request: Request,
  { params }: RouteContext
) {
  const { id } = await params;
  const shipmentId = Number(id);

  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    return NextResponse.json(
      { success: false, message: "Invalid shipment ID" },
      { status: 400 }
    );
  }

  try {
    const access = await authorize(request, staffAndAbove);
    if ("response" in access) return access.response;
    const scope = shipmentAccessCondition("s", access.user);
    const [shipmentRows] = await pool.execute(
      `SELECT s.shipment_id FROM shipments AS s
       WHERE s.shipment_id = ? AND NOT EXISTS (
         SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
       ) ${scope.sql}`,
      [shipmentId, ...scope.params],
    );
    if ((shipmentRows as Array<{ shipment_id: number }>).length === 0) {
      return NextResponse.json({ success: false, message: "Operational shipment not found" }, { status: 404 });
    }

    const client = await clientPromise;
    const databaseName = process.env.MONGODB_DATABASE;

    if (!databaseName) {
      throw new Error("Missing MONGODB_DATABASE configuration.");
    }

    const db = client.db(databaseName);

    const readings = await db
      .collection("sensor_readings")
      .find({ shipment_id: shipmentId })
      .sort({ timestamp: 1 })
      .toArray();

    return NextResponse.json({
      success: true,
      shipmentId,
      count: readings.length,
      readings,
    });
  } catch (error) {
    console.error("Failed to fetch sensor readings:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to fetch sensor readings",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const shipmentId = Number(id);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) return NextResponse.json({ success: false, message: "Invalid shipment ID" }, { status: 400 });

  let body: { readings?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 }); }
  const readings = Array.isArray(body.readings) ? body.readings : [body];
  if (readings.length < 1 || readings.length > 500) return NextResponse.json({ success: false, message: "Provide between 1 and 500 sensor readings" }, { status: 400 });

  const allowedFields = ["timestamp", "sensor_id", "temperature", "humidity", "latitude", "longitude", "battery_level"] as const;
  const normalized = [];
  for (const candidate of readings) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return NextResponse.json({ success: false, message: "Each reading must be an object" }, { status: 400 });
    const reading = candidate as Record<string, unknown>;
    if (Object.keys(reading).some((key) => !allowedFields.includes(key as (typeof allowedFields)[number]))) return NextResponse.json({ success: false, message: "Reading contains unsupported fields" }, { status: 400 });
    if (typeof reading.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(reading.timestamp) || Number.isNaN(Date.parse(reading.timestamp))) {
      return NextResponse.json({ success: false, message: "timestamp must be an ISO-8601 timestamp with an explicit timezone" }, { status: 400 });
    }
    if (reading.sensor_id !== undefined && (typeof reading.sensor_id !== "string" || reading.sensor_id.length < 1 || reading.sensor_id.length > 100)) return NextResponse.json({ success: false, message: "sensor_id must be a string of 1 to 100 characters" }, { status: 400 });
    const limits: Record<string, [number, number]> = { temperature: [-100, 100], humidity: [0, 100], latitude: [-90, 90], longitude: [-180, 180], battery_level: [0, 100] };
    const measurements: Record<string, number> = {};
    for (const [field, [minimum, maximum]] of Object.entries(limits)) {
      if (reading[field] === undefined || reading[field] === null) continue;
      if (typeof reading[field] !== "number" || !Number.isFinite(reading[field]) || reading[field] < minimum || reading[field] > maximum) {
        return NextResponse.json({ success: false, message: `Invalid ${field}` }, { status: 400 });
      }
      measurements[field] = reading[field];
    }
    if (!Object.keys(measurements).length) return NextResponse.json({ success: false, message: "At least one numeric sensor measurement is required" }, { status: 400 });
    const sensorId = (reading.sensor_id as string | undefined) ?? "default";
    const timestamp = new Date(reading.timestamp);
    const idempotencyKey = createHash("sha256").update(`${shipmentId}|${sensorId}|${timestamp.toISOString()}`).digest("hex");
    normalized.push({ _id: `operational:${idempotencyKey}`, shipment_id: shipmentId, sensor_id: sensorId, timestamp, ...measurements });
  }

  try {
    const access = await authorize(request, staffAndAbove);
    if ("response" in access) return access.response;
    const scope = shipmentAccessCondition("s", access.user);
    const [shipments] = await pool.execute(
      `SELECT s.shipment_id FROM shipments AS s WHERE s.shipment_id = ? AND NOT EXISTS (
        SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
       ) ${scope.sql}`,
      [shipmentId, ...scope.params],
    );
    if ((shipments as Array<{ shipment_id: number }>).length === 0) return NextResponse.json({ success: false, message: "Operational shipment not found" }, { status: 404 });

    const client = await clientPromise;
    const databaseName = process.env.MONGODB_DATABASE;
    if (!databaseName) throw new Error("Missing MongoDB database configuration.");
    const result = await client.db(databaseName).collection<SensorReadingDocument>("sensor_readings").bulkWrite(
      normalized.map((reading) => ({ replaceOne: { filter: { _id: reading._id }, replacement: reading, upsert: true } })),
      { ordered: true },
    );
    return NextResponse.json({ success: true, shipmentId, submitted: normalized.length, inserted: result.upsertedCount, updated: result.modifiedCount, message: "Repeated sensor IDs and timestamps replace the same document" }, { status: 201 });
  } catch (error) {
    console.error("Failed to store sensor readings:", error);
    return NextResponse.json({ success: false, message: "Unable to store sensor readings" }, { status: 500 });
  }
}
