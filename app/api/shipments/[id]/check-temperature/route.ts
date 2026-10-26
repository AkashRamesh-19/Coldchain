
import { NextResponse } from "next/server";
import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/mysql";
import clientPromise from "@/lib/mongodb";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ProductRow = {
  product_id: number;
  product_name: string;
  min_temperature: number | string;
  max_temperature: number | string;
};

type SensorReading = {
  shipment_id: number;
  timestamp: Date | string;
  temperature: number;
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
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Serialize checks for this shipment so two concurrent requests cannot both
    // create the same still-unresolved product/direction alert.
    const [shipmentRows] = await connection.execute(
      `SELECT s.shipment_id FROM shipments AS s
       WHERE s.shipment_id = ? AND NOT EXISTS (
         SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
       ) FOR UPDATE`,
      [shipmentId],
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
      `SELECT DISTINCT p.product_id, p.product_name, p.min_temperature, p.max_temperature
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
      temperature: number;
      minimum: number;
      maximum: number;
      direction: "below" | "above";
    }> = [];
    let readingsWithExcursions = 0;
    let productComparisonsOutOfRange = 0;

    for (const reading of readings) {
      const temperature = Number(reading.temperature);

      if (!Number.isFinite(temperature)) {
        continue;
      }

      let readingHasExcursion = false;
      for (const product of products) {
        const minimum = Number(product.min_temperature);
        const maximum = Number(product.max_temperature);

        if (temperature >= minimum && temperature <= maximum) {
          continue;
        }

        readingHasExcursion = true;
        productComparisonsOutOfRange += 1;
        const direction = temperature < minimum ? "below" : "above";
        const message =
          `Product ${product.product_id} (${product.product_name}): shipment temperature is ${direction} its permitted range ${minimum}°C to ${maximum}°C`;

        const [existingRows] = await connection.execute(
          `SELECT alert_id
           FROM alerts
           WHERE shipment_id = ?
             AND alert_type = 'TEMPERATURE'
             AND message = ?
             AND is_resolved = 0
           LIMIT 1`,
          [shipmentId, message]
        );

        if ((existingRows as Array<{ alert_id: number }>).length > 0) {
          continue;
        }

        const severity =
          temperature < minimum - 2 || temperature > maximum + 2
            ? "HIGH"
            : "MEDIUM";

        await connection.execute(
          `INSERT INTO alerts
           (shipment_id, alert_type, severity, message,
            sensor_value, threshold_value)
           VALUES (?, 'TEMPERATURE', ?, ?, ?, ?)`,
          [
            shipmentId,
            severity,
            message,
            temperature,
            temperature < minimum ? minimum : maximum,
          ]
        );

        createdAlerts.push({
          product: product.product_name,
          temperature,
          minimum,
          maximum,
          direction,
        });
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
