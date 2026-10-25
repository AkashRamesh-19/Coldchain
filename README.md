# ColdChain Guardian

ColdChain Guardian is a classroom cold-chain monitoring demo. MySQL stores the structured shipment domain and MongoDB stores timestamped shipment sensor readings. The dashboard combines both sources to show shipment reports and run a product-range temperature check.

## Architecture

- **MySQL** stores suppliers, warehouses, routes, vehicles, drivers, users, products and temperature limits, shipments, shipment items, shipment status history, and alerts. The `shipment_overview` view joins the main shipment and route records.
- **MongoDB** stores timestamped documents in `sensor_readings`. Each document has a `shipment_id` that links it to a relational shipment. The current demo contains 12 readings across four shipments.
- **The dashboard** reads the report endpoint. The temperature check compares each shipment reading with the distinct product ranges listed on that shipment and creates at most one unresolved alert for each product, direction, and permitted range.

See [the ER diagram](docs/ERD.md) for primary keys, declared foreign keys, relationships, and the view boundary.

## Setup

Use Node.js 20.19 or newer (the installed MongoDB driver requires it), install dependencies with `npm install`, and create a local `.env.local` file with these variable names:

```text
MYSQL_HOST=
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=
MONGODB_URI=
MONGODB_DATABASE=
```

Fill values from your own local database setup. `.env.local` is ignored by Git. The database must already contain the schema and view described in `docs/ERD.md`; this project does not currently include a schema migration or a seed script. Start the app with `npm run dev` and open <http://localhost:3000>.

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/reports` | GET | Shipment averages, temperature excursion counts, unresolved alerts by severity, shipment counts by status, and the joined shipment overview. |
| `/api/shipments` | GET | List rows from `shipment_overview`. |
| `/api/shipments/[id]` | PATCH | Update shipment status; the installed MySQL trigger writes status history. |
| `/api/shipments/[id]/sensors` | GET | Read timestamped MongoDB readings for a shipment. |
| `/api/shipments/[id]/check-temperature` | POST | Compare MongoDB readings to MySQL product limits and create deduplicated unresolved temperature alerts. This endpoint writes alerts. |
| `/api/alerts` | GET | List shipment alerts. |
| `/api/alerts/[id]` | PATCH | Resolve an alert. |
| `/api/db-test` | GET | Check MySQL connectivity and table count. |
| `/api/mongo-test` | GET | Check MongoDB connectivity and reading count. |

The report SQL examples are in [docs/reports.sql](docs/reports.sql). `/api/reports` returns averages and excursion counts with units and field names. Example results from the inspected local demo data:

| Shipment ID | Average recorded temperature | Readings | Excursion readings | Out-of-range product comparisons |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 4.65 °C | 4 | 0 | 0 |
| 2 | 6.97 °C | 3 | 1 | 1 |
| 3 | 3.57 °C | 3 | 1 | 1 |
| 4 | 4.15 °C | 2 | 0 | 0 |

Other inspected report results: unresolved alerts are `MEDIUM: 2`; shipment status counts are `DELIVERED: 1`, `DELAYED: 2`, `IN_TRANSIT: 1`.

## Data and interpretation

The existing MongoDB readings were described as simulated demo data and are not live hardware measurements. The source field is not present in the inspected sensor document shape, so the application labels them as demo/simulated rather than making a hardware claim.

The reading is linked to a shipment, not to a particular shipment item or product. For an excursion report, one timestamp counts once if it falls outside at least one carried product’s limits; `outOfRangeProductComparisons` separately counts each reading-to-product-range comparison that was outside the range. This is a conservative shipment-level comparison, not evidence that the specific product itself reached that temperature. The checker uses the same documented comparison and records the product, direction, product limit, measured temperature and limit in its alert fields/message. It serializes checks for the same shipment to avoid duplicate unresolved alerts on concurrent requests. There is no database unique constraint, so administrators should treat this as application-level idempotency.

## Project contribution

The concrete contribution is an explainable workflow that reads product-specific allowed ranges from MySQL, compares them with timestamped shipment readings in MongoDB, identifies out-of-range readings, and records deduplicated unresolved alerts against the relational shipment. This combines product metadata, two storage models, timestamped observations, and alert lifecycle handling instead of applying one global hard-coded temperature threshold.

This is a project implementation contribution, not a claim that the general idea is unprecedented or scientifically novel. Limits include the simulated readings, no per-item sensor assignment, a simple fixed severity rule, no alert audit trail for each reading, and no real hardware ingestion pipeline.

## Dataset review

`C:\Users\sudha\Downloads\ALL_benchmark_W60.xlsx` was accessible during project inspection. It has one sheet (`data`), 14,398 data rows, and 107 columns. Its columns include nine spatial readings (`Front_*`, `Middle_*`, `Rear_*`), derived W60/v4 features, data quality and guardrail fields, risk labels, and future-risk labels. The workbook encodes time as Excel dates and temperatures as numeric Celsius-like values, but its workbook does not provide unit annotations in the headers. The Hugging Face dataset card documents the processed benchmark, sampling and columns and lists an Apache-2.0 license; the associated paper describes the strawberry cold-chain dataset. Links: [Hugging Face dataset card](https://huggingface.co/datasets/NifferLi/Cold-Chain-Transportation-Strawberry), [associated paper](https://arxiv.org/abs/2103.12895).

The research workbook is not loaded into either operational database. Its shipment identifiers (for example `S1`) and 10-minute research windows do not match the local demo shipment IDs or the existing readings. Keeping it separate avoids silently relabeling research observations as local shipment or simulated data. It can be discussed as a future offline analysis dataset, with its source, transformations, and labels kept explicit.

## Demo sequence

1. Start with `npm run dev` and open the dashboard at `http://localhost:3000`.
2. Point out the shipment overview and explain that it comes from the MySQL `shipment_overview` view.
3. Show the average temperatures and excursion counts. Say MongoDB supplies timestamped readings and MySQL supplies each shipment’s product ranges; an excursion is counted once per reading if any carried range is exceeded.
4. Show the unresolved alert and shipment status summaries, then open `/api/reports` to show the JSON response and explicit data note.
5. Open `/api/shipments/1/sensors` (or another displayed ID) to show the shipment ID joining MongoDB readings to MySQL shipments.
6. If you want to demonstrate alert creation, click **Check temperatures** for a shipment. This POST can write an alert; show the result message and refresh the unresolved alert report. Resolve it through the alert PATCH route if your lecturer asks to see that lifecycle.
7. Open [docs/ERD.md](docs/ERD.md) and walk through the shipment, shipment item, product, supplier, alert and status history relationships.

## Viva questions

- **Why both MySQL and MongoDB?** MySQL enforces structured entities, keys, and relationships; MongoDB stores timestamped sensor observations naturally by shipment.
- **How are the databases connected?** A numeric `shipment_id` in each MongoDB reading corresponds to `shipments.shipment_id` in MySQL. The application combines the records; there is no cross-database foreign key.
- **What is the project-specific contribution?** It brings product-specific limits from relational data together with shipment sensor time series to identify and deduplicate excursion alerts.
- **Can a reading be assigned to one product?** No. The current schema links the sensor reading only to a shipment, so the report compares it to all distinct product ranges and documents this limitation.
- **Are these hardware readings?** No. The existing samples are demo readings described as simulated; there is no verified live sensor source.
- **What does an excursion count mean?** One shipment reading outside at least one carried product range. It is not a count of actual damaged products.
- **Is the approach unprecedented?** No such claim is made; it is a practical, explainable integration built for this project.

## Checks

The project scripts are `npm run lint` and `npm run build`. Run these after dependencies and local database configuration are ready. The report GET route is read-only; status changes, alert resolution, and temperature checks can write to MySQL.
