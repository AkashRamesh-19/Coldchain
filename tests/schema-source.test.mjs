import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = await readFile(new URL("../database/mysql-schema.sql", import.meta.url), "utf8");

test("schema source includes all inspected relational tables and keys", () => {
  assert.equal([...schema.matchAll(/^CREATE TABLE IF NOT EXISTS /gm)].length, 11);
  assert.equal([...schema.matchAll(/FOREIGN KEY/g)].length, 15);
  for (const name of [
    "suppliers",
    "warehouses",
    "drivers",
    "vehicles",
    "users",
    "products",
    "routes",
    "shipments",
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
