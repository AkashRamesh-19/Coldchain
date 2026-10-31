# ColdChain Guardian

ColdChain Guardian has two separate data areas: operational shipment monitoring and analysis of a published historical strawberry cold-chain dataset. Research rows never become operational shipments, and the research shipment IDs `S1`–`S6` are not mapped to MySQL shipment IDs.

## Data architecture

- **MySQL** stores operational suppliers, warehouses, routes, vehicles, drivers, users, products, shipments, shipment items, status history, and alerts. `shipment_overview` provides the relational shipment summary.
- **MySQL `shipment_assignments`** links operations staff to the shipments they may view and update. Shipment creation is transactional across the shipment, items, assignment, vehicle/driver reservation, and initial status history.
- **MongoDB `sensor_readings`** remains the operational sensor collection. Four known classroom demo shipments are classified in `non_operational_shipments`; their shipment rows, readings, alerts, items, and history are preserved but excluded from operational APIs and dashboard reports. Newly created operational shipments remain visible by default.
- **MongoDB `research_strawberry_windows`** stores every source column from the research workbook, including null values and original shipment IDs and wall-clock timestamps. These are historical research records, not live measurements.
- **MongoDB `research_dataset_imports`** records the imported file revision, hash, shape, and time.
- **MongoDB `user_sessions`** stores only hashed random session tokens with expiration; a TTL index expires old sessions.

The synopsis names PostgreSQL, while the approved Level 3 requirements allow either MySQL or PostgreSQL. This project uses MySQL because its existing tables, trigger, procedure, and data are implemented there; no PostgreSQL claim is made.

See the [editable ER diagram source](docs/ERD.md), [ER diagram image](docs/ER_Diagram.png), [requirements traceability checklist](docs/requirements-traceability.md), and [verification results](docs/test-results.md) for database relationships and project evidence.

## Published research dataset

The source is the [Cold-Chain Transportation Strawberry dataset](https://huggingface.co/datasets/NifferLi/Cold-Chain-Transportation-Strawberry), pinned to repository revision `4f9541d8a20616b3c5fedc7d9fd27a8a0b6701dc`, file `article_release/ALL_benchmark_W60.xlsx`. The dataset card declares the **Apache-2.0** license. The verified file SHA-256 is `d35ec35f55fbe602486b6548c921327de0f1b7b2c8673ecd838dc0e3236d8d36`. It contains one `data` worksheet with 14,398 rows and 107 columns across shipments `S1`–`S6`, including nine probe measurements, processed features, labels, and missing values. The source card describes 10-minute sampling. The importer checks the pinned file hash, expected shape, columns, and shipment identifiers before writing.

The importer preserves the source columns and values, converts blank cells to MongoDB `null`, and stores Excel timestamps as timezone-free `YYYY-MM-DD HH:mm:ss` strings. Each record's `_id` is derived from dataset ID, source shipment ID, and source timestamp; importing again replaces the same records rather than duplicating them. Data is stored separately from operational MongoDB documents.

## Setup and import

Use Node.js 20.19 or newer and MySQL 8+ (the schema uses enforced CHECK constraints). Run `npm install`, copy `.env.example` to `.env.local`, and replace placeholders locally. Keep `.env.local` private; it is ignored by Git. Required values are `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MONGODB_URI`, and `MONGODB_DATABASE`.

For a new empty MySQL database, `database/mysql-schema.sql` initializes the schema. It is not an existing-database migration. For an existing database, inspect and apply `database/migrations/001-exclude-known-demo-shipments.sql` only if its guarded demo classification is appropriate, followed by `database/migrations/002-shipment-assignments.sql`. Migration 002 only creates an assignment table and leaves current records unchanged. Do not apply migration 001 blindly to another installation; verify its IDs and codes first. For a new database with no users, `npm run bootstrap:admin` interactively creates the first administrator with hidden password input. It refuses to run when any account exists.

Run `npm run setup:mongodb` to create operational reading, research uniqueness, and session-expiry indexes. The operation is additive and idempotent. Then run `npm run import:research` to download and verify the pinned historical dataset.

For a clearly labeled classroom scenario only, `npm run seed:samples` idempotently adds three `SAMPLE-CCG-*` shipments and sensor readings to the operational tables/collection so the monitoring workflow has records to display. These are generated examples, not real freight; do not seed a production database. The script does not touch the published strawberry research collection.

The importer writes only `research_strawberry_windows` and `research_dataset_imports`; it does not write to MySQL or operational `sensor_readings`. Start the application with `npm run dev` or `npm run build && npm start`.

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/reports` | GET | Operational shipment counts, alerts, temperature summaries, and shipment overview; excludes classified demo shipments. |
| `/api/shipments` | GET | List operational shipments. |
| `/api/shipments` | POST | Transactionally create a shipment, item rows, optional staff assignments, resource reservation, and initial history. |
| `/api/shipments/{id}` | GET/PATCH | Shipment details and history; allowed status transitions. |
| `/api/shipments/[id]/sensors` | GET/POST | Read or validated, idempotently ingest operational sensor readings. |
| `/api/shipments/[id]/check-temperature` | POST | Compare temperature and available humidity readings with product limits; write deduplicated unresolved alerts. |
| `/api/alerts` | GET | List alerts belonging to operational shipments. |
| `/api/alerts/[id]` | PATCH | Resolve an alert belonging to an operational shipment. |
| `/api/research/strawberry` | GET | Return filtered historical analysis; supports `shipmentId`, `start`, `end`, and an optional min/max temperature threshold pair. |
| `/api/catalog/{suppliers,products,warehouses,vehicles,drivers,routes}` | GET/POST/PATCH/DELETE | Role-protected reference-data management; deletes are restricted to unreferenced rows and admin role. |
| `/api/auth/login`, `/api/auth/logout`, `/api/auth/me` | POST/GET | Bcrypt login, HttpOnly cookie session, logout, current identity. |
| `/api/users` and `/api/users/{id}` | GET/POST/PATCH | Administrator-only account management. Password hashes are never returned. |

See [API contracts](docs/API.md) and [MongoDB model](docs/MONGODB.md) for exact fields, roles, limits, and response examples. Operational endpoints require a session cookie or bearer token. The frontend has employee/admin sign-in, an admin-only employee management page, shipment dashboard, alert resolution page, and research/operational Reports page wired to these APIs.

Research reports include per-shipment window counts, mean `T_mean`, raw-probe statistics and trends, risk/future-label counts, probe-level missingness, and configurable temperature excursions. The Reports page also calculates a transparent **spatial exposure index**: out-of-range probe measurements divided by available probe measurements, with per-position rates and missing-value counts. It uses the selected real research rows and explicitly entered temperature bounds; it is a deterministic rule-based calculation, not an LLM or a prediction. Shipment and timezone-free date/time filters can be combined. If the import is absent or incomplete, the endpoint and page report that state; they do not substitute example values. Operational sections show empty states when no operational records exist.

## Evaluation deliverables

- **ER diagram:** [`docs/ER_Diagram.png`](docs/ER_Diagram.png) and its editable [Mermaid source](docs/ERD.md) show 13 relational tables (more than the five-table minimum), their keys/relationships, and the separate MongoDB collections.
- **RDBMS + NoSQL:** MySQL stores constrained shipment and alert relations; MongoDB stores sensor observations and the independent research windows. See [MongoDB data model](docs/MONGODB.md).
- **Project demo reports:** the authenticated Reports page demonstrates live SQL aggregates (shipment status, monthly shipments, routes and alert resolution) alongside analysis calculated from the imported research collection. The SQL queries are included in [`docs/reports.sql`](docs/reports.sql).
- **Project novelty:** a spatial excursion and completeness profile ranks the nine original strawberry-probe positions by user-bounded excursion rate and shows missing values separately. The formula and source columns are documented in [`docs/ERD.md`](docs/ERD.md) and [`docs/API.md`](docs/API.md); no LLM is used.

## Interpretation

Research features and labels are from the published historical benchmark. They do not represent current freight or live sensor telemetry. Operational readings are evaluated only against MySQL product limits for shipments classified as operational. A shipment sensor is not assigned to an individual shipment item, so an excursion indicates that at least one carried product range was exceeded; it does not establish that a specific product was damaged.

## Verification

- `npm run test:backend` runs backend unit checks and read-only API smoke checks (the smoke test needs the app running and configured databases).
- `npm run test:backend:write` runs write-path integration tests using temporary, isolated MySQL and MongoDB databases; it requires permission to create and drop those temporary databases.
- `npm run lint` runs ESLint.
- `npm run build` creates a production build.

The SQL deliverables demonstrate normalized related tables, primary/foreign/unique/check constraints, views, a status-history trigger, an alert procedure, transactions in shipment creation, filtered multi-table reports, GROUP BY/aggregates, a correlated non-operational exclusion, and indexed lookups. MongoDB uses flexible operational observation documents, a pinned research document model, aggregation pipelines, and explicit indexes.

The system accepts simulated sensor input through the authenticated sensor API; it does not require physical sensors, GPS infrastructure, live freight integrations, an LLM, or predictive ML. The application includes role-specific sign-in, an admin employee-management page, an alert-resolution page, and separate operational and research reporting. Assignment-level operation access is enforced for operational APIs. Rate limiting, multi-factor authentication, and production identity integration remain hardening work.

Research unit tests verify source IDs and timestamps, stable idempotency keys, source null handling, record counts, label counts, and aggregation results. The research importer writes only its dedicated collection and manifest. It does not seed operational data.
