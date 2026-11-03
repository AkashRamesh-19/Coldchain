-- Give every active operations staff account access to current operational
-- shipments, matching the shared dashboard experience requested for staff.
-- This only adds missing assignment links; it does not change shipment data.
INSERT IGNORE INTO `shipment_assignments` (`shipment_id`, `user_id`, `assigned_by`)
SELECT s.`shipment_id`, u.`user_id`, (
  SELECT admin.`user_id`
  FROM `users` AS admin
  WHERE admin.`role` = 'ADMIN' AND admin.`is_active` = 1
  ORDER BY admin.`user_id`
  LIMIT 1
)
FROM `shipments` AS s
INNER JOIN `users` AS u
  ON u.`role` = 'OPERATIONS_STAFF' AND u.`is_active` = 1
WHERE NOT EXISTS (
  SELECT 1 FROM `non_operational_shipments` AS n WHERE n.`shipment_id` = s.`shipment_id`
);
