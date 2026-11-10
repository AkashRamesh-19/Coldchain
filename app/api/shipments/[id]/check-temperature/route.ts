
import { NextResponse } from "next/server";
import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/mysql";
import clientPromise from "@/lib/mongodb";
import { authorize, shipmentAccessCondition, staffAndAbove } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ProductRow = {
  product_id: number;
  product_name: string;
  min_temperature: number | string;
  max_temperature: number | string;
  min_humidity: number | string | null;
  max_humidity: number | string | null;
};

type SensorReading = {
  shipment_id: number;
  timestamp: Date | string;
  temperature?: number | string | null;
  humidity?: number | string | null;
};

export async function POST(
  _request: Request,
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

  let connection: PoolConnection | undefined;
  try {
    const access = await authorize(_request, staffAndAbove);
    if ("response" in access) return access.response;
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Serialize checks for this shipment so two concurrent requests cannot both
    // create the same still-unresolved product/direction alert.
    const [shipmentRows] = await connection.execute(
      `SELECT s.shipment_id FROM shipments AS s
       WHERE s.shipment_id = ? AND NOT EXISTS (
         SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
       ) ${shipmentAccessCondition("s", access.user).sql} FOR UPDATE`,
      [shipmentId, ...shipmentAccessCondition("s", access.user).params],
    );

    if ((shipmentRows as Array<{ shipment_id: number }>).length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { success: false, message: "Shipment not found" },
        { status: 404 },
      );
    }

    const [productRows] = await connection.execute(
      `SELECT DISTINCT p.product_id, p.product_name, p.min_temperature, p.max_temperature,
              p.min_humidity, p.max_humidity
       FROM shipment_items AS si
       INNER JOIN products AS p ON p.product_id = si.product_id
       WHERE si.shipment_id = ?`,
      [shipmentId]
    );

    const products = productRows as ProductRow[];

    if (products.length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        {
          success: false,
          message: "Shipment not found or has no products",
        },
        { status: 404 }
      );
    }

    const client = await clientPromise;
    const databaseName = process.env.MONGODB_DATABASE;

    if (!databaseName) {
      throw new Error("Missing MONGODB_DATABASE configuration.");
    }

    const db = client.db(databaseName);

    const readings = db
      .collection<SensorReading>("sensor_readings")
      .find({ shipment_id: shipmentId })
      .project({ _id: 0, shipment_id: 1, timestamp: 1, temperature: 1, humidity: 1 })
      .sort({ timestamp: 1 });

    type AlertCandidate = {
      product: string;
      condition: "TEMPERATURE" | "HUMIDITY";
      value: number;
      minimum: number;
      maximum: number;
      direction: "below" | "above";
      message: string;
      severity: "MEDIUM" | "HIGH";
      distance: number;
    };
    const candidates = new Map<string, AlertCandidate>();
    const recentReadings: Array<{ timestamp: Date | string; temperature: number | string | null; humidity: number | string | null }> = [];
    let readingsChecked = 0;
    let readingsWithExcursions = 0;
    let productComparisonsOutOfRange = 0;

    // Stream historical readings so the request does not hold the entire
    // telemetry history in Node memory. Keep only a small UI preview.
    for await (const reading of readings) {
      readingsChecked += 1;
      recentReadings.push({ timestamp: reading.timestamp, temperature: reading.temperature ?? null, humidity: reading.humidity ?? null });
      if (recentReadings.length > 12) recentReadings.shift();
      let readingHasExcursion = false;
      for (const product of products) {
        const checks: Array<{ condition: "TEMPERATURE" | "HUMIDITY"; value: unknown; minimum: number | null; maximum: number | null; unit: string }> = [
          { condition: "TEMPERATURE", value: reading.temperature, minimum: Number(product.min_temperature), maximum: Number(product.max_temperature), unit: "°C" },
          { condition: "HUMIDITY", value: reading.humidity, minimum: product.min_humidity === null ? null : Number(product.min_humidity), maximum: product.max_humidity === null ? null : Number(product.max_humidity), unit: "%" },
        ];
        for (const check of checks) {
          const value = check.value === null || check.value === undefined ? Number.NaN : typeof check.value === "number" ? check.value : Number(check.value);
          if (check.minimum === null || check.maximum === null || !Number.isFinite(value) || value >= check.minimum && value <= check.maximum) continue;
          readingHasExcursion = true;
          productComparisonsOutOfRange += 1;
          const direction = value < check.minimum ? "below" : "above";
          const message = `Product ${product.product_id} (${product.product_name}): shipment ${check.condition.toLowerCase()} is ${direction} its permitted range ${check.minimum}${check.unit} to ${check.maximum}${check.unit}`;
          const distance = direction === "below" ? check.minimum - value : value - check.maximum;
          const margin = check.condition === "TEMPERATURE" ? 2 : 10;
          const severity = distance > margin ? "HIGH" : "MEDIUM";
          const existing = candidates.get(message);
          if (!existing || distance > existing.distance) {
            candidates.set(message, {
              product: product.product_name,
              condition: check.condition,
              value,
              minimum: check.minimum,
              maximum: check.maximum,
              direction,
              message,
              severity,
              distance,
            });
          }
        }
      }
      if (readingHasExcursion) readingsWithExcursions += 1;
    }

    const messageList = [...candidates.keys()];
    let existingMessages = new Set<string>();
    if (messageList.length) {
      const placeholders = messageList.map(() => "?").join(",");
      const [existingRows] = await connection.execute(
        `SELECT message FROM alerts WHERE shipment_id = ? AND is_resolved = 0 AND message IN (${placeholders})`,
        [shipmentId, ...messageList],
      );
      existingMessages = new Set((existingRows as Array<{ message: string }>).map((row) => row.message));
    }
    const newAlerts = [...candidates.values()].filter((candidate) => !existingMessages.has(candidate.message));
    if (newAlerts.length) {
      const values = newAlerts.map((alert) => [
        shipmentId,
        alert.condition,
        alert.severity,
        alert.message,
        alert.value,
        alert.direction === "below" ? alert.minimum : alert.maximum,
      ]);
      await connection.query(
        "INSERT INTO alerts (shipment_id, alert_type, severity, message, sensor_value, threshold_value) VALUES ?",
        [values],
      );
    }

    await connection.commit();
    connection.release();

    return NextResponse.json({
      success: true,
      shipmentId,
      readingsChecked,
      excursionReadingCount: readingsWithExcursions,
      outOfRangeProductComparisons: productComparisonsOutOfRange,
      alertsCreated: newAlerts.length,
      alerts: newAlerts.map(({ product, condition, value, minimum, maximum, direction }) => ({ product, condition, value, minimum, maximum, direction })),
      sensorReadings: recentReadings,
      sensorReadingsPreviewed: recentReadings.length,
      sensorReadingsTruncated: readingsChecked > recentReadings.length,
      limitation: "The shipment sensor is compared with each distinct product range because readings are not linked to individual shipment items.",
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } finally {
        connection.release();
      }
    }
    console.error("Temperature check failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to check shipment temperatures",
      },
      { status: 500 }
    );
  }
}
