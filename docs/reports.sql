-- Read-only operational report queries. Classified demo shipments are excluded.

-- Shipment count grouped by current status.
SELECT s.status, COUNT(*) AS shipment_count
FROM shipments AS s
WHERE NOT EXISTS (
  SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
)
GROUP BY s.status
ORDER BY s.status;

-- Unresolved alert count by severity.
SELECT a.severity, COUNT(*) AS unresolved_count
FROM alerts AS a
JOIN shipments AS s ON s.shipment_id = a.shipment_id
WHERE a.is_resolved = 0 AND NOT EXISTS (
  SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
)
GROUP BY a.severity
ORDER BY FIELD(a.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- Relational shipment overview. The same view backs /api/shipments.
SELECT shipment_id, shipment_code, supplier_name,
       source_warehouse, destination_warehouse,
       vehicle_number, driver_name, route_name, distance_km,
       shipment_date, expected_delivery, actual_delivery, status
FROM shipment_overview AS o
WHERE NOT EXISTS (
  SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = o.shipment_id
)
ORDER BY shipment_id;

-- Shipment products and the MySQL thresholds used by the application.
-- Sensor readings have shipment-level, not item-level, association.
SELECT si.shipment_id, p.product_id, p.product_name,
       p.min_temperature AS minimum_C, p.max_temperature AS maximum_C
FROM shipment_items AS si
JOIN products AS p ON p.product_id = si.product_id
WHERE NOT EXISTS (
  SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = si.shipment_id
)
ORDER BY si.shipment_id, p.product_id;

-- Average temperatures and excursion counts are computed by GET /api/reports
-- using MongoDB's sensor_readings and the MySQL product ranges above. They
-- cannot be represented by a single MySQL query without copying sensor data.
