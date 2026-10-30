import assert from "node:assert/strict";
import test from "node:test";
import { isCatalogResource, validateCatalogBody } from "../lib/catalog.mjs";

test("catalog resource names are explicitly allowlisted", () => {
  assert.equal(isCatalogResource("products"), true);
  assert.equal(isCatalogResource("products; DROP TABLE users"), false);
});

test("product catalog validation enforces bounds and supported fields", () => {
  assert.equal(validateCatalogBody("products", {
    supplier_id: 1, product_name: "Strawberries", category: "Produce", min_temperature: 2, max_temperature: 8,
    min_humidity: 80, max_humidity: 70,
  }), "min_humidity must be below max_humidity");
  assert.equal(validateCatalogBody("products", {
    supplier_id: 1, product_name: "Strawberries", category: "Produce", min_temperature: 8, max_temperature: 2,
  }), "min_temperature must be below max_temperature");
  assert.match(validateCatalogBody("products", {
    supplier_id: 1, product_name: "Strawberries", category: "Produce", min_temperature: 2, max_temperature: 8, password_hash: "x",
  }), /Unsupported fields/);
});

test("routes require distinct warehouses and positive distances", () => {
  assert.equal(validateCatalogBody("routes", {
    route_name: "Same origin and destination", source_warehouse_id: 2, destination_warehouse_id: 2,
    distance_km: 10, estimated_duration_hours: 2,
  }), "A route must use different warehouses");
  assert.equal(validateCatalogBody("routes", {
    route_name: "Invalid distance", source_warehouse_id: 2, destination_warehouse_id: 3,
    distance_km: 0, estimated_duration_hours: 2,
  }), "distance_km must be positive");
});
