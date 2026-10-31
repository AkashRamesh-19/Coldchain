# Backend API contract

All JSON errors use `{ "success": false, "message": "..." }`. IDs are positive integers. Operational routes require an authenticated session unless noted. Successful operational responses read from the configured database and never provide fixture fallback values.

## Authentication and user administration

| Method and path | Access | Request | Successful response |
| --- | --- | --- | --- |
| `POST /api/auth/login` | Public | `{ "email": "...", "password": "..." }` | `{ success, user: { user_id, full_name, email, role }, expiresInSeconds }`; sets an HttpOnly `ccg_session` cookie. |
| `POST /api/auth/admin/login` | Public | `{ "email" or "employeeId", "password" }` | Same session response; accepts only the `ADMIN` role. |
| `POST /api/auth/employee/login` | Public | `{ "email" or "employeeId", "password" }` | Same session response; accepts employee roles only. |
| `POST /api/auth/logout` | Public | Empty JSON | `{ success, message }`; revokes the current session and clears its cookie. |
| `GET /api/auth/me` | Authenticated | None | `{ success, user: { user_id, full_name, email, role } }`. |
| `GET /api/users` | Admin | None | `{ success, count, users }`; never returns password hashes. |
| `POST /api/users` | Admin | `{ full_name, email, password, role }` | `201 { success, user }`; password must be at least 12 characters and is stored as bcrypt. The returned `user_id` is the employee ID used at employee sign-in. |
| `PATCH /api/users/{id}` | Admin | Any of `full_name`, `email`, `password`, `role`, `is_active` | `{ success, user }`; password reset or deactivation revokes sessions. |

Roles are `ADMIN`, `LOGISTICS_MANAGER`, and `OPERATIONS_STAFF`. Managers/admins maintain the catalog and create shipments. Operations staff can see and update only shipments assigned through `shipment_assignments`, and can record readings or run condition checks for those shipments. Only managers/admins resolve alerts. All operational reads require a session. Research dataset analysis is public because it uses published historical data only.

The session cookie contains a cryptographically random token; MongoDB stores its SHA-256 hash and expiration, with a TTL index. Login compares the existing bcrypt password hashes. There is no default account or password in source code.

## Shipment operations

| Method and path | Access | Request / response |
| --- | --- | --- |
| `GET /api/shipments` | Authenticated | `{ success, count, shipments }`; operations staff receive assigned shipments only. |
| `GET /api/shipments/{id}` | Authenticated | `{ success, shipment, items, statusHistory }`; 404 for missing, excluded, or unassigned shipment. |
| `POST /api/shipments` | Manager/admin | JSON fields: `shipment_code`, `supplier_id`, `source_warehouse_id`, `destination_warehouse_id`, `vehicle_id`, `driver_id`, `route_id`, `shipment_date`, `expected_delivery` (`YYYY-MM-DD HH:mm:ss`), `items: [{ product_id, quantity, unit_weight_kg }]`, optional `assigned_user_ids`. Returns `201 { success, shipmentId, shipmentCode, status, itemCount }`. Shipment, items, assignment, resource reservation, and initial history are committed in one transaction. |
| `PATCH /api/shipments/{id}` | Authenticated; operations staff only when assigned | `{ "status": "IN_TRANSIT" }` (or another allowed transition). Returns previous/current status; the DB trigger appends history. Delivered/cancelled shipments release their driver and vehicle when no other active shipment uses them. |

Allowed status transitions: `CREATED` to `IN_TRANSIT`, `DELAYED`, or `CANCELLED`; `IN_TRANSIT` to `DELAYED`, `DELIVERED`, or `CANCELLED`; `DELAYED` to `IN_TRANSIT`, `DELIVERED`, or `CANCELLED`. `DELIVERED` and `CANCELLED` are terminal. Repeating the current status is idempotent.

## Sensor readings and alerts

| Method and path | Access | Request / response |
| --- | --- | --- |
| `GET /api/shipments/{id}/sensors` | Authenticated; staff assignment enforced | `{ success, shipmentId, count, readings }`, ordered by timestamp. |
| `POST /api/shipments/{id}/sensors` | Authenticated; staff assignment enforced | One reading object or `{ "readings": [ ... ] }`, maximum 500. Each reading requires a timezone-qualified ISO-8601 `timestamp` and at least one of `temperature` (-100..100 °C), `humidity` (0..100%), `latitude` (-90..90), `longitude` (-180..180), or `battery_level` (0..100). Optional `sensor_id` identifies the sensor. Returns `{ success, shipmentId, submitted, inserted, updated }`. Shipment/sensor/timestamp makes ingestion idempotent; a repeated key replaces that reading. |
| `POST /api/shipments/{id}/check-temperature` | Authenticated; staff assignment enforced | Empty JSON. Evaluates each reading against each carried product's temperature limits and, when both bounds exist, humidity limits. Returns `{ success, shipmentId, readingsChecked, excursionReadingCount, outOfRangeProductComparisons, alertsCreated, alerts }`. Open alerts are deduplicated by shipment, condition, product, and direction. Temperature severity is HIGH beyond a 2 °C margin; humidity severity is HIGH beyond a 10 percentage-point margin; smaller excursions are MEDIUM. |
| `GET /api/alerts` | Authenticated; staff assignment enforced | `{ success, count, alerts }`. |
| `PATCH /api/alerts/{id}` | Manager/admin | Optional `{ "resolved_by": userId }`. Returns success for a newly resolved or already-resolved alert. |

Mongo operational readings remain separate from research windows. Temperatures are compared with product ranges, and humidity is compared only when both product humidity limits are defined. Sensor observations attach to the shipment, not a specific shipment item; an excursion therefore means at least one product range was exceeded.

## Catalog management

The allowlisted catalog resources are `suppliers`, `products`, `warehouses`, `vehicles`, `drivers`, and `routes`.

- `GET /api/catalog/{resource}` — manager/admin; returns `{ success, count, items }` (up to 1,000 rows).
- `POST /api/catalog/{resource}` — manager/admin; inserts an allowlisted JSON record and returns `201 { success, id }`.
- `PATCH /api/catalog/{resource}/{id}` — manager/admin; updates only allowlisted fields.
- `DELETE /api/catalog/{resource}/{id}` — admin; referenced records are protected by foreign keys and return 409 rather than cascading away operational records.

## Operational reports

`GET /api/reports` requires an authenticated session and returns database-derived fields:

```json
{
  "success": true,
  "dataNote": "...",
  "temperatureByShipment": [{ "shipmentId": 1, "averageTemperatureC": 5.2, "readingsCounted": 12, "excursionReadingCount": 1, "outOfRangeProductComparisons": 1, "productRangesCompared": [] }],
  "sensorMetricsByShipment": [{ "_id": 1, "readings": 12, "temperatureMeanC": 5.2, "humidityMeanPercent": 55 }],
  "unresolvedAlertsBySeverity": [{ "severity": "MEDIUM", "unresolved_count": 1 }],
  "alertTotals": { "total_alerts": 1, "unresolved_alerts": 1, "resolved_alerts": 0 },
  "shipmentCountsByStatus": [{ "status": "IN_TRANSIT", "shipment_count": 1 }],
  "shipmentOverview": [],
  "shipmentsByRoute": [{ "route_id": 1, "route_name": "...", "shipment_count": 1, "average_delay_hours": null, "averageTemperatureC": 5.2, "averageHumidityPercent": 55 }],
  "monthlyShipments": [{ "month": "2030-01", "shipment_count": 1, "delivered_shipments": 0, "active_shipments": 1 }]
}
```

SQL computes relational totals, shipment status, route alerts, route shipment counts, delay, and month counts. MongoDB aggregation computes per-shipment sensor statistics; Mongo readings are compared with the MySQL product ranges for excursions. Missing delay values remain `null` when there is no late delivered shipment.

## Historical research analysis

`GET /api/research/strawberry` is public and reads only `research_strawberry_windows` at the pinned source revision. Optional query parameters can be combined:

- `shipmentId=S1` through `S6`
- `start=YYYY-MM-DD` or timezone-free local `YYYY-MM-DD HH:mm[:ss]`
- `end=YYYY-MM-DD` or the same local date/time format
- `minTemperatureC={number}&maxTemperatureC={number}` (provide both to enable explicit threshold excursions)

The response contains `filters`, dataset provenance/import status, and `analysis`: selected `rowCount`, per-source-shipment counts, source `T_mean`, raw-probe means/min/max and per-probe statistics, daily raw-probe temperature trend, optional excursion window/probe counts, risk and future-label counts, missing probe/label values, and the actual returned timestamp range. Source timestamps are timezone-free wall-clock text and are compared lexically in that original format; no timezone conversion is applied. Invalid dates, unsupported shipment IDs, reversed intervals, invalid thresholds, and half-specified thresholds return 400. An empty selection returns 200 with zero rows and a null actual range.

Research risk labels and future target labels remain published research fields; they are never treated as current operational alerts.
