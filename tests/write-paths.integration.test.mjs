import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";
import nextEnv from "@next/env";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { MongoClient } from "mongodb";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const quietLogger = { error() {}, warn() {}, info() {}, log() {} };
nextEnv.loadEnvConfig(projectRoot, false, quietLogger, true);

const suffix = randomBytes(8).toString("hex");
const mysqlTestDatabase = `ccg_it_${suffix}`;
const mongoTestDatabase = `ccg_it_${suffix}`;
const configuredMysqlDatabase = process.env.MYSQL_DATABASE;
const configuredMongoDatabase = process.env.MONGODB_DATABASE;

assert.ok(
  configuredMysqlDatabase && configuredMongoDatabase &&
  process.env.MYSQL_HOST && process.env.MYSQL_USER &&
  process.env.MONGODB_URI,
  "Write-path integration tests require local MySQL and MongoDB configuration.",
);
assert.notEqual(mysqlTestDatabase, configuredMysqlDatabase);
assert.notEqual(mongoTestDatabase, configuredMongoDatabase);

let adminConnection;
let mongoClient;
let serverProcess;
let baseUrl;
let fixture;

function mysqlConnectionOptions(database) {
  const port = Number(process.env.MYSQL_PORT ?? 3306);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, "MYSQL_PORT is invalid.");
  return {
    host: process.env.MYSQL_HOST,
    port,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    ...(database ? { database } : {}),
  };
}

async function executeSchema(connection, source) {
  let delimiter = ";";
  let statement = "";

  for (const line of source.split(/\r?\n/)) {
    const delimiterChange = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterChange) {
      const pendingSql = statement
        .split(/\r?\n/)
        .filter((part) => part.trim() && !part.trim().startsWith("--"));
      assert.equal(pendingSql.length, 0, "Schema has an incomplete statement before DELIMITER.");
      statement = "";
      delimiter = delimiterChange[1];
      continue;
    }

    statement += `${line}\n`;
    const trimmed = statement.trimEnd();
    if (trimmed.endsWith(delimiter)) {
      const sql = trimmed.slice(0, -delimiter.length).trim();
      if (sql) await connection.query(sql);
      statement = "";
    }
  }

  assert.equal(statement.trim(), "", "Schema source ended with an incomplete statement.");
}

async function reservePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function getJson(path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(10_000),
    headers: options?.body ? { "content-type": "application/json" } : undefined,
  });
  return { response, body: await response.json() };
}

async function postPatch(path, method, value) {
  return getJson(path, { method, body: JSON.stringify(value) });
}

async function seedFixtures() {
  const [supplier] = await adminConnection.execute(
    "INSERT INTO suppliers (supplier_name) VALUES (?)",
    ["Integration Test Supplier"],
  );
  const [sourceWarehouse] = await adminConnection.execute(
    "INSERT INTO warehouses (warehouse_name, location, city) VALUES (?, ?, ?)",
    ["Test Origin", "Test Site A", "Test City A"],
  );
  const [destinationWarehouse] = await adminConnection.execute(
    "INSERT INTO warehouses (warehouse_name, location, city) VALUES (?, ?, ?)",
    ["Test Destination", "Test Site B", "Test City B"],
  );
  const [driver] = await adminConnection.execute(
    `INSERT INTO drivers (full_name, phone, license_number, license_expiry)
     VALUES (?, ?, ?, ?)` ,
    ["Integration Test Driver", `9${suffix.slice(0, 12)}`, `license-${suffix}`, "2035-01-01"],
  );
  const [vehicle] = await adminConnection.execute(
    `INSERT INTO vehicles (vehicle_number, vehicle_type, capacity_kg)
     VALUES (?, ?, ?)`,
    [`TEST-${suffix}`, "Refrigerated", 1000],
  );
  const [route] = await adminConnection.execute(
    `INSERT INTO routes
       (route_name, source_warehouse_id, destination_warehouse_id,
        distance_km, estimated_duration_hours)
     VALUES (?, ?, ?, ?, ?)`,
    ["Integration Test Route", sourceWarehouse.insertId, destinationWarehouse.insertId, 10, 1],
  );
  const [product] = await adminConnection.execute(
    `INSERT INTO products
       (supplier_id, product_name, category, min_temperature, max_temperature)
     VALUES (?, ?, ?, ?, ?)`,
    [supplier.insertId, "Integration Test Product", "Test", 2, 8],
  );
  const [shipment] = await adminConnection.execute(
    `INSERT INTO shipments
       (shipment_code, supplier_id, source_warehouse_id, destination_warehouse_id,
        vehicle_id, driver_id, route_id, shipment_date, expected_delivery, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED')`,
    [
      `TEST-${suffix}`,
      supplier.insertId,
      sourceWarehouse.insertId,
      destinationWarehouse.insertId,
      vehicle.insertId,
      driver.insertId,
      route.insertId,
      "2030-01-01 00:00:00",
      "2030-01-02 00:00:00",
    ],
  );
  await adminConnection.execute(
    `INSERT INTO shipment_items (shipment_id, product_id, quantity, unit_weight_kg)
     VALUES (?, ?, ?, ?)`,
    [shipment.insertId, product.insertId, 1, 1],
  );
  const [user] = await adminConnection.execute(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES (?, ?, ?, 'ADMIN')`,
    ["Integration Test User", `test-${suffix}@example.invalid`, "test-only-hash"],
  );
  const [alert] = await adminConnection.execute(
    `INSERT INTO alerts (shipment_id, alert_type, severity, message)
     VALUES (?, 'HUMIDITY', 'LOW', 'Integration test alert')`,
    [shipment.insertId],
  );

  await mongoClient
    .db(mongoTestDatabase)
    .collection("sensor_readings")
    .insertMany([
      { shipment_id: shipment.insertId, timestamp: new Date("2030-01-01T00:00:00Z"), temperature: 9 },
      { shipment_id: shipment.insertId, timestamp: new Date("2030-01-01T00:01:00Z"), temperature: 9 },
    ]);

  return {
    shipmentId: shipment.insertId,
    userId: user.insertId,
    alertId: alert.insertId,
  };
}

before(async () => {
  adminConnection = await mysql.createConnection(mysqlConnectionOptions());
  await adminConnection.query(`CREATE DATABASE \`${mysqlTestDatabase}\``);
  const schema = await readFile(new URL("../database/mysql-schema.sql", import.meta.url), "utf8");
  await executeSchema(adminConnection, schema.replaceAll("coldchain_guardian", mysqlTestDatabase));
  await adminConnection.changeUser({ database: mysqlTestDatabase });

  mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();

  fixture = await seedFixtures();

  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        MYSQL_DATABASE: mysqlTestDatabase,
        MONGODB_DATABASE: mongoTestDatabase,
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );

  let isolatedMySqlConfirmed = false;
  let isolatedMongoConfirmed = false;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && !serverProcess.exitCode && !(isolatedMySqlConfirmed && isolatedMongoConfirmed)) {
    try {
      const mysqlCheck = await getJson("/api/db-test");
      isolatedMySqlConfirmed = mysqlCheck.response.ok &&
        mysqlCheck.body.success === true &&
        mysqlCheck.body.result?.[0]?.database_name === mysqlTestDatabase;
      if (isolatedMySqlConfirmed) {
        const mongoCheck = await getJson("/api/mongo-test");
        isolatedMongoConfirmed = mongoCheck.response.ok &&
          mongoCheck.body.success === true &&
          mongoCheck.body.database === mongoTestDatabase;
      }
    } catch {
      // The production server may still be starting; never log its environment or response.
    }
    if (!(isolatedMySqlConfirmed && isolatedMongoConfirmed)) await delay(500);
  }

  assert.equal(serverProcess.exitCode, null, "Isolated Next.js test server did not start.");
  assert.equal(isolatedMySqlConfirmed, true, "API did not confirm the isolated MySQL test database.");
  assert.equal(isolatedMongoConfirmed, true, "API did not confirm the isolated MongoDB test database.");
});

after(async () => {
  let cleanupFailed = false;
  if (serverProcess && serverProcess.exitCode === null) {
    try {
      serverProcess.kill();
      await Promise.race([
        new Promise((resolve) => serverProcess.once("exit", resolve)),
        delay(5_000),
      ]);
    } catch {
      cleanupFailed = true;
    }
  }
  if (mongoClient) {
    try {
      await mongoClient.db(mongoTestDatabase).dropDatabase();
    } catch {
      cleanupFailed = true;
    } finally {
      try {
        await mongoClient.close();
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (adminConnection) {
    try {
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${mysqlTestDatabase}\``);
    } catch {
      cleanupFailed = true;
    } finally {
      try {
        await adminConnection.end();
      } catch {
        cleanupFailed = true;
      }
    }
  }
  assert.equal(cleanupFailed, false, "Temporary test resources could not be fully cleaned up.");
});

test("write API routes mutate only isolated fixtures and persist the expected results", async (t) => {
  await t.test("temperature check creates one alert for duplicate excursions and deduplicates later checks", async () => {
    const path = `/api/shipments/${fixture.shipmentId}/check-temperature`;
    const first = await postPatch(path, "POST", {});
    assert.equal(first.response.status, 200);
    assert.equal(first.body.success, true);
    assert.equal(first.body.readingsChecked, 2);
    assert.equal(first.body.alertsCreated, 1);

    const [alertsAfterFirstCheck] = await adminConnection.execute(
      `SELECT alert_type, severity, sensor_value, threshold_value, is_resolved
       FROM alerts WHERE shipment_id = ? AND alert_type = 'TEMPERATURE'`,
      [fixture.shipmentId],
    );
    assert.equal(alertsAfterFirstCheck.length, 1);
    assert.equal(alertsAfterFirstCheck[0].severity, "MEDIUM");
    assert.equal(Number(alertsAfterFirstCheck[0].sensor_value), 9);
    assert.equal(Number(alertsAfterFirstCheck[0].threshold_value), 8);
    assert.equal(alertsAfterFirstCheck[0].is_resolved, 0);

    const second = await postPatch(path, "POST", {});
    assert.equal(second.response.status, 200);
    assert.equal(second.body.alertsCreated, 0);
    const [alertsAfterSecondCheck] = await adminConnection.execute(
      `SELECT alert_id FROM alerts
       WHERE shipment_id = ? AND alert_type = 'TEMPERATURE' AND is_resolved = 0`,
      [fixture.shipmentId],
    );
    assert.equal(alertsAfterSecondCheck.length, 1);
  });

  await t.test("alert resolution persists resolver and timestamp and handles repeat requests", async () => {
    const path = `/api/alerts/${fixture.alertId}`;
    const result = await postPatch(path, "PATCH", { resolved_by: fixture.userId });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);

    const [rows] = await adminConnection.execute(
      "SELECT is_resolved, resolved_by, resolved_at FROM alerts WHERE alert_id = ?",
      [fixture.alertId],
    );
    assert.equal(rows[0].is_resolved, 1);
    assert.equal(rows[0].resolved_by, fixture.userId);
    assert.ok(rows[0].resolved_at);

    const repeated = await postPatch(path, "PATCH", { resolved_by: fixture.userId });
    assert.equal(repeated.response.status, 200);
    assert.match(repeated.body.message, /already resolved/i);
  });

  await t.test("shipment status updates are persisted once and the database trigger records history", async () => {
    const path = `/api/shipments/${fixture.shipmentId}`;
    const inTransit = await postPatch(path, "PATCH", { status: "IN_TRANSIT" });
    assert.equal(inTransit.response.status, 200);
    assert.equal(inTransit.body.status, "IN_TRANSIT");

    const repeated = await postPatch(path, "PATCH", { status: "IN_TRANSIT" });
    assert.equal(repeated.response.status, 200);
    assert.match(repeated.body.message, /already has this status/i);

    const delivered = await postPatch(path, "PATCH", { status: "DELIVERED" });
    assert.equal(delivered.response.status, 200);
    assert.equal(delivered.body.status, "DELIVERED");

    const [shipments] = await adminConnection.execute(
      "SELECT status, actual_delivery FROM shipments WHERE shipment_id = ?",
      [fixture.shipmentId],
    );
    assert.equal(shipments[0].status, "DELIVERED");
    assert.ok(shipments[0].actual_delivery);

    const [history] = await adminConnection.execute(
      `SELECT old_status, new_status FROM shipment_status_history
       WHERE shipment_id = ? ORDER BY history_id`,
      [fixture.shipmentId],
    );
    assert.deepEqual(history.map(({ old_status, new_status }) => [old_status, new_status]), [
      ["CREATED", "IN_TRANSIT"],
      ["IN_TRANSIT", "DELIVERED"],
    ]);
  });
});
