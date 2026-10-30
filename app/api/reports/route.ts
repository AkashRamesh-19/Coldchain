import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import clientPromise from "@/lib/mongodb";
import { authorize, shipmentAccessCondition, staffAndAbove } from "@/lib/auth";

type ProductRange = {
  shipment_id: number;
  product_id: number;
  product_name: string;
  min_temperature: number | string;
  max_temperature: number | string;
};
type SensorReading = { shipment_id: number; timestamp: Date | string; temperature?: number | string | null; humidity?: number | string | null };

export async function GET(request: Request) {
  try {
    const access = await authorize(request, staffAndAbove);
    if ("response" in access) return access.response;
    const scope = shipmentAccessCondition("s", access.user);
    const routeAlertScope = shipmentAccessCondition("a_shipment", access.user);
    const [statusRows, alertRows, overviewRows, productRows, operationalRows, routeRows, monthlyRows, alertTotals] = await Promise.all([
      pool.query(`
        SELECT s.status, COUNT(*) AS shipment_count
        FROM shipments AS s
        WHERE NOT EXISTS (SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id)
        ${scope.sql} GROUP BY s.status ORDER BY s.status
      `, scope.params),
      pool.query(`
        SELECT a.severity, COUNT(*) AS unresolved_count
        FROM alerts AS a INNER JOIN shipments AS s ON s.shipment_id = a.shipment_id
        WHERE a.is_resolved = 0 AND NOT EXISTS (SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id)
        ${scope.sql} GROUP BY a.severity
        ORDER BY FIELD(a.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW')
      `, scope.params),
      pool.query(`
        SELECT o.shipment_id, s.route_id, o.shipment_code, o.supplier_name, o.source_warehouse,
               o.destination_warehouse, o.vehicle_number, o.driver_name, o.route_name,
               o.distance_km, o.shipment_date, o.expected_delivery, o.actual_delivery, o.status
        FROM shipment_overview AS o
        INNER JOIN shipments AS s ON s.shipment_id = o.shipment_id
        WHERE NOT EXISTS (SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = o.shipment_id)
        ${scope.sql} ORDER BY o.shipment_id
      `, scope.params),
      pool.query(`
        SELECT DISTINCT si.shipment_id, p.product_id, p.product_name,
               p.min_temperature, p.max_temperature
        FROM shipment_items AS si INNER JOIN products AS p ON p.product_id = si.product_id
        INNER JOIN shipments AS s ON s.shipment_id = si.shipment_id
        WHERE NOT EXISTS (SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = si.shipment_id)
        ${scope.sql} ORDER BY si.shipment_id, p.product_id
      `, scope.params),
      pool.query(`
        SELECT s.shipment_id FROM shipments AS s
        WHERE NOT EXISTS (SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id)
        ${scope.sql}
      `, scope.params),
      pool.query(`
        SELECT r.route_id, r.route_name, COUNT(s.shipment_id) AS shipment_count,
               SUM(s.status IN ('CREATED','IN_TRANSIT','DELAYED')) AS active_shipments,
               SUM(s.status = 'DELIVERED') AS delivered_shipments,
               COALESCE(alert_totals.total_alerts, 0) AS total_alerts,
               COALESCE(alert_totals.unresolved_alerts, 0) AS unresolved_alerts,
               AVG(CASE WHEN s.actual_delivery > s.expected_delivery
                   THEN TIMESTAMPDIFF(SECOND, s.expected_delivery, s.actual_delivery) / 3600 END) AS average_delay_hours
        FROM routes AS r INNER JOIN shipments AS s ON s.route_id = r.route_id
        LEFT JOIN (
          SELECT a_route.route_id, COUNT(a.alert_id) AS total_alerts,
                 SUM(a.is_resolved = 0) AS unresolved_alerts
          FROM alerts AS a INNER JOIN shipments AS a_shipment ON a_shipment.shipment_id = a.shipment_id
          INNER JOIN routes AS a_route ON a_route.route_id = a_shipment.route_id
          WHERE NOT EXISTS (SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = a_shipment.shipment_id)
          ${routeAlertScope.sql}
          GROUP BY a_route.route_id
        ) AS alert_totals ON alert_totals.route_id = r.route_id
        WHERE NOT EXISTS (SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id)
        ${scope.sql} GROUP BY r.route_id, r.route_name, alert_totals.total_alerts, alert_totals.unresolved_alerts ORDER BY r.route_name
      `, [...routeAlertScope.params, ...scope.params]),
      pool.query(`
        SELECT DATE_FORMAT(s.shipment_date, '%Y-%m') AS month, COUNT(*) AS shipment_count,
               SUM(s.status = 'DELIVERED') AS delivered_shipments,
               SUM(s.status IN ('CREATED','IN_TRANSIT','DELAYED')) AS active_shipments
        FROM shipments AS s
        WHERE NOT EXISTS (SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id)
        ${scope.sql} GROUP BY DATE_FORMAT(s.shipment_date, '%Y-%m') ORDER BY month
      `, scope.params),
      pool.query(`
        SELECT COUNT(*) AS total_alerts, SUM(a.is_resolved = 0) AS unresolved_alerts,
               SUM(a.is_resolved = 1) AS resolved_alerts
        FROM alerts AS a INNER JOIN shipments AS s ON s.shipment_id = a.shipment_id
        WHERE NOT EXISTS (SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id)
        ${scope.sql}
      `, scope.params),
    ]);

    const client = await clientPromise;
    const databaseName = process.env.MONGODB_DATABASE;
    if (!databaseName) throw new Error("Missing MongoDB database configuration.");
    const shipmentIds = (operationalRows[0] as Array<{ shipment_id: number }>).map((row) => row.shipment_id);
    const readings = shipmentIds.length ? await client.db(databaseName)
      .collection<SensorReading>("sensor_readings")
      .find({ shipment_id: { $in: shipmentIds } }, { projection: { _id: 0, shipment_id: 1, timestamp: 1, temperature: 1, humidity: 1 } })
      .sort({ shipment_id: 1, timestamp: 1 }).toArray() : [];
    const sensorMetricsByShipment = shipmentIds.length ? await client.db(databaseName)
      .collection("sensor_readings").aggregate([
        { $match: { shipment_id: { $in: shipmentIds } } },
        { $group: {
          _id: "$shipment_id",
          readings: { $sum: 1 },
          temperatureCount: { $sum: { $cond: [{ $ne: [{ $convert: { input: "$temperature", to: "double", onError: null, onNull: null } }, null] }, 1, 0] } },
          temperatureSum: { $sum: { $convert: { input: "$temperature", to: "double", onError: null, onNull: null } } },
          temperatureMeanC: { $avg: { $convert: { input: "$temperature", to: "double", onError: null, onNull: null } } },
          temperatureMinimumC: { $min: { $convert: { input: "$temperature", to: "double", onError: null, onNull: null } } },
          temperatureMaximumC: { $max: { $convert: { input: "$temperature", to: "double", onError: null, onNull: null } } },
          humiditySum: { $sum: { $convert: { input: "$humidity", to: "double", onError: null, onNull: null } } },
          humidityMeanPercent: { $avg: { $convert: { input: "$humidity", to: "double", onError: null, onNull: null } } },
          humidityReadingsCounted: { $sum: { $cond: [{ $ne: [{ $convert: { input: "$humidity", to: "double", onError: null, onNull: null } }, null] }, 1, 0] } },
        } },
        { $sort: { _id: 1 } },
      ]).toArray() : [];

    const products = productRows[0] as ProductRange[];
    const productRanges = new Map<number, ProductRange[]>();
    for (const product of products) {
      const ranges = productRanges.get(product.shipment_id) ?? [];
      ranges.push(product);
      productRanges.set(product.shipment_id, ranges);
    }
    const groupedReadings = new Map<number, SensorReading[]>();
    for (const reading of readings) {
      if (reading.temperature === null || reading.temperature === undefined || !Number.isFinite(Number(reading.temperature))) continue;
      const group = groupedReadings.get(reading.shipment_id) ?? [];
      group.push(reading);
      groupedReadings.set(reading.shipment_id, group);
    }
    const temperatureByShipment = [...groupedReadings.entries()].map(([shipmentId, values]) => {
      const temperatures = values.map((reading) => Number(reading.temperature));
      const sum = temperatures.reduce((total, temperature) => total + temperature, 0);
      const ranges = productRanges.get(shipmentId) ?? [];
      const outOfRangeProductComparisons = temperatures.reduce((count, temperature) => count + ranges.filter((product) => temperature < Number(product.min_temperature) || temperature > Number(product.max_temperature)).length, 0);
      const excursionReadingCount = temperatures.filter((temperature) => ranges.some((product) => temperature < Number(product.min_temperature) || temperature > Number(product.max_temperature))).length;
      return {
        shipmentId,
        averageTemperatureC: Number((sum / temperatures.length).toFixed(2)),
        readingsCounted: temperatures.length,
        excursionReadingCount,
        outOfRangeProductComparisons,
        productRangesCompared: ranges.map((product) => ({ productId: product.product_id, productName: product.product_name, minimumC: Number(product.min_temperature), maximumC: Number(product.max_temperature) })),
      };
    });
    const routeAverages = new Map<number, { temperatureSum: number; temperatureCount: number; humiditySum: number; humidityCount: number }>();
    const routeIdsByShipment = new Map((overviewRows[0] as Array<{ shipment_id: number; route_id: number }>).map((shipment) => [shipment.shipment_id, shipment.route_id]));
    for (const metric of sensorMetricsByShipment as Array<{ _id: number; temperatureSum: number; temperatureCount: number; humiditySum: number; humidityReadingsCounted: number }>) {
      const shipmentId = metric._id;
      const routeId = routeIdsByShipment.get(shipmentId);
      if (!routeId) continue;
      const routeMetrics = routeAverages.get(routeId) ?? { temperatureSum: 0, temperatureCount: 0, humiditySum: 0, humidityCount: 0 };
      routeMetrics.temperatureSum += metric.temperatureSum;
      routeMetrics.temperatureCount += metric.temperatureCount;
      routeMetrics.humiditySum += metric.humiditySum;
      routeMetrics.humidityCount += metric.humidityReadingsCounted;
      routeAverages.set(routeId, routeMetrics);
    }
    const shipmentsByRoute = (routeRows[0] as Array<Record<string, unknown>>).map((route) => {
      const metrics = routeAverages.get(Number(route.route_id)) ?? { temperatureSum: 0, temperatureCount: 0, humiditySum: 0, humidityCount: 0 };
      return {
        ...route,
        averageTemperatureC: metrics.temperatureCount ? Number((metrics.temperatureSum / metrics.temperatureCount).toFixed(2)) : null,
        averageHumidityPercent: metrics.humidityCount ? Number((metrics.humiditySum / metrics.humidityCount).toFixed(2)) : null,
      };
    });

    return NextResponse.json({
      success: true,
      dataNote: "Operational readings are linked only to operational shipments. Route and monthly figures are computed from MySQL; temperature summaries use MongoDB readings. Research dataset analysis is reported separately.",
      temperatureByShipment,
      sensorMetricsByShipment,
      unresolvedAlertsBySeverity: alertRows[0],
      alertTotals: (alertTotals[0] as Array<Record<string, unknown>>)[0],
      shipmentCountsByStatus: statusRows[0],
      shipmentOverview: overviewRows[0],
      shipmentsByRoute,
      monthlyShipments: monthlyRows[0],
    });
  } catch (error) {
    console.error("Failed to build reports:", error);
    return NextResponse.json({ success: false, message: "Unable to build reports" }, { status: 500 });
  }
}
