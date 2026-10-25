import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import clientPromise from "@/lib/mongodb";

type ProductRange = {
  shipment_id: number;
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

export async function GET() {
  try {
    const [statusRows, alertRows, overviewRows, productRows] = await Promise.all([
      pool.query(`
        SELECT status, COUNT(*) AS shipment_count
        FROM shipments
        GROUP BY status
        ORDER BY status
      `),
      pool.query(`
        SELECT severity, COUNT(*) AS unresolved_count
        FROM alerts
        WHERE is_resolved = 0
        GROUP BY severity
        ORDER BY FIELD(severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW')
      `),
      pool.query(`
        SELECT shipment_id, shipment_code, supplier_name, source_warehouse,
               destination_warehouse, vehicle_number, driver_name, route_name,
               distance_km, shipment_date, expected_delivery, actual_delivery, status
        FROM shipment_overview
        ORDER BY shipment_id
      `),
      pool.query(`
        SELECT DISTINCT si.shipment_id, p.product_id, p.product_name,
               p.min_temperature, p.max_temperature
        FROM shipment_items AS si
        INNER JOIN products AS p ON p.product_id = si.product_id
        ORDER BY si.shipment_id, p.product_id
      `),
    ]);

    const client = await clientPromise;
    const databaseName = process.env.MONGODB_DATABASE;
    if (!databaseName) throw new Error("Missing MongoDB database configuration.");

    const readings = await client
      .db(databaseName)
      .collection<SensorReading>("sensor_readings")
      .find({}, { projection: { _id: 0, shipment_id: 1, timestamp: 1, temperature: 1 } })
      .sort({ shipment_id: 1, timestamp: 1 })
      .toArray();

    const products = productRows[0] as ProductRange[];
    const productRanges = new Map<number, ProductRange[]>();
    for (const product of products) {
      const ranges = productRanges.get(product.shipment_id) ?? [];
      ranges.push(product);
      productRanges.set(product.shipment_id, ranges);
    }

    const groupedReadings = new Map<number, SensorReading[]>();
    for (const reading of readings) {
      if (!Number.isFinite(Number(reading.temperature))) continue;
      const group = groupedReadings.get(reading.shipment_id) ?? [];
      group.push(reading);
      groupedReadings.set(reading.shipment_id, group);
    }

    const temperatureByShipment = [...groupedReadings.entries()].map(([shipmentId, values]) => {
      const sum = values.reduce((total, reading) => total + Number(reading.temperature), 0);
      const outOfRangeComparisons = values.reduce((count, reading) => {
        return count + (productRanges.get(shipmentId) ?? []).filter((product) => {
          const temperature = Number(reading.temperature);
          return temperature < Number(product.min_temperature) ||
            temperature > Number(product.max_temperature);
        }).length;
      }, 0);

      // A shipment sensor is not mapped to an individual shipment item. Count each
      // timestamp once if it violates one or more of the shipment's product ranges.
      const excursionReadings = values.filter((reading) =>
        (productRanges.get(shipmentId) ?? []).some((product) => {
          const temperature = Number(reading.temperature);
          return temperature < Number(product.min_temperature) ||
            temperature > Number(product.max_temperature);
        }),
      ).length;

      return {
        shipmentId,
        averageTemperatureC: Number((sum / values.length).toFixed(2)),
        readingsCounted: values.length,
        excursionReadingCount: excursionReadings,
        outOfRangeProductComparisons: outOfRangeComparisons,
        productRangesCompared: (productRanges.get(shipmentId) ?? []).map((product) => ({
          productId: product.product_id,
          productName: product.product_name,
          minimumC: Number(product.min_temperature),
          maximumC: Number(product.max_temperature),
        })),
      };
    });

    return NextResponse.json({
      success: true,
      dataNote: "Existing demo readings are reported as simulated; no hardware provenance is recorded.",
      temperatureByShipment,
      unresolvedAlertsBySeverity: alertRows[0],
      shipmentCountsByStatus: statusRows[0],
      shipmentOverview: overviewRows[0],
    });
  } catch (error) {
    console.error("Failed to build reports:", error);
    return NextResponse.json(
      { success: false, message: "Unable to build reports" },
      { status: 500 },
    );
  }
}
