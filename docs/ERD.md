# ColdChain Guardian ER diagram

![ColdChain Guardian relational and document data model](ER_Diagram.png)

The generated PNG and SVG are kept beside this editable Mermaid source.

This diagram reflects the connected local MySQL schema inspected on 26 October 2026. It shows declared foreign keys from `information_schema`; the lines do not infer any undocumented relationship. `shipment_overview` is a view, not a base table. MongoDB readings are shown separately because MySQL cannot declare a foreign key into MongoDB.

```mermaid
erDiagram
    SUPPLIERS {
        int supplier_id PK
        string supplier_name
    }
    PRODUCTS {
        int product_id PK
        int supplier_id FK
        string product_name
        decimal min_temperature
        decimal max_temperature
    }
    WAREHOUSES {
        int warehouse_id PK
        string warehouse_name
    }
    ROUTES {
        int route_id PK
        int source_warehouse_id FK
        int destination_warehouse_id FK
        string route_name
    }
    DRIVERS {
        int driver_id PK
        string full_name
    }
    VEHICLES {
        int vehicle_id PK
        string vehicle_number
    }
    USERS {
        int user_id PK
        string full_name
    }
    SHIPMENTS {
        int shipment_id PK
        int supplier_id FK
        int source_warehouse_id FK
        int destination_warehouse_id FK
        int vehicle_id FK
        int driver_id FK
        int route_id FK
        string status
    }
    NON_OPERATIONAL_SHIPMENTS {
        int shipment_id PK, FK
        string shipment_code UK
        string reason
        datetime marked_at
    }
    SHIPMENT_ITEMS {
        int shipment_item_id PK
        int shipment_id FK
        int product_id FK
        decimal quantity
    }
    SHIPMENT_ASSIGNMENTS {
        int shipment_id PK, FK
        int user_id PK, FK
        int assigned_by FK
        datetime assigned_at
    }
    SHIPMENT_STATUS_HISTORY {
        int history_id PK
        int shipment_id FK
        int changed_by FK
        string old_status
        string new_status
    }
    ALERTS {
        int alert_id PK
        int shipment_id FK
        int resolved_by FK
        string alert_type
        string severity
        boolean is_resolved
    }
    MONGO_SENSOR_READINGS {
        string _id PK
        int shipment_id
        datetime timestamp
        decimal temperature_C
    }
    MONGO_RESEARCH_STRAWBERRY_WINDOWS {
        string _id PK
        string shipment_id
        string Time
        string dataset_revision
        decimal Front_Top
        decimal risk_level
    }
    MONGO_USER_SESSIONS {
        string token_hash PK
        int user_id
        datetime expires_at
    }

    SUPPLIERS ||--o{ PRODUCTS : supplies
    SUPPLIERS ||--o{ SHIPMENTS : ships
    WAREHOUSES ||--o{ ROUTES : route_source
    WAREHOUSES ||--o{ ROUTES : route_destination
    WAREHOUSES ||--o{ SHIPMENTS : shipment_source
    WAREHOUSES ||--o{ SHIPMENTS : shipment_destination
    DRIVERS ||--o{ SHIPMENTS : assigned_to
    VEHICLES ||--o{ SHIPMENTS : assigned_to
    ROUTES ||--o{ SHIPMENTS : follows
    SHIPMENTS ||--o{ SHIPMENT_ITEMS : contains
    SHIPMENTS ||--o{ SHIPMENT_ASSIGNMENTS : assigned_to
    USERS ||--o{ SHIPMENT_ASSIGNMENTS : assigned_user
    USERS o|--o{ SHIPMENT_ASSIGNMENTS : assigned_by
    PRODUCTS ||--o{ SHIPMENT_ITEMS : listed_as
    SHIPMENTS ||--o{ SHIPMENT_STATUS_HISTORY : has_history
    USERS o|--o{ SHIPMENT_STATUS_HISTORY : changed_by
    SHIPMENTS ||--o{ ALERTS : raises
    SHIPMENTS o|--|| NON_OPERATIONAL_SHIPMENTS : classified_as
    USERS o|--o{ ALERTS : resolves
    SHIPMENTS ||--o{ MONGO_SENSOR_READINGS : linked_by_shipment_id
```

## Reading the diagram

- A shipment references its supplier, origin and destination warehouses, vehicle, driver, and route through the foreign keys declared on `shipments`.
- A shipment can contain multiple products through `shipment_items`; each item stores quantity and unit weight. Product temperature limits are stored on `products`.
- `shipment_status_history` and `alerts` belong to a shipment. Optional `changed_by` and `resolved_by` references point to `users`.
- `shipment_assignments` maps operations staff users to shipments. It also records the manager/admin account that made the assignment; the composite primary key prevents duplicate assignment rows.
- `routes` references warehouses twice, once as source and once as destination. The labels distinguish the two real foreign keys.
- The MongoDB document contains a `shipment_id` value, which the application uses to join the readings to the MySQL shipment. MongoDB does not enforce that cross-database relationship.
- `non_operational_shipments` classifies excluded demo rows without deleting shipments or their linked records. Its shipment ID and code are protected by a foreign key and unique key.
- `research_strawberry_windows` is a separate MongoDB collection. Its `S1`–`S6` IDs are source identifiers, not references to operational MySQL shipments.
- `user_sessions` is a separate MongoDB collection. Its `user_id` refers to MySQL users at the application layer and is not a cross-database foreign key.
- The schema source contains the original 11 relational tables plus `non_operational_shipments` and `shipment_assignments` (13 base tables), and the `shipment_overview` view.

## Database fit

MySQL is appropriate for entities that need explicit keys, constraints, and multi-table joins: shipments, products, suppliers, inventory items, and alert ownership. MongoDB holds operational timestamped observations in `sensor_readings` and published research windows in `research_strawberry_windows`. The application keeps the datasets separate; only operational readings are associated with operational MySQL shipment IDs.
