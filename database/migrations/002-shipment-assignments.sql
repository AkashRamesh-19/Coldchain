-- Additive table for role-scoped operational shipment access.
-- Existing shipment and user data is not changed.
CREATE TABLE IF NOT EXISTS `shipment_assignments` (
  `shipment_id` int NOT NULL,
  `user_id` int NOT NULL,
  `assigned_by` int DEFAULT NULL,
  `assigned_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`shipment_id`,`user_id`),
  KEY `idx_shipment_assignments_user` (`user_id`,`shipment_id`),
  KEY `fk_shipment_assignments_assigned_by` (`assigned_by`),
  CONSTRAINT `fk_shipment_assignments_shipment` FOREIGN KEY (`shipment_id`) REFERENCES `shipments` (`shipment_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_shipment_assignments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_shipment_assignments_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
