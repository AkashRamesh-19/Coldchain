import nextEnv from "@next/env";
import mysql from "mysql2/promise";
import { MongoClient } from "mongodb";

// Creates plainly labeled classroom scenarios. It never deletes records and
// reruns reuse the fixed shipment codes and deterministic reading IDs.
nextEnv.loadEnvConfig(process.cwd());
for (const key of ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE", "MONGODB_URI", "MONGODB_DATABASE"]) {
  if (!process.env[key]) throw new Error("Database configuration is incomplete; values are not displayed.");
}

const scenarios = [
  { code: "SAMPLE-CCG-001", productName: "Fresh Milk", routeId: 1, temperature: 4.2, humidity: 65, alert: false },
  { code: "SAMPLE-CCG-002", productName: "Organic Strawberries", routeId: 2, temperature: 7.5, humidity: 80, alert: true },
  { code: "SAMPLE-CCG-003", productName: "Insulin Vials", routeId: 3, temperature: 5.1, humidity: 48, alert: false },
];
const pool = mysql.createPool({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, connectionLimit: 2 });
const mongo = new MongoClient(process.env.MONGODB_URI);
const date = (value) => value.toISOString().slice(0, 19).replace("T", " ");
const created = [];
try {
  await mongo.connect();
  const readings = [];
  for (const [index, scenario] of scenarios.entries()) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.execute("SELECT shipment_id FROM shipments WHERE shipment_code = ?", [scenario.code]);
      let shipmentId = existingRows[0]?.shipment_id;
      if (!shipmentId) {
        const [productRows] = await connection.execute("SELECT product_id, supplier_id FROM products WHERE product_name = ? LIMIT 1", [scenario.productName]);
        const product = productRows[0];
        const [routeRows] = await connection.execute("SELECT route_id, source_warehouse_id, destination_warehouse_id FROM routes WHERE route_id = ?", [scenario.routeId]);
        const route = routeRows[0];
        const [vehicles] = await connection.execute("SELECT vehicle_id FROM vehicles WHERE status = 'AVAILABLE' ORDER BY vehicle_id LIMIT 1 FOR UPDATE");
        const [drivers] = await connection.execute("SELECT driver_id FROM drivers WHERE status = 'AVAILABLE' ORDER BY driver_id LIMIT 1 FOR UPDATE");
        const [adminRows] = await connection.execute("SELECT user_id FROM users WHERE role = 'ADMIN' AND is_active = 1 ORDER BY user_id LIMIT 1");
        if (!product || !route || !vehicles[0] || !drivers[0] || !adminRows[0]) throw new Error("Required catalog records, available resources, or administrator are missing; no scenario was created.");
        const now = new Date();
        const [insert] = await connection.execute(
          `INSERT INTO shipments (shipment_code,supplier_id,source_warehouse_id,destination_warehouse_id,vehicle_id,driver_id,route_id,shipment_date,expected_delivery,status)
           VALUES (?,?,?,?,?,?,?,?,?,'CREATED')`,
          [scenario.code, product.supplier_id, route.source_warehouse_id, route.destination_warehouse_id, vehicles[0].vehicle_id, drivers[0].driver_id, route.route_id, date(now), date(new Date(now.getTime() + 4 * 60 * 60 * 1000))],
        );
        shipmentId = insert.insertId;
        await connection.execute("INSERT INTO shipment_items (shipment_id,product_id,quantity,unit_weight_kg) VALUES (?,?,?,?)", [shipmentId, product.product_id, 100 + index * 25, 1]);
        await connection.execute("INSERT INTO shipment_status_history (shipment_id,old_status,new_status,changed_by,remarks) VALUES (?,NULL,'CREATED',?,'Generated SAMPLE scenario; not live freight')", [shipmentId, adminRows[0].user_id]);
        await connection.execute("UPDATE vehicles SET status='IN_TRANSIT' WHERE vehicle_id=?", [vehicles[0].vehicle_id]);
        await connection.execute("UPDATE drivers SET status='ON_DUTY' WHERE driver_id=?", [drivers[0].driver_id]);
        await connection.commit();
      } else {
        await connection.commit();
      }
      const instant = new Date();
      readings.push({ _id: `sample:${scenario.code}:1`, shipment_id: shipmentId, sensor_id: "sample-probe-1", timestamp: new Date(instant.getTime() - 60_000), temperature: scenario.temperature, humidity: scenario.humidity, source: "generated_sample" });
      readings.push({ _id: `sample:${scenario.code}:2`, shipment_id: shipmentId, sensor_id: "sample-probe-1", timestamp: instant, temperature: scenario.temperature, humidity: scenario.humidity, source: "generated_sample" });
      if (scenario.alert) {
        await pool.execute(
          `INSERT INTO alerts (shipment_id,alert_type,severity,message,sensor_value,threshold_value)
           SELECT ?, 'TEMPERATURE','HIGH',?, ?, p.max_temperature
           FROM shipment_items si JOIN products p ON p.product_id=si.product_id
           WHERE si.shipment_id=? AND p.product_name=?
           AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.shipment_id=? AND a.alert_type='TEMPERATURE' AND a.message LIKE 'SAMPLE only:%')`,
          [shipmentId, `SAMPLE only: generated temperature ${scenario.temperature} C exceeds product limit`, scenario.temperature, shipmentId, scenario.productName, shipmentId],
        );
      }
      created.push({ code: scenario.code, shipmentId });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }
  const result = await mongo.db(process.env.MONGODB_DATABASE).collection("sensor_readings").bulkWrite(
    readings.map((reading) => ({ replaceOne: { filter: { _id: reading._id }, replacement: reading, upsert: true } })),
    { ordered: true },
  );
  console.log(JSON.stringify({ success: true, label: "SAMPLE / GENERATED — not real freight", shipments: created, sensorDocumentsUpserted: result.upsertedCount, sensorDocumentsUpdated: result.modifiedCount }));
} catch (error) {
  console.error(`Sample setup failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally { await pool.end(); await mongo.close(); }
