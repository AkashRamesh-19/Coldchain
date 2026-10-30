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

-- Route summary: correlated classified-row exclusion, aggregate functions,
-- GROUP BY, LEFT JOIN to route-level alerts, and conditional average delay.
SELECT r.route_id, r.route_name,
       COUNT(s.shipment_id) AS shipment_count,
       SUM(s.status IN ('CREATED','IN_TRANSIT','DELAYED')) AS active_shipments,
       SUM(s.status = 'DELIVERED') AS delivered_shipments,
       COALESCE(alert_totals.total_alerts, 0) AS total_alerts,
       COALESCE(alert_totals.unresolved_alerts, 0) AS unresolved_alerts,
       AVG(CASE WHEN s.actual_delivery > s.expected_delivery
           THEN TIMESTAMPDIFF(SECOND, s.expected_delivery, s.actual_delivery) / 3600 END) AS average_delay_hours
FROM routes AS r
JOIN shipments AS s ON s.route_id = r.route_id
LEFT JOIN (
  SELECT s2.route_id, COUNT(a.alert_id) AS total_alerts,
         SUM(a.is_resolved = 0) AS unresolved_alerts
  FROM alerts AS a
  JOIN shipments AS s2 ON s2.shipment_id = a.shipment_id
  WHERE NOT EXISTS (
    SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s2.shipment_id
  )
  GROUP BY s2.route_id
) AS alert_totals ON alert_totals.route_id = r.route_id
WHERE NOT EXISTS (
  SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
)
GROUP BY r.route_id, r.route_name, alert_totals.total_alerts, alert_totals.unresolved_alerts
ORDER BY unresolved_alerts DESC, shipment_count DESC, r.route_name;

-- Monthly shipment volume and status mix.
SELECT DATE_FORMAT(shipment_date, '%Y-%m') AS shipment_month,
       COUNT(*) AS shipment_count,
       SUM(status = 'DELIVERED') AS delivered_shipments,
       SUM(status IN ('CREATED','IN_TRANSIT','DELAYED')) AS active_shipments
FROM shipments AS s
WHERE NOT EXISTS (
  SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
)
GROUP BY DATE_FORMAT(shipment_date, '%Y-%m')
ORDER BY shipment_month;

-- Operations staff see only explicitly assigned operational shipments.
SELECT o.shipment_id, o.shipment_code, o.route_name, o.status
FROM shipment_overview AS o
JOIN shipment_assignments AS a ON a.shipment_id = o.shipment_id
WHERE a.user_id = ?
  AND NOT EXISTS (
    SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = o.shipment_id
  )
ORDER BY o.shipment_date DESC, o.shipment_id DESC;

-- Average temperatures and excursion counts are computed by GET /api/reports
-- using MongoDB's sensor_readings and the MySQL product ranges above. They
-- cannot be represented by a single MySQL query without copying sensor data.
