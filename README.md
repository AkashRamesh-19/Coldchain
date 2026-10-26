# ColdChain Guardian

ColdChain Guardian has two separate data areas: operational shipment monitoring and analysis of a published historical strawberry cold-chain dataset. Research rows never become operational shipments, and the research shipment IDs `S1`–`S6` are not mapped to MySQL shipment IDs.

## Data architecture

- **MySQL** stores operational suppliers, warehouses, routes, vehicles, drivers, users, products, shipments, shipment items, status history, and alerts. `shipment_overview` provides the relational shipment summary.
- **MongoDB `sensor_readings`** remains the operational sensor collection. Four known classroom demo shipments are classified in `non_operational_shipments`; their shipment rows, readings, alerts, items, and history are preserved but excluded from operational APIs and dashboard reports. Newly created operational shipments remain visible by default.
- **MongoDB `research_strawberry_windows`** stores every source column from the research workbook, including null values and original shipment IDs and wall-clock timestamps. These are historical research records, not live measurements.
- **MongoDB `research_dataset_imports`** records the imported file revision, hash, shape, and time.

See [the ER diagram](docs/ERD.md) for the relational tables and relationships.

## Published research dataset

The source is the [Cold-Chain Transportation Strawberry dataset](https://huggingface.co/datasets/NifferLi/Cold-Chain-Transportation-Strawberry), pinned to repository revision `4f9541d8a20616b3c5fedc7d9fd27a8a0b6701dc`, file `article_release/ALL_benchmark_W60.xlsx`. The dataset card declares the **Apache-2.0** license. The verified file SHA-256 is `d35ec35f55fbe602486b6548c921327de0f1b7b2c8673ecd838dc0e3236d8d36`. It contains one `data` worksheet with 14,398 rows and 107 columns across shipments `S1`–`S6`, including nine probe measurements, processed features, labels, and missing values. The source card describes 10-minute sampling. The importer checks the pinned file hash, expected shape, columns, and shipment identifiers before writing.

The importer preserves the source columns and values, converts blank cells to MongoDB `null`, and stores Excel timestamps as timezone-free `YYYY-MM-DD HH:mm:ss` strings. Each record's `_id` is derived from dataset ID, source shipment ID, and source timestamp; importing again replaces the same records rather than duplicating them. Data is stored separately from operational MongoDB documents.

## Setup and import

Use Node.js 20.19 or newer, run `npm install`, and create `.env.local` with your local MySQL and MongoDB configuration. Keep `.env.local` private; it is ignored by Git. The values required are `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MONGODB_URI`, and `MONGODB_DATABASE`.

For a new empty MySQL database, `database/mysql-schema.sql` initializes the schema. It is not an existing-database migration. For the inspected development database, apply `database/migrations/001-exclude-known-demo-shipments.sql` once. This additive migration only creates the classification table and tags the four exact audited ID/code pairs; it does not delete records. Review the IDs and codes against your target database before applying it to a different installation.

Run `npm run import:research` to download, verify, and import the pinned workbook into `research_strawberry_windows`. The script does not write to MySQL or `sensor_readings`. Start the dashboard with `npm run dev`.

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/reports` | GET | Operational shipment counts, alerts, temperature summaries, and shipment overview; excludes classified demo shipments. |
| `/api/shipments` | GET | List operational shipments. |
| `/api/shipments/[id]` | PATCH | Update status for an operational shipment. |
| `/api/shipments/[id]/sensors` | GET | Read operational MongoDB sensor readings for an operational shipment. |
| `/api/shipments/[id]/check-temperature` | POST | Compare operational readings with product limits and write deduplicated unresolved alerts. |
| `/api/alerts` | GET | List alerts belonging to operational shipments. |
| `/api/alerts/[id]` | PATCH | Resolve an alert belonging to an operational shipment. |
| `/api/research/strawberry` | GET | Return dynamic counts and aggregates from the imported research collection. |

Research analyses include per-shipment window counts, mean `T_mean`, risk label counts, missing risk labels, missing values for each probe, future `y_next_120_R2` label counts, and the stored time range. If the import is absent or incomplete, the endpoint and dashboard report that state; they do not substitute example values. Operational sections show empty states when no operational records exist.

## Interpretation

Research features and labels are from the published historical benchmark. They do not represent current freight or live sensor telemetry. Operational readings are evaluated only against MySQL product limits for shipments classified as operational. A shipment sensor is not assigned to an individual shipment item, so an excursion indicates that at least one carried product range was exceeded; it does not establish that a specific product was damaged.

## Verification

- `npm run test:backend` runs backend unit checks and read-only API smoke checks (the smoke test needs the app running and configured databases).
- `npm run test:backend:write` runs write-path integration tests using temporary, isolated MySQL and MongoDB databases; it requires permission to create and drop those temporary databases.
- `npm run lint` runs ESLint.
- `npm run build` creates a production build.

Research unit tests verify source IDs and timestamps, stable idempotency keys, source null handling, record counts, label counts, and aggregation results. The research importer writes only its dedicated collection and manifest. It does not seed operational data.
