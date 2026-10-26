import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = (process.env.BACKEND_TEST_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  return { response, body };
}

test("read-only backend GET routes return valid connected data", async () => {
  for (const path of ["/api/db-test", "/api/mongo-test"]) {
    const { response, body } = await getJson(path);
    assert.equal(response.status, 200, `${path} status`);
    assert.equal(body.success, true, `${path} connection`);
  }

  const { response: shipmentsResponse, body: shipments } = await getJson("/api/shipments");
  assert.equal(shipmentsResponse.status, 200);
  assert.equal(shipments.success, true);
  assert.ok(Array.isArray(shipments.shipments));
  assert.equal(shipments.count, shipments.shipments.length);

  const sensorId = shipments.shipments[0]?.shipment_id ?? 1;
  const { response: sensorsResponse, body: sensors } = await getJson(`/api/shipments/${sensorId}/sensors`);
  assert.equal(sensorsResponse.status, 200);
  assert.equal(sensors.success, true);
  assert.ok(Array.isArray(sensors.readings));
  assert.equal(sensors.count, sensors.readings.length);

  const { response: alertsResponse, body: alerts } = await getJson("/api/alerts");
  assert.equal(alertsResponse.status, 200);
  assert.equal(alerts.success, true);
  assert.ok(Array.isArray(alerts.alerts));
  assert.equal(alerts.count, alerts.alerts.length);

  const { response: reportsResponse, body: reports } = await getJson("/api/reports");
  assert.equal(reportsResponse.status, 200);
  assert.equal(reports.success, true);
  assert.ok(Array.isArray(reports.temperatureByShipment));
  assert.ok(Array.isArray(reports.unresolvedAlertsBySeverity));
  assert.ok(Array.isArray(reports.shipmentCountsByStatus));
  assert.ok(Array.isArray(reports.shipmentOverview));
  assert.match(reports.dataNote, /simulated/i);
});

test("sensor route rejects malformed shipment IDs before database work", async () => {
  const { response, body } = await getJson("/api/shipments/not-a-number/sensors");
  assert.equal(response.status, 400);
  assert.equal(body.success, false);
});
