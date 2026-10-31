import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";
import nextEnv from "@next/env";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { MongoClient } from "mongodb";
import { buildResearchDocuments, researchDataset, upsertResearchDocuments } from "../lib/research-dataset.mjs";

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
let sessionCookie = "";

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
  const headers = new Headers(options?.headers);
  if (options?.body) headers.set("content-type", "application/json");
  if (sessionCookie) headers.set("cookie", sessionCookie);
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(10_000),
    headers,
  });
  return { response, body: await response.json(), setCookie: response.headers.get("set-cookie") };
}

async function getJsonUnauthenticated(path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(10_000),
    headers: options?.body ? { "content-type": "application/json" } : undefined,
  });
  return { response, body: await response.json(), setCookie: response.headers.get("set-cookie") };
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
       (supplier_id, product_name, category, min_temperature, max_temperature, min_humidity, max_humidity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [supplier.insertId, "Integration Test Product", "Test", 2, 8, 40, 60],
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
    ["Integration Test User", `test-${suffix}@example.invalid`, await bcrypt.hash(`Test-password-${suffix}`, 10)],
  );
  const [staffUser] = await adminConnection.execute(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES (?, ?, ?, 'OPERATIONS_STAFF')`,
    ["Integration Operations User", `ops-${suffix}@example.invalid`, await bcrypt.hash(`Ops-password-${suffix}`, 10)],
  );
  await adminConnection.execute(
    "INSERT INTO shipment_assignments (shipment_id, user_id, assigned_by) VALUES (?, ?, ?)",
    [shipment.insertId, staffUser.insertId, user.insertId],
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
      { shipment_id: shipment.insertId, timestamp: new Date("2030-01-01T00:00:00Z"), temperature: 9, humidity: 70 },
      { shipment_id: shipment.insertId, timestamp: new Date("2030-01-01T00:01:00Z"), temperature: 1, humidity: 30 },
      { shipment_id: shipment.insertId, timestamp: new Date("2030-01-01T00:02:00Z"), temperature: null, humidity: null },
    ]);

  const [newDriver] = await adminConnection.execute(
    "INSERT INTO drivers (full_name, phone, license_number, license_expiry) VALUES (?, ?, ?, ?)",
    ["Shipment Creation Driver", `8${suffix.slice(0, 12)}`, `new-license-${suffix}`, "2035-01-01"],
  );
  const [newVehicle] = await adminConnection.execute(
    "INSERT INTO vehicles (vehicle_number, vehicle_type, capacity_kg) VALUES (?, ?, ?)",
    [`NEW-${suffix}`, "Refrigerated", 1500],
  );

  return {
    shipmentId: shipment.insertId,
    userId: user.insertId,
    staffUserId: staffUser.insertId,
    email: `test-${suffix}@example.invalid`,
    password: `Test-password-${suffix}`,
    staffEmail: `ops-${suffix}@example.invalid`,
    staffPassword: `Ops-password-${suffix}`,
    supplierId: supplier.insertId,
    sourceWarehouseId: sourceWarehouse.insertId,
    destinationWarehouseId: destinationWarehouse.insertId,
    routeId: route.insertId,
    productId: product.insertId,
    newDriverId: newDriver.insertId,
    newVehicleId: newVehicle.insertId,
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
  const login = await postPatch("/api/auth/login", "POST", { email: fixture.email, password: fixture.password });
  assert.equal(login.response.status, 200, "Test administrator login failed.");
  assert.equal(login.body.user.role, "ADMIN");
  assert.ok(login.setCookie?.startsWith("ccg_session="));
  sessionCookie = login.setCookie.split(";")[0];
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

test("authentication and role-scoped shipment access are enforced", async () => {
  const unauthenticated = await getJsonUnauthenticated("/api/shipments");
  assert.equal(unauthenticated.response.status, 401);
  const wrongPassword = await getJsonUnauthenticated("/api/auth/login", { method: "POST", body: JSON.stringify({ email: fixture.email, password: "wrong-password" }), headers: { "content-type": "application/json" } });
  assert.equal(wrongPassword.response.status, 401);

  const adminPortalLogin = await getJsonUnauthenticated("/api/auth/admin/login", { method: "POST", body: JSON.stringify({ employeeId: String(fixture.userId), password: fixture.password }), headers: { "content-type": "application/json" } });
  assert.equal(adminPortalLogin.response.status, 200);
  const rejectedEmployeeAtAdminPortal = await getJsonUnauthenticated("/api/auth/admin/login", { method: "POST", body: JSON.stringify({ email: fixture.staffEmail, password: fixture.staffPassword }), headers: { "content-type": "application/json" } });
  assert.equal(rejectedEmployeeAtAdminPortal.response.status, 401);
  const employeePortalLogin = await getJsonUnauthenticated("/api/auth/employee/login", { method: "POST", body: JSON.stringify({ email: fixture.staffEmail, password: fixture.staffPassword }), headers: { "content-type": "application/json" } });
  assert.equal(employeePortalLogin.response.status, 200);

  const newEmployeePassword = `New-Employee-${suffix}`;
  const employeeCreate = await postPatch("/api/users", "POST", {
    full_name: "Admin-Created Employee", email: `created-${suffix}@example.invalid`,
    password: newEmployeePassword, role: "OPERATIONS_STAFF",
  });
  assert.equal(employeeCreate.response.status, 201);
  assert.ok(Number.isInteger(employeeCreate.body.user.user_id));
  assert.equal("password_hash" in employeeCreate.body.user, false);
  const employeeIdLogin = await getJsonUnauthenticated("/api/auth/employee/login", {
    method: "POST", body: JSON.stringify({ employeeId: String(employeeCreate.body.user.user_id), password: newEmployeePassword }),
    headers: { "content-type": "application/json" },
  });
  assert.equal(employeeIdLogin.response.status, 200);
  assert.equal(employeeIdLogin.body.user.role, "OPERATIONS_STAFF");

  const staffLogin = await getJsonUnauthenticated("/api/auth/login", { method: "POST", body: JSON.stringify({ email: fixture.staffEmail, password: fixture.staffPassword }), headers: { "content-type": "application/json" } });
  assert.equal(staffLogin.response.status, 200);
  const adminCookie = sessionCookie;
  sessionCookie = staffLogin.setCookie.split(";")[0];
  const [visibleRows] = await adminConnection.execute("SELECT COUNT(*) AS count FROM shipments WHERE shipment_id = ?", [fixture.shipmentId]);
  const staffShipments = await getJson("/api/shipments");
  assert.equal(staffShipments.response.status, 200);
  assert.equal(staffShipments.body.count, Number(visibleRows[0].count));
  assert.ok(staffShipments.body.shipments.some((row) => row.shipment_id === fixture.shipmentId));
  const session = await getJson("/api/auth/me");
  assert.equal(session.response.status, 200);
  assert.equal(session.body.user.role, "OPERATIONS_STAFF");
  const unauthorizedCreate = await postPatch("/api/shipments", "POST", {
    shipment_code: `FORBIDDEN-${suffix}`, supplier_id: fixture.supplierId,
    source_warehouse_id: fixture.sourceWarehouseId, destination_warehouse_id: fixture.destinationWarehouseId,
    vehicle_id: fixture.newVehicleId, driver_id: fixture.newDriverId, route_id: fixture.routeId,
    shipment_date: "2031-01-01 00:00:00", expected_delivery: "2031-01-02 00:00:00",
    items: [{ product_id: fixture.productId, quantity: 1, unit_weight_kg: 1 }],
  });
  assert.equal(unauthorizedCreate.response.status, 403);
  const unauthorizedResolution = await postPatch(`/api/alerts/${fixture.alertId}`, "PATCH", {});
  assert.equal(unauthorizedResolution.response.status, 403);
  const logout = await postPatch("/api/auth/logout", "POST", {});
  assert.equal(logout.response.status, 200);
  sessionCookie = logout.setCookie.split(";")[0];
  const loggedOut = await getJson("/api/auth/me");
  assert.equal(loggedOut.response.status, 401);
  sessionCookie = adminCookie;
});

test("shipment creation is transactional and creates items, assignment, and initial history", async () => {
  const baseBody = {
    shipment_code: `CREATE-${suffix}`,
    supplier_id: fixture.supplierId,
    source_warehouse_id: fixture.sourceWarehouseId,
    destination_warehouse_id: fixture.destinationWarehouseId,
    vehicle_id: fixture.newVehicleId,
    driver_id: fixture.newDriverId,
    route_id: fixture.routeId,
    shipment_date: "2031-01-01 00:00:00",
    expected_delivery: "2031-01-02 00:00:00",
    items: [{ product_id: 99999999, quantity: 1, unit_weight_kg: 2 }],
    assigned_user_ids: [fixture.staffUserId],
  };
  const beforeCount = await adminConnection.execute("SELECT COUNT(*) AS count FROM shipments");
  const rolledBack = await postPatch("/api/shipments", "POST", baseBody);
  assert.equal(rolledBack.response.status, 400);
  const afterRollback = await adminConnection.execute("SELECT COUNT(*) AS count FROM shipments");
  assert.equal(Number(afterRollback[0][0].count), Number(beforeCount[0][0].count));
  const [vehicleAfterRollback] = await adminConnection.execute("SELECT status FROM vehicles WHERE vehicle_id = ?", [fixture.newVehicleId]);
  assert.equal(vehicleAfterRollback[0].status, "AVAILABLE");

  const created = await postPatch("/api/shipments", "POST", { ...baseBody, items: [{ product_id: fixture.productId, quantity: 2, unit_weight_kg: 2 }] });
  assert.equal(created.response.status, 201);
  const shipmentId = created.body.shipmentId;
  const details = await getJson(`/api/shipments/${shipmentId}`);
  assert.equal(details.response.status, 200);
  assert.equal(details.body.items.length, 1);
  assert.equal(details.body.statusHistory.length, 1);
  assert.equal(details.body.statusHistory[0].new_status, "CREATED");
  const [assignment] = await adminConnection.execute("SELECT user_id FROM shipment_assignments WHERE shipment_id = ?", [shipmentId]);
  assert.equal(assignment[0].user_id, fixture.staffUserId);
  const [reserved] = await adminConnection.execute("SELECT v.status vehicle_status, d.status driver_status FROM vehicles v JOIN shipments s ON s.vehicle_id=v.vehicle_id JOIN drivers d ON d.driver_id=s.driver_id WHERE s.shipment_id = ?", [shipmentId]);
  assert.equal(reserved[0].vehicle_status, "IN_TRANSIT");
  assert.equal(reserved[0].driver_status, "ON_DUTY");
  fixture.createdShipmentId = shipmentId;

  const adminCookie = sessionCookie;
  const staffLogin = await getJsonUnauthenticated("/api/auth/login", { method: "POST", body: JSON.stringify({ email: fixture.staffEmail, password: fixture.staffPassword }), headers: { "content-type": "application/json" } });
  sessionCookie = staffLogin.setCookie.split(";")[0];
  const statusUpdate = await postPatch(`/api/shipments/${shipmentId}`, "PATCH", { status: "IN_TRANSIT" });
  assert.equal(statusUpdate.response.status, 200);
  sessionCookie = adminCookie;
});

test("catalog APIs validate allowlisted fields and protect referenced records from deletion", async () => {
  const created = await postPatch("/api/catalog/warehouses", "POST", {
    warehouse_name: `Temporary ${suffix}`, location: "Test only", city: "Test City",
  });
  assert.equal(created.response.status, 201);
  const recordId = created.body.id;
  const listed = await getJson("/api/catalog/warehouses");
  assert.ok(listed.body.items.some((row) => row.warehouse_id === recordId));
  const updated = await postPatch(`/api/catalog/warehouses/${recordId}`, "PATCH", { city: "Updated City" });
  assert.equal(updated.response.status, 200);
  const [row] = await adminConnection.execute("SELECT city FROM warehouses WHERE warehouse_id = ?", [recordId]);
  assert.equal(row[0].city, "Updated City");
  const protectedDelete = await getJson(`/api/catalog/warehouses/${fixture.sourceWarehouseId}`, { method: "DELETE" });
  assert.equal(protectedDelete.response.status, 409);
  const removed = await getJson(`/api/catalog/warehouses/${recordId}`, { method: "DELETE" });
  assert.equal(removed.response.status, 200);
});

test("write API routes mutate only isolated fixtures and persist the expected results", async (t) => {
  await t.test("temperature check creates one alert for duplicate excursions and deduplicates later checks", async () => {
    const path = `/api/shipments/${fixture.shipmentId}/check-temperature`;
    const first = await postPatch(path, "POST", {});
    assert.equal(first.response.status, 200);
    assert.equal(first.body.success, true);
    assert.equal(first.body.readingsChecked, 3);
    assert.equal(first.body.alertsCreated, 4);

    const [alertsAfterFirstCheck] = await adminConnection.execute(
      `SELECT alert_type, severity, sensor_value, threshold_value, is_resolved
       FROM alerts WHERE shipment_id = ? AND alert_type = 'TEMPERATURE'`,
      [fixture.shipmentId],
    );
    assert.equal(alertsAfterFirstCheck.length, 2);
    const highTemperature = alertsAfterFirstCheck.find((row) => Number(row.sensor_value) === 9);
    const lowTemperature = alertsAfterFirstCheck.find((row) => Number(row.sensor_value) === 1);
    assert.equal(highTemperature.severity, "MEDIUM");
    assert.equal(Number(highTemperature.threshold_value), 8);
    assert.equal(lowTemperature.severity, "MEDIUM");
    assert.equal(Number(lowTemperature.threshold_value), 2);
    assert.ok(alertsAfterFirstCheck.every((row) => row.is_resolved === 0));

    const second = await postPatch(path, "POST", {});
    assert.equal(second.response.status, 200);
    assert.equal(second.body.alertsCreated, 0);
    const [alertsAfterSecondCheck] = await adminConnection.execute(
      `SELECT alert_id FROM alerts
       WHERE shipment_id = ? AND alert_type = 'TEMPERATURE' AND is_resolved = 0`,
      [fixture.shipmentId],
    );
    assert.equal(alertsAfterSecondCheck.length, 2);
    const [humidityAlerts] = await adminConnection.execute(
      "SELECT alert_id, sensor_value, threshold_value FROM alerts WHERE shipment_id = ? AND alert_type = 'HUMIDITY' AND message LIKE 'Product %' AND is_resolved = 0",
      [fixture.shipmentId],
    );
    assert.equal(humidityAlerts.length, 2);
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

  await t.test("sensor ingestion validates readings and idempotently replaces matching sensor timestamps", async () => {
    const path = `/api/shipments/${fixture.shipmentId}/sensors`;
    const reading = { sensor_id: "dock-1", timestamp: "2030-01-01T00:03:00Z", temperature: 5, humidity: 50, battery_level: 88 };
    const first = await postPatch(path, "POST", reading);
    assert.equal(first.response.status, 201);
    assert.equal(first.body.inserted, 1);
    const repeated = await postPatch(path, "POST", { ...reading, temperature: 6 });
    assert.equal(repeated.response.status, 201);
    assert.equal(repeated.body.inserted, 0);
    assert.equal(repeated.body.updated, 1);
    const invalid = await postPatch(path, "POST", { ...reading, humidity: 110 });
    assert.equal(invalid.response.status, 400);
    const stored = await mongoClient.db(mongoTestDatabase).collection("sensor_readings").findOne({ sensor_id: "dock-1", shipment_id: fixture.shipmentId });
    assert.equal(stored.temperature, 6);
    assert.equal(stored.humidity, 50);

    const reports = await getJson("/api/reports");
    assert.equal(reports.response.status, 200);
    assert.equal(reports.body.shipmentOverview.length, 2);
    assert.equal(Number(reports.body.shipmentsByRoute[0].shipment_count), 2);
    assert.equal(reports.body.monthlyShipments.length, 2);
    const metrics = reports.body.sensorMetricsByShipment.find((row) => row._id === fixture.shipmentId);
    assert.equal(metrics.readings, 4);
    assert.equal(Number(metrics.temperatureMeanC.toFixed(2)), 5.33);
    assert.equal(Number(metrics.humidityMeanPercent.toFixed(2)), 50);
    assert.equal(Number(reports.body.shipmentsByRoute[0].averageHumidityPercent.toFixed(2)), 50);
  });
});

test("research import is idempotent in the isolated MongoDB test database", async () => {
  const headers = [
    "Time", "shipment_id", "Front_Top", "Front_Middle", "Front_Bottom",
    "Middle_Top", "Middle_Middle", "Middle_Bottom", "Rear_Top", "Rear_Middle", "Rear_Bottom",
    "T_mean", "risk_level", "y_next_120_R2",
    ...Array.from({ length: researchDataset.columns - 14 }, (_, index) => `feature_${index}`),
  ];
  const values = Array(headers.length).fill(null);
  for (const [field, value] of Object.entries({ Time: "2019-03-12 12:30:00", shipment_id: "S1", Front_Top: 4.2, T_mean: 4.4, risk_level: 2, y_next_120_R2: 1 })) {
    values[headers.indexOf(field)] = value;
  }
  const document = buildResearchDocuments(headers, [values])[0];
  const collection = mongoClient.db(mongoTestDatabase).collection("research_strawberry_windows");
  await collection.createIndex({ dataset_revision: 1, shipment_id: 1, Time: 1 }, { unique: true });
  await upsertResearchDocuments(collection, [document]);
  await upsertResearchDocuments(collection, [{ ...document, Front_Top: 4.8 }]);
  assert.equal(await collection.countDocuments({ dataset_revision: researchDataset.revision }), 1);
  const stored = await collection.findOne({ _id: document._id });
  assert.equal(stored.shipment_id, "S1");
  assert.equal(stored.Time, "2019-03-12 12:30:00");
  assert.equal(stored.Front_Top, 4.8);
  assert.equal(stored.Front_Middle, null);
});

test("research API applies shipment and time filters and reports raw-probe statistics", async () => {
  const url = "/api/research/strawberry?shipmentId=S1&start=2019-03-12%2012%3A30%3A00&end=2019-03-12%2012%3A30%3A00&minTemperatureC=4&maxTemperatureC=4.5";
  const response = await getJson(url);
  assert.equal(response.response.status, 200);
  assert.equal(response.body.analysis.rowCount, 1);
  assert.deepEqual(response.body.analysis.shipmentCounts, { S1: 1, S2: 0, S3: 0, S4: 0, S5: 0, S6: 0 });
  assert.equal(response.body.analysis.temperatureStats.probeMeasurementsCounted, 1);
  assert.equal(response.body.analysis.temperatureStats.meanC, 4.8);
  assert.deepEqual(response.body.analysis.temperatureExcursions, {
    threshold: { minimumC: 4, maximumC: 4.5 }, excursionWindowCount: 1, excursionProbeCount: 1,
  });

  const unsupported = await getJson("/api/research/strawberry?shipmentId=S7");
  assert.equal(unsupported.response.status, 400);
  const reversed = await getJson("/api/research/strawberry?start=2019-03-13&end=2019-03-12");
  assert.equal(reversed.response.status, 400);
  const badDate = await getJson("/api/research/strawberry?start=2019-02-30");
  assert.equal(badDate.response.status, 400);
  const empty = await getJson("/api/research/strawberry?shipmentId=S2&start=2030-01-01&end=2030-01-02");
  assert.equal(empty.response.status, 200);
  assert.equal(empty.body.analysis.rowCount, 0);
  assert.equal(empty.body.analysis.timeRange, null);
});

test("classified demo records and their linked records are excluded without deletion", async () => {
  await adminConnection.execute(
    "INSERT INTO non_operational_shipments (shipment_id, shipment_code, reason) VALUES (?, ?, ?)",
    [fixture.shipmentId, `TEST-${suffix}`, "Isolated integration test classification"],
  );
  const shipments = await getJson("/api/shipments");
  assert.equal(shipments.body.shipments.some((row) => row.shipment_id === fixture.shipmentId), false);
  const alerts = await getJson("/api/alerts");
  assert.equal(alerts.body.alerts.some((row) => row.shipment_id === fixture.shipmentId), false);
  const sensors = await getJson(`/api/shipments/${fixture.shipmentId}/sensors`);
  assert.equal(sensors.response.status, 404);
  const temperatureCheck = await postPatch(`/api/shipments/${fixture.shipmentId}/check-temperature`, "POST", {});
  assert.equal(temperatureCheck.response.status, 404);
  const statusUpdate = await postPatch(`/api/shipments/${fixture.shipmentId}`, "PATCH", { status: "CANCELLED" });
  assert.equal(statusUpdate.response.status, 404);
  const resolve = await postPatch(`/api/alerts/${fixture.alertId}`, "PATCH", {});
  assert.equal(resolve.response.status, 404);
  const [preservedShipments] = await adminConnection.execute("SELECT shipment_id FROM shipments WHERE shipment_id = ?", [fixture.shipmentId]);
  const [preservedAlerts] = await adminConnection.execute("SELECT alert_id FROM alerts WHERE alert_id = ?", [fixture.alertId]);
  const preservedReadings = await mongoClient.db(mongoTestDatabase).collection("sensor_readings").countDocuments({ shipment_id: fixture.shipmentId });
  assert.equal(preservedShipments.length, 1);
  assert.equal(preservedAlerts.length, 1);
  assert.equal(preservedReadings, 4);
});
