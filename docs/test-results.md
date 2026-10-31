# Project verification results

Verification run from the project root on 31 October 2026. No production data was used for write-path tests.

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

## Known handover work

- Capture final screenshots from the running, configured app for the project demonstration. This verification run used automated API/aggregation tests and build checks, not browser screenshots.
- Rate limiting, MFA, and integration with a production identity provider are outside the current implementation.
