import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = await readFile(new URL("../database/mysql-schema.sql", import.meta.url), "utf8");
const demoClassificationMigration = await readFile(
  new URL("../database/migrations/001-exclude-known-demo-shipments.sql", import.meta.url),
  "utf8",
);
const shipmentAssignmentMigration = await readFile(
  new URL("../database/migrations/002-shipment-assignments.sql", import.meta.url),
  "utf8",
);

test("schema source includes all inspected relational tables and keys", () => {
  assert.equal([...schema.matchAll(/^CREATE TABLE IF NOT EXISTS /gm)].length, 13);
  assert.equal([...schema.matchAll(/FOREIGN KEY/g)].length, 19);
  for (const name of [
    "suppliers",
    "warehouses",
    "drivers",
    "vehicles",
    "users",
    "products",
    "routes",
    "shipments",
    "shipment_assignments",
    "non_operational_shipments",
    "shipment_items",
    "shipment_status_history",
    "alerts",
    "shipment_overview",
    "trg_shipment_status_history",
    "sp_create_alert",
  ]) {
    assert.ok(schema.includes(name), `expected schema object ${name}`);
  }
});

test("schema source is portable and contains no destructive drops or seed rows", () => {
  assert.doesNotMatch(schema, /DEFINER\s*=/i);
  assert.doesNotMatch(schema, /DROP\s+TABLE/i);
  assert.doesNotMatch(schema, /INSERT\s+INTO\s+(?:`?(?:suppliers|warehouses|drivers|vehicles|users|products|routes|shipments|shipment_items)`?)/i);
});

test("demo classification migration is additive and guarded by audited ID/code pairs", () => {
  assert.match(demoClassificationMigration, /CREATE TABLE IF NOT EXISTS `non_operational_shipments`/i);
  assert.doesNotMatch(demoClassificationMigration, /^\s*(?:DROP|DELETE|TRUNCATE)\b/gmi);
  for (const [id, code] of [
    [1, "SHP-2026-001"],
    [2, "SHP-2026-002"],
    [3, "SHP-2026-003"],
    [4, "SHP-2026-004"],
  ]) {
    const expectedPair = "(`shipment_id` = " + id + " AND `shipment_code` = '" + code + "')";
    assert.ok(demoClassificationMigration.includes(expectedPair), `expected guarded pair ${id}/${code}`);
  }
});

test("shipment assignment migration adds only the role-scope relation", () => {
  assert.match(shipmentAssignmentMigration, /CREATE TABLE IF NOT EXISTS `shipment_assignments`/i);
  assert.match(shipmentAssignmentMigration, /FOREIGN KEY \(`shipment_id`\)/i);
  assert.match(shipmentAssignmentMigration, /FOREIGN KEY \(`user_id`\)/i);
  assert.doesNotMatch(shipmentAssignmentMigration, /^\s*(?:DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/gmi);
});
