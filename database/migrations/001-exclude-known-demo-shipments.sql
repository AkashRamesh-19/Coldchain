-- Additive classification only. No shipment, alert, history, or sensor record is deleted.
CREATE TABLE IF NOT EXISTS `non_operational_shipments` (
  `shipment_id` int NOT NULL,
  `shipment_code` varchar(50) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `marked_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`shipment_id`),
  UNIQUE KEY `uq_non_operational_shipment_code` (`shipment_code`),
  CONSTRAINT `fk_non_operational_shipment` FOREIGN KEY (`shipment_id`) REFERENCES `shipments` (`shipment_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The local audit identified these exact ID/code pairs as the four classroom demo rows.
-- The join guards against marking a different shipment if IDs differ in another database.
INSERT INTO `non_operational_shipments` (`shipment_id`, `shipment_code`, `reason`)
SELECT `shipment_id`, `shipment_code`, 'Identified local classroom demo record'
FROM `shipments`
WHERE (`shipment_id` = 1 AND `shipment_code` = 'SHP-2026-001')
   OR (`shipment_id` = 2 AND `shipment_code` = 'SHP-2026-002')
   OR (`shipment_id` = 3 AND `shipment_code` = 'SHP-2026-003')
   OR (`shipment_id` = 4 AND `shipment_code` = 'SHP-2026-004')
ON DUPLICATE KEY UPDATE `reason` = VALUES(`reason`);
