
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
  temperature?: number | null;
  humidity?: number | null;
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

    const readings = (await db
      .collection<SensorReading>("sensor_readings")
      .find({ shipment_id: shipmentId })
      .sort({ timestamp: 1 })
      .toArray()) as SensorReading[];

    if (readings.length === 0) {
      await connection.commit();
      connection.release();
      return NextResponse.json({
        success: true,
        shipmentId,
        readingsChecked: 0,
        alertsCreated: 0,
        message: "No sensor readings found for this shipment",
      });
    }

    const createdAlerts: Array<{
      product: string;
      condition: "TEMPERATURE" | "HUMIDITY";
      value: number;
      minimum: number;
      maximum: number;
      direction: "below" | "above";
    }> = [];
    let readingsWithExcursions = 0;
    let productComparisonsOutOfRange = 0;

    for (const reading of readings) {
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
          const [existingRows] = await connection.execute(
            `SELECT alert_id FROM alerts WHERE shipment_id = ? AND alert_type = ? AND message = ? AND is_resolved = 0 LIMIT 1`,
            [shipmentId, check.condition, message],
          );
          if ((existingRows as Array<{ alert_id: number }>).length > 0) continue;
          const severity = value < check.minimum - (check.condition === "TEMPERATURE" ? 2 : 10) || value > check.maximum + (check.condition === "TEMPERATURE" ? 2 : 10) ? "HIGH" : "MEDIUM";
          await connection.execute(
            `INSERT INTO alerts (shipment_id, alert_type, severity, message, sensor_value, threshold_value)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [shipmentId, check.condition, severity, message, value, value < check.minimum ? check.minimum : check.maximum],
          );
          createdAlerts.push({ product: product.product_name, condition: check.condition, value, minimum: check.minimum, maximum: check.maximum, direction });
        }
      }
      if (readingHasExcursion) readingsWithExcursions += 1;
    }

    await connection.commit();
    connection.release();

    return NextResponse.json({
      success: true,
      shipmentId,
      readingsChecked: readings.length,
      excursionReadingCount: readingsWithExcursions,
      outOfRangeProductComparisons: productComparisonsOutOfRange,
      alertsCreated: createdAlerts.length,
      alerts: createdAlerts,
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
