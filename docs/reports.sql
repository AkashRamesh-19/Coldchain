-- Read-only MySQL report queries. The example outputs in README.md were
-- calculated against the inspected local database on 26 October 2026.

-- Shipment count grouped by current status.
SELECT status, COUNT(*) AS shipment_count
FROM shipments
GROUP BY status
ORDER BY status;

-- Unresolved alert count by severity.
SELECT severity, COUNT(*) AS unresolved_count
FROM alerts
WHERE is_resolved = 0
GROUP BY severity
ORDER BY FIELD(severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- Relational shipment overview. The same view backs /api/shipments.
SELECT shipment_id, shipment_code, supplier_name,
       source_warehouse, destination_warehouse,
       vehicle_number, driver_name, route_name, distance_km,
       shipment_date, expected_delivery, actual_delivery, status
FROM shipment_overview
ORDER BY shipment_id;

-- Shipment products and the MySQL thresholds used by the application.
-- Sensor readings have shipment-level, not item-level, association.
SELECT si.shipment_id, p.product_id, p.product_name,
       p.min_temperature AS minimum_C, p.max_temperature AS maximum_C
FROM shipment_items AS si
JOIN products AS p ON p.product_id = si.product_id
ORDER BY si.shipment_id, p.product_id;

-- Average temperatures and excursion counts are computed by GET /api/reports
-- using MongoDB's sensor_readings and the MySQL product ranges above. They
-- cannot be represented by a single MySQL query without copying sensor data.
