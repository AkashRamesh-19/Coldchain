# Project verification results

Historical verification run from the project root on 31 October 2026. No production data was used for write-path tests. Current follow-up checks are recorded below the historical results.

| Check | Result | Notes |
|---|---|---|
| `npm.cmd run test:backend` | PASS — 23 passed, 0 failed, 2 skipped | Integration tests ran against isolated MySQL and MongoDB fixtures. The two API smoke tests were skipped because a live app URL and explicit test bearer token were not configured. Includes the new probe-exposure aggregation assertions. |
| `node --test tests/research-dataset.test.mjs` | PASS — 5 passed, 0 failed | Covers the new spatial exposure index, per-probe excursion rates, and missing-value denominator behavior. |
| `npx.cmd tsc --noEmit` | PASS | No TypeScript diagnostics. |
| `npm.cmd run lint` | PASS | ESLint exited with code 0 and no diagnostics. |
| `npm.cmd run build` | PASS | Next.js 16.4.3 compiled and generated the production route manifest, including the API handlers. |
| `npm.cmd audit --omit=dev` | PASS — 0 vulnerabilities | Production dependencies have no reported advisories. This command omits development dependencies. |
| `npm.cmd audit` | 2 moderate findings | Both arise from the `uuid` advisory in development dependency `exceljs`. npm's suggested forced resolution downgrades `exceljs` to a breaking version; no force fix was applied. The advisory is outside the production dependency set. |

The backend integration suite covers authentication and role-specific login (including admin-created employee login by generated user ID), transactional shipment creation and rollback, catalog validation and foreign-key deletion protection, temperature/humidity alert behavior and deduplication, alert resolution, shipment status history, idempotent sensor ingestion, operational report aggregation, research filtering/aggregation/import idempotency, and demo-record exclusion without deletion. Research unit tests additionally verify the spatial exposure index, excursion ranking by probe position, and missing-value handling. The local sample-data loader was run twice in the earlier verification and reused the same three shipment IDs and six sensor document IDs.

The live-server smoke checks remain opt-in. To run them, start the app with test databases configured and provide the test-only `BACKEND_TEST_URL` and `BACKEND_TEST_BEARER` variables. Do not reuse production credentials or point mutation tests at a production database.

## Follow-up verification — 10 November 2026

| Check | Result | Notes |
|---|---|---|
| `node --test tests/api-smoke.test.mjs tests/catalog-validation.test.mjs tests/login-rate-limit.test.mjs tests/research-dataset.test.mjs tests/schema-source.test.mjs` | PASS — 15 passed, 0 failed, 2 skipped | The two opt-in live-server smoke tests were skipped because a test server URL and bearer token were not configured. Includes the new login-throttle unit tests. |
| `npm run lint` | PASS | ESLint exited with code 0. |
| `npx tsc --noEmit` | PASS | TypeScript exited with code 0 after Next.js route types were generated. |
| `npm run build` | PASS | Next.js 16.4.3 compiled and generated the production route manifest with temporary placeholder database settings; no database was contacted during static generation. |
| `git diff --check` | PASS | No whitespace errors in the pending changes. |
| Write-path integration suite | Not rerun | The recent changes that depend on MySQL and MongoDB need a configured isolated fixture. Prior results above remain the latest database-backed run. |

The follow-up also adds regression assertions for shipment capacity, route endpoint protection, and sensor pagination to the database-backed write-path suite; those assertions are not counted as executed until that suite is run against its isolated MySQL/MongoDB fixtures.

## Known handover work

- Capture final screenshots from the running, configured app for the project demonstration. This verification run used automated API/aggregation tests and build checks, not browser screenshots.
- Login throttling is per-process; a multi-instance deployment should add a shared proxy or datastore limit. MFA and integration with a production identity provider remain outside the current implementation.
