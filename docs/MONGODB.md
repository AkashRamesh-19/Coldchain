# MongoDB data model and indexes

MySQL stores normalized logistics entities and enforces cross-table relationships. MongoDB stores timestamped observations whose optional sensor fields vary and historical research windows whose source has 107 columns. Operational readings, research windows, authentication sessions, and import manifests use separate collections.

## `sensor_readings`

One document is one sensor's observation for a shipment and timestamp:

```json
{
  "_id": "operational:<sha256-of-shipment-sensor-timestamp>",
  "shipment_id": 123,
  "sensor_id": "container-probe-1",
  "timestamp": "BSON Date",
  "temperature": 5.2,
  "humidity": 55,
  "latitude": 12.97,
  "longitude": 77.59,
  "battery_level": 88
}
```

`shipment_id` refers to `shipments.shipment_id` in MySQL. MongoDB does not enforce that cross-database reference; API routes check the shipment and the user's assignment before reading or writing. `sensor_id` defaults to `default`; use an explicit sensor ID when a shipment has more than one independent device. Reusing the same shipment, sensor ID, and instant replaces that observation, which makes client retries idempotent.

## `research_strawberry_windows`

Each document preserves the source workbook's 107 column names and values. Blank cells stay `null`; `shipment_id` remains `S1`–`S6`; `Time` remains timezone-free `YYYY-MM-DD HH:mm:ss` text. Import metadata adds `_id`, `dataset_revision`, and the source dataset's shipment ID. The stable key includes dataset ID, shipment ID, and timestamp. A unique `{ dataset_revision: 1, shipment_id: 1, Time: 1 }` index guards the source records. The original workbook is fetched from a pinned Hugging Face revision and SHA-256 validated by the importer; it is not checked into the repository.

Research output uses MongoDB filters and aggregation pipelines. For operational reports, a pipeline groups readings by shipment and computes means, minima, maxima, and nonmissing counts; the API joins those summaries to MySQL routes and evaluates product-specific limits. This preserves each database's role while producing combined reports.

## `research_dataset_imports`

One manifest per source dataset stores its pinned revision, filename, SHA-256, row/column count, source URL, and import time. The API compares the collection count for the pinned revision with the manifest expectation and reports `not_imported`, `incomplete`, or `imported`.

## `user_sessions`

Each login stores a SHA-256 digest of a random 256-bit session token, user ID, creation time, and expiry. The raw token exists only in the HttpOnly `ccg_session` cookie or the login client's memory. A unique token-hash index and TTL index on `expires_at` support lookup and expiry. Passwords remain bcrypt hashes in MySQL. Sessions are revoked on logout, password reset, or account deactivation.

## Index setup

Run `npm run setup:mongodb` after `.env.local` is configured. The setup is additive and idempotently creates:

- `sensor_readings`: `{ shipment_id: 1, timestamp: 1 }` for shipment history queries.
- `research_strawberry_windows`: unique `{ dataset_revision: 1, shipment_id: 1, Time: 1 }` for filtered window scans and duplicate prevention.
- `user_sessions`: unique `{ token_hash: 1 }` and TTL `{ expires_at: 1 }`.

The importer also creates/verifies its research compound index. The setup command does not delete collections or documents.
