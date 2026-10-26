-- ColdChain Guardian MySQL schema source, extracted from the existing local schema.

-- No application data or credentials are included.

-- Apply only to a new/empty database. This is not a migration for an existing database.

CREATE DATABASE IF NOT EXISTS coldchain_guardian;

USE coldchain_guardian;


-- Table: suppliers
CREATE TABLE IF NOT EXISTS `suppliers` (
  `supplier_id` int NOT NULL AUTO_INCREMENT,
  `supplier_name` varchar(150) NOT NULL,
  `contact_person` varchar(100) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Table: warehouses
CREATE TABLE IF NOT EXISTS `warehouses` (
  `warehouse_id` int NOT NULL AUTO_INCREMENT,
  `warehouse_name` varchar(150) NOT NULL,
  `location` varchar(255) NOT NULL,
  `city` varchar(100) NOT NULL,
  `state` varchar(100) DEFAULT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Table: drivers
CREATE TABLE IF NOT EXISTS `drivers` (
  `driver_id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(100) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `license_number` varchar(50) NOT NULL,
  `license_expiry` date NOT NULL,
  `status` enum('AVAILABLE','ON_DUTY','INACTIVE') NOT NULL DEFAULT 'AVAILABLE',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`driver_id`),
  UNIQUE KEY `phone` (`phone`),
  UNIQUE KEY `license_number` (`license_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Table: vehicles
CREATE TABLE IF NOT EXISTS `vehicles` (
  `vehicle_id` int NOT NULL AUTO_INCREMENT,
  `vehicle_number` varchar(50) NOT NULL,
  `vehicle_type` varchar(100) NOT NULL,
  `capacity_kg` decimal(10,2) NOT NULL,
  `refrigeration_type` varchar(100) DEFAULT NULL,
  `status` enum('AVAILABLE','IN_TRANSIT','MAINTENANCE') NOT NULL DEFAULT 'AVAILABLE',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`vehicle_id`),
  UNIQUE KEY `vehicle_number` (`vehicle_number`),
  CONSTRAINT `chk_vehicle_capacity` CHECK ((`capacity_kg` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Table: users
CREATE TABLE IF NOT EXISTS `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('LOGISTICS_MANAGER','OPERATIONS_STAFF','ADMIN') NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Table: products
CREATE TABLE IF NOT EXISTS `products` (
  `product_id` int NOT NULL AUTO_INCREMENT,
  `supplier_id` int NOT NULL,
  `product_name` varchar(150) NOT NULL,
  `category` varchar(100) NOT NULL,
  `description` text,
  `min_temperature` decimal(5,2) NOT NULL,
  `max_temperature` decimal(5,2) NOT NULL,
  `min_humidity` decimal(5,2) DEFAULT NULL,
  `max_humidity` decimal(5,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`product_id`),
  KEY `fk_product_supplier` (`supplier_id`),
  CONSTRAINT `fk_product_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`),
  CONSTRAINT `chk_product_humidity` CHECK (((`min_humidity` is null) or (`max_humidity` is null) or (`min_humidity` < `max_humidity`))),
  CONSTRAINT `chk_product_temperature` CHECK ((`min_temperature` < `max_temperature`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Table: routes
CREATE TABLE IF NOT EXISTS `routes` (
  `route_id` int NOT NULL AUTO_INCREMENT,
  `route_name` varchar(150) NOT NULL,
  `source_warehouse_id` int NOT NULL,
  `destination_warehouse_id` int NOT NULL,
  `distance_km` decimal(10,2) NOT NULL,
  `estimated_duration_hours` decimal(6,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`route_id`),
  KEY `fk_route_source` (`source_warehouse_id`),
  KEY `fk_route_destination` (`destination_warehouse_id`),
  CONSTRAINT `fk_route_destination` FOREIGN KEY (`destination_warehouse_id`) REFERENCES `warehouses` (`warehouse_id`),
  CONSTRAINT `fk_route_source` FOREIGN KEY (`source_warehouse_id`) REFERENCES `warehouses` (`warehouse_id`),
  CONSTRAINT `chk_route_different_warehouses` CHECK ((`source_warehouse_id` <> `destination_warehouse_id`)),
  CONSTRAINT `chk_route_distance` CHECK ((`distance_km` > 0)),
  CONSTRAINT `chk_route_duration` CHECK ((`estimated_duration_hours` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Table: shipments
CREATE TABLE IF NOT EXISTS `shipments` (
  `shipment_id` int NOT NULL AUTO_INCREMENT,
  `shipment_code` varchar(50) NOT NULL,
  `supplier_id` int NOT NULL,
  `source_warehouse_id` int NOT NULL,
  `destination_warehouse_id` int NOT NULL,
  `vehicle_id` int NOT NULL,
  `driver_id` int NOT NULL,
  `route_id` int NOT NULL,
  `shipment_date` datetime NOT NULL,
  `expected_delivery` datetime NOT NULL,
  `actual_delivery` datetime DEFAULT NULL,
  `status` enum('CREATED','IN_TRANSIT','DELAYED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'CREATED',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`shipment_id`),
  UNIQUE KEY `shipment_code` (`shipment_code`),
  KEY `fk_shipment_supplier` (`supplier_id`),
  KEY `fk_shipment_source` (`source_warehouse_id`),
  KEY `fk_shipment_destination` (`destination_warehouse_id`),
  KEY `fk_shipment_vehicle` (`vehicle_id`),
  KEY `fk_shipment_driver` (`driver_id`),
  KEY `fk_shipment_route` (`route_id`),
  KEY `idx_shipments_status` (`status`),
  CONSTRAINT `fk_shipment_destination` FOREIGN KEY (`destination_warehouse_id`) REFERENCES `warehouses` (`warehouse_id`),
  CONSTRAINT `fk_shipment_driver` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`driver_id`),
  CONSTRAINT `fk_shipment_route` FOREIGN KEY (`route_id`) REFERENCES `routes` (`route_id`),
  CONSTRAINT `fk_shipment_source` FOREIGN KEY (`source_warehouse_id`) REFERENCES `warehouses` (`warehouse_id`),
  CONSTRAINT `fk_shipment_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`),
  CONSTRAINT `fk_shipment_vehicle` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`vehicle_id`),
  CONSTRAINT `chk_shipment_delivery_dates` CHECK ((`expected_delivery` >= `shipment_date`)),
  CONSTRAINT `chk_shipment_warehouses` CHECK ((`source_warehouse_id` <> `destination_warehouse_id`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Explicitly classify records excluded from operational monitoring without deleting
-- their shipment, item, history, alert, or sensor documents.
CREATE TABLE IF NOT EXISTS `non_operational_shipments` (
  `shipment_id` int NOT NULL,
  `shipment_code` varchar(50) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `marked_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`shipment_id`),
  UNIQUE KEY `uq_non_operational_shipment_code` (`shipment_code`),
  CONSTRAINT `fk_non_operational_shipment` FOREIGN KEY (`shipment_id`) REFERENCES `shipments` (`shipment_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Table: shipment_items
CREATE TABLE IF NOT EXISTS `shipment_items` (
  `shipment_item_id` int NOT NULL AUTO_INCREMENT,
  `shipment_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `unit_weight_kg` decimal(10,2) NOT NULL,
  PRIMARY KEY (`shipment_item_id`),
  UNIQUE KEY `uq_shipment_product` (`shipment_id`,`product_id`),
  KEY `fk_shipment_item_product` (`product_id`),
  CONSTRAINT `fk_shipment_item_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`),
  CONSTRAINT `fk_shipment_item_shipment` FOREIGN KEY (`shipment_id`) REFERENCES `shipments` (`shipment_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_shipment_item_quantity` CHECK ((`quantity` > 0)),
  CONSTRAINT `chk_shipment_item_weight` CHECK ((`unit_weight_kg` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Table: shipment_status_history
CREATE TABLE IF NOT EXISTS `shipment_status_history` (
  `history_id` int NOT NULL AUTO_INCREMENT,
  `shipment_id` int NOT NULL,
  `old_status` enum('CREATED','IN_TRANSIT','DELAYED','DELIVERED','CANCELLED') DEFAULT NULL,
  `new_status` enum('CREATED','IN_TRANSIT','DELAYED','DELIVERED','CANCELLED') NOT NULL,
  `changed_by` int DEFAULT NULL,
  `changed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `remarks` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`history_id`),
  KEY `fk_status_history_shipment` (`shipment_id`),
  KEY `fk_status_history_user` (`changed_by`),
  CONSTRAINT `fk_status_history_shipment` FOREIGN KEY (`shipment_id`) REFERENCES `shipments` (`shipment_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_status_history_user` FOREIGN KEY (`changed_by`) REFERENCES `users` (`user_id`),
  CONSTRAINT `chk_status_change` CHECK (((`old_status` is null) or (`old_status` <> `new_status`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Table: alerts
CREATE TABLE IF NOT EXISTS `alerts` (
  `alert_id` int NOT NULL AUTO_INCREMENT,
  `shipment_id` int NOT NULL,
  `alert_type` enum('TEMPERATURE','HUMIDITY','LOCATION','SENSOR_FAILURE') NOT NULL,
  `severity` enum('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  `message` varchar(500) NOT NULL,
  `sensor_value` decimal(10,2) DEFAULT NULL,
  `threshold_value` decimal(10,2) DEFAULT NULL,
  `is_resolved` tinyint(1) NOT NULL DEFAULT '0',
  `resolved_by` int DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`alert_id`),
  KEY `fk_alert_shipment` (`shipment_id`),
  KEY `fk_alert_resolved_by` (`resolved_by`),
  CONSTRAINT `fk_alert_resolved_by` FOREIGN KEY (`resolved_by`) REFERENCES `users` (`user_id`),
  CONSTRAINT `fk_alert_shipment` FOREIGN KEY (`shipment_id`) REFERENCES `shipments` (`shipment_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Relational shipment summary view.
CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `shipment_overview` AS select `s`.`shipment_id` AS `shipment_id`,`s`.`shipment_code` AS `shipment_code`,`sup`.`supplier_name` AS `supplier_name`,`sw`.`warehouse_name` AS `source_warehouse`,`dw`.`warehouse_name` AS `destination_warehouse`,`v`.`vehicle_number` AS `vehicle_number`,`d`.`full_name` AS `driver_name`,`r`.`route_name` AS `route_name`,`r`.`distance_km` AS `distance_km`,`s`.`shipment_date` AS `shipment_date`,`s`.`expected_delivery` AS `expected_delivery`,`s`.`actual_delivery` AS `actual_delivery`,`s`.`status` AS `status` from ((((((`shipments` `s` join `suppliers` `sup` on((`s`.`supplier_id` = `sup`.`supplier_id`))) join `warehouses` `sw` on((`s`.`source_warehouse_id` = `sw`.`warehouse_id`))) join `warehouses` `dw` on((`s`.`destination_warehouse_id` = `dw`.`warehouse_id`))) join `vehicles` `v` on((`s`.`vehicle_id` = `v`.`vehicle_id`))) join `drivers` `d` on((`s`.`driver_id` = `d`.`driver_id`))) join `routes` `r` on((`s`.`route_id` = `r`.`route_id`)));


-- Record shipment status changes in shipment_status_history.
DELIMITER $$
CREATE TRIGGER `trg_shipment_status_history` AFTER UPDATE ON `shipments` FOR EACH ROW BEGIN
    IF OLD.status <> NEW.status THEN
        INSERT INTO shipment_status_history
        (
            shipment_id,
            old_status,
            new_status,
            changed_by,
            remarks
        )
        VALUES
        (
            NEW.shipment_id,
            OLD.status,
            NEW.status,
            NULL,
            'Status automatically recorded by database trigger'
        );
    END IF;
END$$
DELIMITER ;


-- Basic alert insertion procedure present in the inspected schema.
-- The temperature-check API currently applies its own transaction and deduplication.
DELIMITER $$
CREATE PROCEDURE `sp_create_alert`(
    IN p_shipment_id INT,
    IN p_alert_type VARCHAR(20),
    IN p_severity VARCHAR(10),
    IN p_message VARCHAR(500),
    IN p_sensor_value DECIMAL(10,2),
    IN p_threshold_value DECIMAL(10,2)
)
BEGIN
    INSERT INTO alerts (
        shipment_id,
        alert_type,
        severity,
        message,
        sensor_value,
        threshold_value
    )
    VALUES (
        p_shipment_id,
        p_alert_type,
        p_severity,
        p_message,
        p_sensor_value,
        p_threshold_value
    );
END$$
DELIMITER ;
