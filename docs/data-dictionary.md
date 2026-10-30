# Relational schema reference

The authoritative DDL is [`database/mysql-schema.sql`](../database/mysql-schema.sql). It targets MySQL 8+ and contains 13 InnoDB base tables plus the `shipment_overview` view. Primary keys are integer auto-increment IDs except the composite key in `shipment_assignments`; named unique keys prevent duplicate shipment codes, emails, vehicle numbers, driver phone/license numbers, product-per-shipment rows, and assignments.

| Table | Purpose and key relationships |
| --- | --- |
| `suppliers` | Supplier contacts; one supplier may provide products and shipments. |
| `products` | Supplier-owned goods and minimum/maximum temperature and optional humidity limits. CHECK constraints require ordered min/max limits. |
| `warehouses` | Named logistics locations used as route and shipment endpoints. |
| `routes` | Directed source/destination warehouse pair, distance, and estimated duration; endpoints must differ and distance/duration must be positive. |
| `drivers` | Driver identity and availability state; phone and license number are unique. |
| `vehicles` | Vehicle identity, capacity, refrigeration type, and availability; number is unique and capacity positive. |
| `users` | User identity, bcrypt password hash, role (`LOGISTICS_MANAGER`, `OPERATIONS_STAFF`, or `ADMIN`), and active flag. Email is unique. |
| `shipments` | Shipment code, supplier, source/destination, vehicle, driver, route, planned/actual delivery times, and status. Foreign keys enforce references; CHECK constraints validate date order and distinct endpoints. |
| `shipment_assignments` | Composite `(shipment_id,user_id)` relation assigns an operational shipment to an operations staff user, with optional assigning user and timestamp. |
| `non_operational_shipments` | Explicit classification of excluded classroom/demo rows without deleting linked records. Exact ID/code pairs are checked by migration 001. |
| `shipment_items` | Many-to-many shipment/product contents with quantity and unit weight; unique product per shipment and positive-value checks. |
| `shipment_status_history` | Status transition log, timestamp, optional actor, and remarks; shipment updates are recorded by `trg_shipment_status_history`. |
| `alerts` | Shipment condition alert, severity, observed/threshold values, and resolution identity/time. |

## Relationships and cardinalities

- A supplier has many products and shipments; each product/shipment references one supplier.
- A route connects exactly one source and destination warehouse; a warehouse can be used in either role by many routes and shipments.
- A shipment references one route, supplier, vehicle, and driver. A vehicle/driver may serve multiple shipments over time; the create API prevents reuse while another operational shipment is active.
- Shipments and products have a many-to-many relationship through `shipment_items`.
- A shipment has many status-history rows and alerts.
- Users have many staff shipment assignments, may create many assignments, and may appear as status/alert actors. App checks roles and staff assignment scope; foreign keys maintain identity references.
- MongoDB `sensor_readings.shipment_id` is an application-enforced reference to MySQL `shipments.shipment_id`; MongoDB cannot enforce a cross-database foreign key.

## Other SQL objects

- `shipment_overview` joins shipment, supplier, warehouse, vehicle, driver, and route details.
- `trg_shipment_status_history` records changed shipment statuses.
- `sp_create_alert` inserts a typed alert row.
- `docs/reports.sql` contains multi-table joins, correlated exclusion subqueries, grouped aggregates, route/month reports, and assignment lookups.
- Shipment creation uses one MySQL transaction for the shipment, shipment items, status history, staff assignments, and driver/vehicle reservation. Temperature checks use a transaction and shipment row lock for alert deduplication.
