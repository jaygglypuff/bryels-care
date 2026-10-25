# Testing strategy and acceptance procedures

Owner: `qa-test-engineer`. Accountable: `principal-architect`. Consulted: `security-engineer`.
Status: Phase 0 draft for Gate 0. Binding ADRs: ADR-006 (ledgers), ADR-012 (test stack),
ADR-013 (tooling, CI), ADR-018 (offline). Related: `docs/PRD.md` (acceptance criteria AC-10 to
AC-23, Slice 1 tests S1-01 to S1-15, NFRs), `docs/permissions-matrix.md` section 8 (mandatory
negative tests), `docs/security.md` section 2 (threat-model test names resolve here),
`docs/process-maps.md` section 1.5 (validation catalogue `V-*`) and 1.3 (exceptions `CX-*`),
`docs/data-model.md` sections 4, 5, 8.1 and 11.4 (batch snapshot, ledger, audit names,
idempotency), `docs/offline-sync.md` section 9, `docs/data-migration-plan.md` section 11
(MC-01 to MC-16), `docs/reports-and-templates.md` section 12 (T-01 to T-18).

Plain-language summary for owners: nothing in this project is called "done" because a screen
exists or because someone says it works. Every rule the brief cares about (one site cannot see
another, stock can never be edited after posting, expired material cannot reach a batch, a
checker is never the same person as the operator, a shipment cannot exceed what was allocated)
has a named automated test that tries to break it on every code change. This document lists
those tests, the devices we test on, the data we test with, and the step-by-step procedures the
owner's staff will run at each gate. Assumptions are marked `A-TST-nn` and need confirmation.

---

## 1. Test strategy and definition of done

### 1.1 Principles

| # | Principle | What it means in practice |
|---|---|---|
| 1 | Evidence before claims | A feature is "tested" only when the test commands have been run, the output has been read and the result is reported verbatim (including failures). A report that says "tests should pass" is rejected. |
| 2 | Test the invariant, not the screen | Business invariants (section 4) are proven at the service layer on a real PostgreSQL database; the UI is tested for the vertical slice, not for every rule. |
| 3 | Negative tests are mandatory | Every module ships the authorization negative set (section 5) before its first screen is merged. A missing negative test fails the `authz-coverage` CI check. |
| 4 | Test-driven | The failing test is written first for every command, validation and state transition. Pull requests show the test in the same change as the code. |
| 5 | Never green by omission | No `.skip`, `.only`, `.todo` or quarantine list reaches `main` (section 10). A flaky test is a bug with an owner and a deadline. |
| 6 | Real dependencies where the risk is | Integration tests use real Postgres (locks, triggers, constraints, `numeric`). Mocks are allowed only for external providers (email, payment, storage signing) behind their adapters. |
| 7 | Same inputs, same results | Tests control time, ids and random values explicitly (section 3.6). A test that depends on wall-clock time or insertion order is rejected in review. |
| 8 | Plain-language acceptance | Gate procedures (section 9) are written so the owner's staff can execute them on the company's devices without an engineer. |

### 1.2 Definition of done for a slice (team charter working agreement 2)

A slice is done when all of the following exist in the same change and CI is green:

1. Data model with migration, constraints and indexes (`docs/data-model.md` updated).
2. Permission strings from the catalogue in every command; the negative set of section 5 for every new entity.
3. Zod schemas (`.strict()`) and the integration tests for every `V-*` validation the process map cites for the slice's steps.
4. State machine transition table with `statemachine.*` tests (section 4.17).
5. Audit events named `module.entity.event` exactly as in `docs/data-model.md` section 8.1 (typed list in `src/lib/audit.ts`; the `docs/security.md` section 5 catalogue is re-keyed to those names), asserted by `audit.*` tests.
6. Loading / empty / error / permission-denied / offline states (`docs/ux-system.md` section 6) covered by the slice's e2e test on desktop and at 360 px.
7. Documentation updated (`docs/*.md`, README commands, environment variables).
8. Deployment notes (migration order, new variables, rollback) in the slice report.
9. The slice report (completed, tested, not completed, known risks, commands run, migrations, variables, next steps) with the verbatim output of `pnpm test`, `pnpm test:integration`, `pnpm test:e2e` and `pnpm lint && pnpm typecheck`.

### 1.3 Evidence rules

| Evidence | Required form |
|---|---|
| Automated test result | CI run URL plus commit SHA, or the full terminal output pasted into the slice report. Partial output ("…") is not evidence. |
| Failure | Reported verbatim: test id, assertion message, stack. Never summarised as "minor". |
| Manual acceptance (section 9) | A sign-off record per AC per gate: date, tester name and role, device (section 7 row id), app version (git SHA and migration version), result per step, screenshots or PDF attached. Stored under `docs/acceptance/<phase>/` at the gate (created at G1). |
| Performance (section 11) | The generated report file (Lighthouse JSON, k6 summary) committed with the gate report; thresholds compared by the CI job, not by eye. |
| Device check | Photo or screen recording of the phone screen plus the printed label or document where printing is involved. |

Test ids are dotted names `area.subject.case` (for example `ledger.reversal.links_original`).
The id is the `describe`/`it` title in code and the file is `tests/<layer>/<area>/<subject>.test.ts`,
so `grep -r "ledger.reversal.links_original" tests/` finds the test from any document. Names
used in `docs/security.md` section 2 and `docs/permissions-matrix.md` section 8 are catalogued in
sections 4 to 6 and must exist in code with exactly those ids.

---

## 2. Test pyramid and tooling (ADR-012, ADR-013)

| Layer | Tool | Scope | Database | Runs on PR | Share of tests (target) |
|---|---|---|---|---|---|
| Unit | Vitest (`vitest.config.ts`, project `unit`) | Pure logic: state machines, UOM conversion, FEFO/FIFO selection, tolerance checks, availability formula, numbering pattern formatter, scan payload grammar, approval-rule matcher, `neutralizeCell()`, KPI formulas, attendance pairing rules (rule values are inputs, never constants) | none | yes | 50 % |
| Integration | Vitest (project `integration`) | Every command and query through the module public surface with a real `AuthContext`; constraints, triggers, locks, idempotency, audit; authorization negative set; jobs | real PostgreSQL 16 (CI service container; locally Docker) | yes | 40 % |
| End-to-end | Playwright (`playwright.config.ts`) | Each vertical slice as a user would run it, on `desktop-chromium` (1280 × 800) and `mobile-360` (360 × 640, touch, 3× DPR); scanner simulation; print preview and PDF checks | real PostgreSQL seeded with the fictional data set, app built in production mode | smoke set on PR; full set nightly and before each gate | 10 % |
| Manual acceptance | Section 9 procedures on the company's devices | Gate sign-off, printers, scanners, camera decoding on real hardware | staging | at each gate | — |

### 2.1 Scanner simulation

| Mode | How the test drives it | Where it runs |
|---|---|---|
| Keyboard wedge | `scanWedge(page, 'BC:LOT:L-2610-00042')`: focuses the quiet scan input, types the payload with ≤ 10 ms inter-key delay, presses `Enter` (and `Tab` variant, A-TST-03). Also a "slow human typing" variant to prove the input does not misfire mid-entry. | PR CI, both viewports |
| Camera, injected detections | `page.addInitScript` installs a `BarcodeDetector` shim with a `window.__bcScanQueue`; the test pushes `{rawValue, format}` and the app's detector loop consumes it. Proves the scan-result card, duplicate-scan guard (2 s window) and allowed-actions rendering without a real decoder. | PR CI, `mobile-360` |
| Camera, injected frames | Chromium launched with `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=tests/e2e/assets/qr/<payload>.y4m`; the real `BarcodeDetector`/ZXing path decodes the frame. Assets are generated from the label renderer at build time so the printed QR and the decoded QR are the same artefact. | nightly, project `mobile-360-camera` (A-TST-10) |
| Real hardware | Section 9 procedures with the company's scanner, phones and label printer. | gates G2, G4, G7 |

### 2.2 Print and PDF checks

| Check | Tool | Assertion |
|---|---|---|
| Print preview | Playwright `page.emulateMedia({ media: 'print' })` + `toHaveScreenshot()` per template at A4 and at each label size | Visual diff ≤ 0.1 % pixels against the committed baseline; shell, nav and buttons absent; `thead` repeats |
| Generated PDF | Worker renders the fixture record with a fixed clock; `pdf-parse` extracts text per page | Page count; batch/order/shipment identifier on every page; `Page x of y`; template version and checksum in footer; signature blocks present; status watermark (`DRAFT`, `CONTROLLED COPY`, `REPRINT n`) |
| PDF visual | `pdftoppm` page 1 → PNG, pixel diff | ≤ 0.5 % difference against baseline (fonts embedded) |
| Label QR round trip | Render label PNG → decode with ZXing in Node | Decoded payload equals `BC:<TYPE>:<CODE>` and matches the grammar `^BC:(LOT\|BOX\|LOC\|MAT\|SKU\|EQP\|DOC):[A-Z0-9][A-Z0-9._-]{0,63}$` (ADR-017, `docs/data-model.md` 9.5); quiet zone ≥ 2 mm at the declared print DPI |
| Reprint control | Integration test on `generated_documents` | `reprint_of_id` set, reason required (check constraint), audit `documents.generated_document.reprinted` |

---

## 3. Test infrastructure design

### 3.1 Repository layout

```
tests/
  kit/                     shared test kit (no business rules)
    global-setup.ts        creates the template database (migrate + base seed)
    setup-db.ts            per-worker database from the template; truncation helper
    auth.ts                asUser(role, siteIds), asSystem(), expectDenied(), expectHidden()
    factories/             one builder per entity, fictional data, unique codes
    clock.ts               FixedClock, advance()
    concurrency.ts         runConcurrently(), barrier()
    idempotency.ts         replay(), replayConcurrent()
    http.ts                typed client for /api/v1 with cookie jar, Idempotency-Key, Origin
    pdf.ts                 extractPages(), decodeQr()
  unit/<area>/             pure logic
  integration/<module>/    service and repository tests
  integration/authz/       <module>.<case>.test.ts (section 5)
  integration/security/    names from docs/security.md section 2
  e2e/
    flows/<slice>/         one spec per vertical slice
    states/                page-state checks (loading, empty, error, denied, offline)
    assets/qr/             generated y4m/png scan fixtures
    .auth/                 storageState per role (generated, git-ignored)
```

### 3.2 Database lifecycle

```mermaid
flowchart LR
  A["globalSetup: TEST_DATABASE_URL"] --> B["DROP/CREATE bc_test_template"]
  B --> C[pnpm db:migrate against template]
  C --> D["base seed: org, sites NFD/RVS, roles, permissions, users per role, UOMs, locations, reason codes, numbering rules, settings"]
  D --> E["per worker N: CREATE DATABASE bc_test_wN TEMPLATE bc_test_template"]
  E --> F["per test file: TRUNCATE operational tables, keep base seed"]
  F --> G["per test: factories create only what the test needs, unique codes"]
  G --> H["globalTeardown: drop worker databases"]
```

| Decision | Choice | Why |
|---|---|---|
| Isolation between workers | One database per Vitest worker, cloned from a template (`CREATE DATABASE … TEMPLATE`) | Cloning takes well under a second on Postgres 16; workers never share rows; migrations run once |
| Isolation between tests | Truncate operational tables per test file (`TRUNCATE … RESTART IDENTITY CASCADE` on every table not in the base-seed allow-list); unique codes per test inside a file | Concurrency and idempotency tests need committed state visible from several connections, which a transactional rollback cannot provide |
| Transactional rollback | Opt-in `withRollback(fn)` for single-connection repository tests only | Faster for pure query tests; never used for commands that lock or commit |
| Database roles | Service calls run on a pool connected as `bc_app` (DML only, no `UPDATE`/`DELETE` on ledger and audit tables); setup, truncation and trigger assertions use `bc_test_admin` | Grants and `forbid_mutation()` triggers are part of what is tested |
| Extensions | `btree_gist`, `pgcrypto` created by migration `0000_extensions_and_functions` (`docs/data-model.md` 13.6); CI image `postgres:16` | Same as Railway (ADR-002) |
| Local | `docker compose -f docker/compose.test.yml up -d` exposes port 5433; `TEST_DATABASE_URL=postgres://bc_test:bc_test@localhost:5433/postgres` (A-TST-07) | No shared dev database for tests |
| CI | GitHub Actions service container `postgres:16` with health check; same `TEST_DATABASE_URL` | ADR-012 |

`vitest.config.ts` (workspace): project `unit` (`tests/unit/**`, `src/**/*.test.ts`, no setup
files), project `integration` (`tests/integration/**`, `globalSetup`, `setupFiles`,
`pool: 'forks'`, `fileParallelism: true`, `maxWorkers: min(4, cpus)`, `testTimeout: 20_000`,
`hookTimeout: 60_000`, `sequence.concurrent: false`, `retry: 0`). Coverage: `@vitest/coverage-v8`
with thresholds on `src/modules/**` (lines 85 %, branches 80 %) and 100 % on
`src/lib/state-machine.ts`, `src/lib/quantity.ts`, `src/lib/money.ts`, `src/lib/idempotency.ts`.

### 3.3 Factories and fixtures

- Factories are builders that take the test `ctx` and return persisted rows, for example
  `lot({ site: 'NFD', material: 'RM-COCONUT-OIL', qty: '5000', status: 'released', expiry: '2027-03-31' })`.
  Every factory defaults every required field, generates unique codes (`uniq('LOT')`) and uses
  names from the fictional list (section 8). Factories call module commands where a ledger is
  involved (a lot with stock is created through `postMovement`, never by inserting balances).
- `asUser(role, siteIds)` builds a real session row and `AuthContext` for a seeded user of that
  role at the given sites; `asUser('warehouse_operator', ['NFD'])` is the canonical "NFD
  operator". `asOrgWide('owner_director')` for the three organization-wide roles.
  `withReauth(ctx)` sets `reauthenticated_at = now` for restricted actions; `withoutReauth(ctx)`
  sets it 11 minutes ago.
- `expectDenied(result, 403, 'PERMISSION_DENIED')`, `expectHidden(result)` (404 `NOT_FOUND`),
  `expectSod(result)` (409 `SEPARATION_OF_DUTIES`), `expectState(result)` (409),
  `expectValidation(result, 'field.path')` (422), `expectAudit({ action, entityId, outcome })`.
- The Acapulco Soap reference formula (five lines, 17,600 g; tolerances are fictional
  placeholders, `A-PRD-18`) is a named fixture `fixtures.acapulcoSoap()` used by production,
  BMR and PDF tests so that the numbers in the document match the BMR photo exactly.

### 3.4 Concurrency harness

`runConcurrently({ n, barrier: true }, i => command(ctxFor(i), input(i)))`:

1. Acquires `n` connections from a dedicated test pool (size ≥ `n`, separate from the service pool).
2. Each participant prepares its call, then awaits a shared barrier so all `n` commands start
   in the same event-loop tick.
3. Returns `{ ok: Result[], err: Result[] }` plus the elapsed time.
4. For deterministic interleavings the service exposes a test-only seam
   `__testHooks.afterLock(async () => …)` (compiled out in production) that lets a test hold the
   lot lock while a second command arrives, proving `SELECT … FOR UPDATE` serialisation and
   the retry-on-`serialization_failure` path (`src/lib/db.ts`, 3 attempts).
5. Postgres `log_lock_waits` and `deadlock_timeout = 200ms` are set on the test database so a
   deadlock fails fast and is reported verbatim.

### 3.5 Idempotency harness

`replay(command, { key, body })` runs the command twice sequentially and asserts one ledger row
and byte-identical responses; `replayConcurrent(command, { key, body, n: 5 })` fires five copies
through the barrier and asserts exactly one `completed` row in `idempotency_keys`, one ledger
row, and five identical responses. `replayMutated(command, { key, body, mutate })` asserts 422
`IDEMPOTENCY_KEY_REUSED`. The HTTP variant sends the `Idempotency-Key` header through
`tests/kit/http.ts`; the sync variant posts to `/api/v1/sync/commands` (Phase 7).

### 3.6 Time, ids and randomness

| Concern | Rule |
|---|---|
| Server time | Services receive a `Clock` (`src/lib/clock.ts`: `now()`, `today(timeZone)`); tests inject `FixedClock('2026-10-16T02:00:00Z')` and `advance('P1D')`. The clock is on the command dependencies, not on `AuthContext`. |
| Database "today" | SQL that depends on the current date (availability, expiry job, effective-date lookup) takes an `$as_of` parameter supplied from the clock; tests never rely on `CURRENT_DATE` (`docs/data-model.md` 5.3 and every date-dependent query take `$as_of`; Q-TST-05 closed). |
| Expiry job | `jobs.expiry.run({ asOf })` is invoked directly by tests; no cron in tests. |
| Client time (e2e) | `page.clock.install({ time })` and `page.clock.setSystemTime()` for clock-skew tests (section 6). |
| Ids | UUIDv7 generation accepts an injected clock and random source in tests so ordering assertions are stable; natural numbers come from the real numbering rules. |
| Randomness | Property-style tests (`fast-check`) use a fixed seed printed in the failure output; the seed is pinned in the test when a failure is reproduced. |

### 3.7 Playwright configuration

| Setting | Value |
|---|---|
| Projects | `desktop-chromium` (Desktop Chrome, 1280 × 800); `mobile-360` (Chromium, 360 × 640, `deviceScaleFactor: 3`, `isMobile`, `hasTouch`); `tablet-768` (768 × 1024, nightly); `mobile-webkit` (WebKit, iPhone SE profile 375 × 667, nightly, A-TST-02); `mobile-360-camera` (fake video capture, nightly) |
| Web server | `pnpm build && pnpm start` with `APP_ENV=test`, `DATABASE_URL` of the e2e database seeded by `pnpm db:seed --profile e2e`; `reuseExistingServer` locally |
| Auth | `global-setup` signs in once per role and stores `storageState` in `tests/e2e/.auth/<role>.json`; tests pick a role with `test.use({ storageState: auth('warehouse_operator.nfd') })` |
| Permissions | `permissions: ['camera']` for scan specs; `geolocation` never granted |
| Artefacts | `trace: 'retain-on-failure'`, `video: 'retain-on-failure'`, `screenshot: 'only-on-failure'`; uploaded as CI artefacts |
| Retries | `retries: 0` locally; `1` in CI with the retry reported as a flake (section 10) |
| Workers | `2` in CI; tests create their own records through the API so parallel specs do not collide |
| Assertions on state | Every flow spec ends with an API query (`/api/v1/...`) asserting the ledger or record state, not only the toast |
| Accessibility | `@axe-core/playwright` on every page visited by a flow spec; violations of `serious`/`critical` fail the test |

---

## 4. Critical business invariants with named tests

Each row is one or more integration tests (unless marked U = unit, E = e2e). Expected error
codes follow `docs/architecture.md` section 5 and `docs/permissions-matrix.md` section 1.

### 4.1 Ledger immutability (ADR-006)

| Test id | Proves | Expected |
|---|---|---|
| `ledger.immutable.update_rejected` | `UPDATE stock_movements` / `production_postings` / `financial_postings` / `dispositions` / `audit_events` as `bc_app` and as `bc_test_admin` | Permission denied for `bc_app`; trigger `forbid_mutation()` raises `integrity_constraint_violation` for the admin |
| `ledger.immutable.delete_rejected` | `DELETE` on the same tables | Same |
| `ledger.immutable.no_service_path` | No module exports a function that updates a ledger row (static check over `src/modules/**/repositories`) | Lint rule `no-ledger-mutation` passes |
| `ledger.projection.updated_in_transaction` | A posting that fails after the ledger insert (injected failure) leaves no ledger row and no balance change | Both absent after rollback |
| `ledger.projection.matches_ledger` | 500 random postings (receipt, transfer, consumption, output, shipment, reversal) across two sites | Reconciliation query of `docs/data-model.md` 5.6 returns zero rows; `container_contents` reconciles |
| `audit.same_transaction` | Audit row for a failed command | Absent (rolled back with the command) |

### 4.2 Reversal pattern

| Test id | Proves | Expected |
|---|---|---|
| `ledger.reversal.links_original` | `inventory.movement.void` on a posted transfer | New row `movement_type = 'reversal'`, `reversal_of_id` = original, reason and actor set; original row byte-identical; balances back to pre-posting; audit `inventory.stock_movement.reversed` |
| `ledger.reversal.twice_rejected` | Second reversal of the same movement | 409; partial unique index on `reversal_of_id` holds |
| `ledger.reversal.replacement_correlated` | Reversal + replacement | Replacement carries the reversal's `correlation_id`; the three rows list together |
| `ledger.reversal.revalidated` | Reversal when the stock has since moved | 409 (would go negative); nothing written |
| `ledger.reversal.undo_window` | Actor's own scan-move undone inside `settings.ux.undo_window_seconds` (US-2-28) with idempotency key `undo:<movement_id>` | One linked `reversal` row with reason `undo_by_actor`; original untouched; a repeated tap returns the stored result; after the window elapses, or for another user or session, 409 and nothing written |
| `ledger.reversal.undo_refused_after_later_movement` | Undo attempted after a later movement, reservation, allocation, count line or status change on the same lot, box or location | 409 with the reason; no row written or edited; response offers the reversal request path (`inventory.movement.void`) |
| `ledger.reversal.receipt_with_lot` | `procurement.goods_receipt.void` | Lot remains (never deleted), balance zero, lot flagged in UI; audit `procurement.goods_receipt.reversed` |
| `finance.reversal.locked_period` (P6) | Reversal in a locked `accounting_periods` row | 409; audit absent |

### 4.3 No negative stock (A-PRD-17, A-DM-02)

| Test id | Proves | Expected |
|---|---|---|
| `stock.negative.rejected` | Issue 10 g from a balance of 5 g | 409 `STOCK_INSUFFICIENT`; no row |
| `stock.negative.reserved_counts` | Issue 5 g where on_hand 5 g, reserved 3 g | 409 (on_hand − reserved − allocated ≥ qty) |
| `stock.negative.check_constraint` | Direct `UPDATE inventory_balances SET on_hand_base = -1` as admin | `ck` violation |
| `stock.negative.no_policy_exception` | Any actor, including `owner_director` and `system_admin` holding every inventory permission, posts an issue, consumption or shipment that would take `on_hand_base` below zero; any site setting attempting to allow negative stock; a direct SQL update as `bc_test_admin` setting a negative balance | 409 `STOCK_INSUFFICIENT`; nothing written; no permission string or setting changes the outcome (the catalogue has no negative-balance permission, `docs/permissions-matrix.md` §3.3); the direct SQL update fails on the `inventory_balances` CHECK. Architect ruling (2026-10-16): balances never go negative in Phases 1 to 9, the ADR-006 "configured policy" exception is withdrawn and the `inventory_balances` CHECK has no bypass; allowing it would need a new ADR |

### 4.4 FEFO / FIFO selection (A-PRD-16)

| Test id | Proves | Expected |
|---|---|---|
| `fefo.selects_earliest_expiry` (U) | Candidates with expiry dates | Earliest expiry first; tie-break by `manufacture_date`, then `created_at`, then `lot_number` |
| `fefo.excludes_blocked` (U) | Candidates include `quarantine`, `on_hold`, `expired`, `recalled`, `rejected` | Excluded with a per-lot reason the UI can show |
| `fefo.min_shelf_life_customer` (U) | Customer requirement "≥ 90 days at delivery" | Lots expiring sooner excluded |
| `fifo.when_no_expiry` (U) | Material class without expiry | Oldest `received_at` first |
| `fefo.rule_per_class_and_customer` | Allocation rule configured per material class/SKU/customer | Configured rule applied; default rule otherwise |
| `fefo.recommendation_matches_allocation` | Recommendation shown on the lot card equals what `inventory.allocation.create` would pick | Equal |
| `fefo.expired_between_allocation_and_dispatch` | Lot expires after allocation | Dispatch (`sales.shipment.post`) re-checks and rejects (V-EXP) |

### 4.5 Held / expired / recalled / rejected stock is blocked (V-EXP, V-REC, V-HOLD, CX-LOT)

Matrix test `stock.blocked.matrix`: status × action, where action ∈ {`inventory.movement.post`
transfer to a released-stock bin, `inventory.allocation.create`, `sales.pick.create` scan,
`production.dispense_record.create`, `sales.shipment.post`}.

| Status | Normal flow | With `inventory.held_stock_issue.approve` + reason (qa_qc) | Named test |
|---|---|---|---|
| `quarantine` | 409 `STOCK_NOT_ELIGIBLE` | sampling/rework issue allowed; never allocation or shipment | `stock.blocked.quarantine` |
| `on_hold` | 409 | as above | `stock.blocked.on_hold` |
| `rejected` | 409 | 409 (never) | `stock.blocked.rejected_never` |
| `expired` (status or `expiry_date <= as_of`) | 409 | 409 (never) | `stock.blocked.expired_never` |
| `recalled` | 409 | move to recall location only | `stock.blocked.recalled_location_only` |

Plus `stock.blocked.location_class` (quarantined lot into a released bin → V-LOC 409),
`stock.blocked.status_reread_at_scan` (status changed between page load and post → 409),
`disposition.only_path_to_released` (no command other than `quality.disposition.approve`
changes `inventory_lots.quality_status`; `inventory.lot.edit` with a status field → 422),
`expiry_job.sets_expired` (job with `asOf` after expiry → status `expired`, disposition row
`expire` by the system actor, balance re-keyed), `hold.blocks_all_named_scope`
(`quality.hold.create` on a location blocks every lot in it).

### 4.6 Tolerance checks (V-TOL, CX-TOL)

| Test id | Proves | Expected |
|---|---|---|
| `tolerance.absolute_and_percent` (U) | Rule "±2 % or ±1 g, whichever is stricter" on 190.9 g | Low/high bounds computed with `decimal.js`; 189.9 inside, 189.8 outside |
| `tolerance.boundary_inclusive` (U) | Actual exactly on the bound | Inside (bounds inclusive; `ck low <= target <= high`) |
| `dispense.tolerance.within` | 3,723.2 g target ±1 %, actual 3,700.0 g | `is_within_tolerance = true`; audit `production.dispense_record.recorded` |
| `dispense.tolerance.outside_rejected` | Actual 3,650.0 g | 409 `OUT_OF_TOLERANCE`; no `dispense_records` row; re-weigh allowed |
| `dispense.tolerance.exception_requires_permission` | Same with `production.over_tolerance_dispense.approve` held by the operator | 409 (approver must be a different user, online, with reason) |
| `dispense.tolerance.exception_approved_creates_deviation` | qa_qc approves with reason | Row saved with `exception_approved_by`, `deviation_id` set, audit `production.dispense_record.over_tolerance_approved` (restricted) |
| `process.parameter_outside_limits` | Reading outside `routing_step_parameters` limits | `is_within_limits = false`; step cannot complete without CX-TOL |

### 4.7 Operator ≠ checker (V-SOD)

| Test id | Proves | Expected |
|---|---|---|
| `sod.dispense.checker_not_operator` | Same user dispenses and checks | 409 `SEPARATION_OF_DUTIES`; `ck checked_by <> dispensed_by` holds under direct SQL |
| `sod.step.checker_not_performer` | `process_step_records` | 409 |
| `sod.line_clearance.checker_not_conductor` | `production.line_clearance.approve` by the conductor | 409 |
| `sod.pack.checker_not_packer` | `packs` and `containers` | 409 |
| `sod.count.recounter_not_counter` | `stock_count_lines` recount | 409 |
| `sod.results.reviewer_not_tester` | `quality.inspection.approve` by the user who entered results | 409 |
| `sod.disposition.decider_not_result_entry` | `quality.disposition.approve` by the result entry user | 409 |
| `sod.same_session_cannot_check` (E) | Checker confirms on the operator's session | Server rejects; UI requires the checker's own sign-in |
| `sod.two_roles_no_escape` | One user holding two roles at the site | 409 (user id compared, not role) |

### 4.8 Batch revision snapshot (`docs/data-model.md` 4.4)

| Test id | Proves | Expected |
|---|---|---|
| `batch.snapshot.frozen_at_creation` | Batch created from a work order | `formula_revision_id`, `routing_revision_id`, `bmr_template_version_id`, `inspection_plan_id` copied; `bom_snapshot` lines equal scaled BOM with tolerances; one `process_step_records` row per routing step |
| `batch.snapshot.scales_to_batch_size` | Batch size 8,800 g from a 17,600 g formula | Proportional lines halved exactly (`decimal.js`), fixed lines unchanged; sum reported unrounded |
| `batch.snapshot.later_revision_no_effect` | New formula revision approved after batch creation | Batch rows unchanged; BMR render identical to the pre-revision render (text diff empty) |
| `batch.snapshot.trigger_freezes` | `UPDATE batches SET formula_revision_id` after `planned` | Trigger `tg_batches_freeze_revisions` raises |
| `batch.snapshot.no_effective_revision` | Work order planned on a date with no approved revision | 422 (V-REV); batch cannot be created |
| `batch.snapshot.renderer_reads_snapshot_only` | Static check: BMR renderer imports no live formula query | Lint rule passes |
| `batch.snapshot.reopen_keeps_revisions` | Controlled reopen (`production.batch.admin`) | Revisions unchanged; `reopen_count + 1`; BMR revision n+1; audit `production.batch.reopened` |

### 4.9 Over-shipment block and shipment posting = stock issue (V-OVER, CX-SHIP)

| Test id | Proves | Expected |
|---|---|---|
| `shipment.over_allocated_rejected` | Pack 11 boxes against an allocation of 10 | 409 `OVER_SHIPMENT`; nothing written |
| `shipment.over_ordered_rejected` | Allocation 12, ordered 10 | 409 at pack verification |
| `shipment.over_with_approval` | `sales.over_shipment.approve` by site_manager (≠ order creator) with reason and customer reference | Allowed; `over_shipment_approved_by` set; audit `sales.shipment.over_shipment_approved` (restricted) |
| `shipment.draft_no_stock_change` | Shipment in `draft`, `picked`, `packed`; DR generated | No `stock_movements` row; balances unchanged |
| `shipment.dispatch_posts_issue` | `sales.shipment.post` | One `shipment` movement per shipment line, `stock_movement_id` set, containers `shipped`, allocations and reservations fulfilled, DR number allocated, all in one transaction; audit `sales.shipment.dispatched` |
| `shipment.reconciles` | After dispatch | Σ `shipment_lines.qty_base` = Σ movements with `source_document_id = shipment.id`; `sales_order_lines.qty_shipped_base` updated; availability reduced by exactly that quantity |
| `shipment.dispatch_rechecks_status` | Allocated lot put `on_hold` before dispatch | 409; nothing posted |
| `shipment.partial_allowed_unless_customer_full` | Customer requirement "full shipment required" | 409 (CX-SHIP) when partial; allowed otherwise (A-PRD-24) |
| `shipment.reverse_returns_stock` | `sales.shipment.void` | Reversal movements; containers back to `sealed`; order state per machine |

### 4.10 Numbering uniqueness under concurrency (ADR-009)

| Test id | Proves | Expected |
|---|---|---|
| `numbering.unique_under_concurrency` | 20 concurrent postings requesting `GR-{YY}-{SEQ}` (`sequence_width` 5, organization scope; S1-13) | 20 distinct consecutive numbers; no gaps for non-gapless rules only if all commit |
| `numbering.locked_last` | Lock order keys → lots → balances → numbering rule | No deadlock over 200 randomized interleavings (`concurrency.deadlock_free`) |
| `numbering.rollback_no_consume_gapless` | Invoice numbering (`A-DM-05`) with a failed transaction | Next invoice reuses the number (gapless); stock movement numbers may gap (documented) |
| `numbering.reset_period` | Rule with yearly reset across a year boundary (clock injected) | Sequence restarts; uniqueness per `(organization_id, number)` still holds |
| `numbering.per_site_prefix` | Same rule type at NFD and RVS (site scope, pattern with `{SITE}`) | Independent sequences, distinct prefixes |
| `numbering.change_not_retroactive` | `platform.numbering_rule.admin` edits a rule | Existing numbers untouched; new version effective forward; audit `platform.numbering_rule.changed` |

### 4.11 Idempotent replay (`docs/data-model.md` 11.4, `docs/security.md` 4.10)

| Test id | Proves | Expected |
|---|---|---|
| `idempotency.replay_returns_original` | Same key, same body, sequential | One ledger row; identical response; second call performs no lock |
| `idempotency.concurrent_duplicates_single_row` | Same key, 5 concurrent | One `completed` key row; one ledger row; all responses identical |
| `idempotency.same_key_different_body_422` | Same key, mutated body | 422 `IDEMPOTENCY_KEY_REUSED` |
| `idempotency.ledger_partial_unique_backstop` | Bypass layer 1 (test seam) and insert twice with the same key | Partial unique index on `stock_movements (organization_id, idempotency_key)` rejects |
| `idempotency.key_required_on_postings` | Posting without `Idempotency-Key` | 422 |
| `idempotency.scoped_per_organization` | Same key sent by a second user of the same organization (`docs/data-model.md` 11.4) | 422 `IDEMPOTENCY_KEY_REUSED`; keys are unique per `(organization_id, key)`; no second posting |
| `idempotency.expired_key_reused` | Key older than 7 days (A-SEC-21) | Treated as new |
| `authz.idempotency.duplicate_key` | Alias used by the permissions matrix; runs the three cases above through HTTP | As above |

### 4.12 UOM dimension validity (ADR-010, S1-12)

| Test id | Proves | Expected |
|---|---|---|
| `uom.dimension_mismatch_rejected` (U+I) | `g → mL` conversion without material density | 422 `UOM_DIMENSION_MISMATCH` |
| `uom.density_requires_material` | `g → mL` with density on a material | Accepted, versioned, material-specific |
| `uom.mass_to_mass_exact` (U) | `kg → g`, `g → kg` round trip of `0.1` | Exact (`decimal.js`), no float drift |
| `uom.entered_and_base_stored` | Movement entered as `2.5 kg` | `qty_entered = 2.5`, `uom_entered = kg`, `qty_base = 2500`, `uom_base = g` |
| `uom.unknown_conversion_blocks` | Purchase UOM with no conversion | 422 (V-UOM) |

### 4.13 Decimal precision (ADR-010, A-PRD-29)

| Test id | Proves | Expected |
|---|---|---|
| `decimal.no_float_in_modules` | ESLint rule: no `parseFloat`, `Number()` on quantities/money, no arithmetic on `number` typed as quantity | Lint passes |
| `decimal.schema_rejects_float_forms` | Zod decimal schema given `1e3`, `NaN`, `0.1+0.2`, 7 decimals | 422 (`validation.decimal_only`) |
| `decimal.sum_unrounded_display_rounded` (U) | Acapulco lines 3,723.2 + 8,687.4 + 4,964.2 + 190.9 + 34.4 | Stored sum `17600.1`; displayed to the UOM precision; printed total per template setting; the comparison "sum = batch size" uses the configured rounding, never float equality |
| `decimal.scale_enforced` | Insert `numeric(18,6)` with more decimals | Rejected at validation (not silently rounded by Postgres) |
| `money.rounding_per_currency` (U) | PHP 2 decimals at presentation, 4 in storage | Totals computed from unrounded lines |

### 4.14 Concurrent stock posting (brief: no double issue)

| Test id | Proves | Expected |
|---|---|---|
| `concurrency.double_issue_prevented` | Balance 10; two concurrent issues of 8 | Exactly one `ok`, one 409; balance 2; one ledger row |
| `concurrency.transfer_and_consume_same_lot` | Transfer out and batch consumption of the same lot/location concurrently | Serialized; sums reconcile |
| `concurrency.deadlock_free` | 200 randomized multi-lot postings across 8 connections (property test) | No `deadlock_detected`; retries ≤ 3; reconciliation zero rows |
| `concurrency.batch_step_posted_once` | Two operators post the same step | `batches` row lock; second gets 409 (V-STATE) |
| `concurrency.count_freeze_blocks_posting` | Movement in a frozen location | 409 (V-FREEZE) |

### 4.15 Availability formula

`availability.formula` (U+I): for a lot set covering every status, reserved and allocated
quantities, and an expiry on the as-of date, the SQL of `docs/data-model.md` 5.3 and the pure
function return the same numbers and `available = on_hand − reserved − allocated − quarantined − on_hold − expired − recalled − rejected`;
`availability.site_scoped`: an RVS balance never contributes to an NFD query.
`production.plan_line_creates_work_order_with_reservations` (I, P5, US-5-15): converting a
production plan line creates exactly one `work_orders` row with `production_plan_line_id` set;
releasing it creates FEFO `stock_reservations` that reduce `available` by the reserved
quantity; nothing is created without the planner's action.

### 4.16 Containers, counts, genealogy

| Test id | Proves | Expected |
|---|---|---|
| `container.lineage.split` | Split 100 → 60 + 40 | Two `container_lineage` rows, parent content 0 or reduced, children inherit lot and status, movements carry `container_id` |
| `container.lineage.merge_status_mismatch` | Merge `released` with `on_hold` box | 409 |
| `container.repack_preserves_history` | Repack then trace | Lineage path from original box to final box resolvable |
| `count.original_retained` | Recount after count | Both quantities and both counters stored; variance from final |
| `count.adjustment_links_count` | Posted variance | `adjustment` movement with `source_document_type = 'stock_count'`; reason required |
| `genealogy.forward_and_backward` | Supplier lot → receipt → batch → output lot → box → shipment → customer | Both directions complete; cross-site rows hidden for site users |

### 4.17 State machines and audit

| Test id | Proves | Expected |
|---|---|---|
| `statemachine.table_complete` (U) | Every state in each of the ten machines of `docs/data-model.md` section 6 (batch, work order, PO, SO, inspection, quality hold, shipment, payroll period, invoice, equipment) is reachable and terminal states have no exits | Snapshot of the transition table reviewed in PR |
| `statemachine.illegal_transition_rejected` | Each illegal pair per machine | 409 `STATE`; no `*_state_transitions` row |
| `statemachine.reason_required_backward` | Cancel, reopen, reject without reason | 422 |
| `statemachine.transition_row_written` | Legal transition | Row with actor, from/to, correlation id, same transaction |
| `statemachine.no_free_status` | Zod schemas with a `status` field on update commands | Rejected (`.strict()`), alias of the security.md name |
| `help.guide_versioned` (P2) | Edit and publish of a `help_guides` entry (US-2-27) | Each edit inserts a new draft version (`platform.help_guide.updated`); publishing by the author is refused (409 `SEPARATION_OF_DUTIES`); a second holder of `platform.help_guide.admin` publishes (`platform.help_guide.published`); earlier versions stay readable; a user without the permission gets 403 |
| `audit.required_fields` | Every mutating command | Audit row has actor, action, entity, site, request id, outcome; redaction applied |
| `audit.emitted_for_catalogue` | Each event the slice's stories name, spelled as in `docs/data-model.md` section 8.1 and present in the typed list of `src/lib/audit.ts`; every name matches the `audit_events.action` CHECK | Present with the data class stated |

---

## 5. Mandatory negative authorization tests per module

Every module directory `tests/integration/authz/<module>.<case>.test.ts` contains the cases of
`docs/permissions-matrix.md` section 8 (names reproduced exactly). The `authz-coverage` CI
check reads the permission catalogue from code and fails when any permission string of a
merged module lacks a test tagged with it (`@perm inventory.movement.post`).

### 5.1 Common set (all modules, all phases)

| Test id | Driven through | Expected |
|---|---|---|
| `authz.cross_site.url` | `GET /api/v1/<module>/<entity>/<id>` for an RVS record as NFD user; page route too | 404 `NOT_FOUND`; response body has no entity fields; audit `identity.authorization.denied` (`outcome = 'denied'`) |
| `authz.cross_site.body` | `POST` with `siteId` RVS or a parent id of RVS | 404 or 422 `SITE_NOT_ALLOWED`; row count unchanged |
| `authz.cross_site.query` | `?siteId=RVS`, filters matching RVS rows, search/autocomplete (`authz.cross_site.search`) | NFD rows only; totals exclude RVS |
| `authz.cross_site.export` | CSV/XLSX/PDF export with RVS filter | NFD rows only; `platform.export.created` audit records filters and row count |
| `authz.cross_site.site_switcher` | `activeSiteId` cookie/header set to RVS | Ignored; scope unchanged |
| `authz.cross_site.scan` | `BC:LOT` of an RVS lot scanned at NFD | "not found at your site"; no fields leak |
| `authz.role_escalation.missing_permission` | Each role × each mutating permission it does not hold (generated from the matrix) | 403 `PERMISSION_DENIED`; audit `identity.authorization.denied` |
| `authz.role_escalation.restricted_without_reauth` | R permission, `reauthenticated_at` 11 min old | 401 `REAUTH_REQUIRED` |
| `authz.role_escalation.custom_role_sensitivity` | Custom role gains an R permission | Rejected unless `identity.role.admin` + re-auth; audit `identity.role.updated` |
| `identity.no_self_grant` | User with `identity.site_assignment.admin` grants own user a role | 403 |
| `authz.sod.approve_own` | Submitter approves; second approver repeats | 409 `SEPARATION_OF_DUTIES` |
| `authz.sod.poster_equals_approver_above_threshold` | Finance (P6) | 409 |
| `authz.threshold.rule_evaluation` | Amounts around each default rule (A-PM-15) | Correct step list; escalation after the configured delay (clock injected) |
| `authz.session.revoked` | Admin revoke, password change, deactivation | 401 `SESSION_REVOKED` on the next request; replay rejected |
| `authz.session.permissions_changed` | Role removed mid-session | Denied after `permissions_version` bump (≤ 60 s cache, A-PM-01) |
| `authz.sensitive_fields.masked` | Each masked field group per role in API, page and export | Field absent; `_masked` hint present |
| `authz.audit.emitted` | Each S/R action | Audit row; no secrets in payload |
| `authz.ui.not_a_control` (E) | Hidden button invoked via direct `POST` from the page context | Server denies; UI shows the denied state |

### 5.2 Module-specific additions

| Module | Additional negative tests | Phase |
|---|---|---|
| identity | `identity.deactivated_denied_every_request`, `identity.org_wide_only_three_roles` (assignment with `site_id = NULL` for `site_manager` → 422 and `ck` violation), `identity.site_manager_cannot_grant` (A-PM-12) | 1 |
| masterdata | `masterdata.restricted_to_sites_hidden` (A-PM-11), `masterdata.formula_percentages_hidden_from_operator` (A-PM-16), `masterdata.revision_child_edit_after_draft_rejected` (trigger `tg_<child>_parent_draft`) | 1, 3 |
| inventory | `authz.exception.held_stock_issue` (matrix 4.5), `inventory.adjustment_post_requires_approval`, `inventory.lot_edit_cannot_change_status`, `inventory.intersite_transfer_needs_both_sites`, `inventory.operator_movement_types` (A-PM-06 `role_movement_types`), `authz.subscope.warehouse_write` (assignment scoped to warehouse W1: a write at a W2 location of the same site → 404 `NOT_FOUND`, nothing written; W1 succeeds; US-2-29) | 2 |
| procurement | `procurement.receipt_void_requires_void_permission`, `procurement.discrepancy_approve_not_receiver`, `procurement.asl_blocks_line` (V-ASL), `procurement.po_prices_hidden_from_warehouse` | 2, 6 |
| production | `authz.exception.over_tolerance`, `production.material_substitution_requires_approver` (wrong material never: `production.wrong_material_never_allowed`), `production.equipment_override_requires_approver` (V-CAL), `production.reopen_requires_two_approvals` (A-PM-07), `production.batch_post_requires_post_permission` | 3 |
| quality | `quality.disposition_only_qa` (owner_director denied, A-PM-08), `quality.conditional_release_two_qa_users`, `quality.hold_lift_not_creator`, `quality.test_result_void_appends` (original row untouched), `quality.recall_two_approvals` (recall cases, Phase 6) | 2, 3, 6 |
| documents | `documents.signed_url_expires`, `documents.signed_url_user_bound`, `documents.qr_requires_auth`, `documents.reprint_requires_reason`, `documents.generated_scoped_by_source_record` | 2, 3 |
| sales | `authz.exception.over_shipment`, `sales.pricing_masked_on_pick_pack_dr` (documents never show prices), `sales.order_site_of_fulfilment`, `sales.credit_terms_masked`, `sales.cancel_after_dispatch_rejected` (V-STATE) | 4 |
| hr | `hr.personal_data_requires_restricted_view`, `hr.personal_data_view_audited`, `hr.employee_export_excludes_ids_and_bank`, `hr.attendance_correction_not_self`, `hr.payroll_export_requires_reauth`, `hr.site_manager_directory_only` | 5, 6 |
| finance | `finance.post_requires_reauth_and_totp`, `finance.period_unlock_two_approvals`, `finance.cost_fields_masked` (`finance.cost.view`), `finance.journal_entry_dormant` (ADR-020: 404 unless GL approved) | 2, 6 |
| analytics | `analytics.owner_dashboard_filters_to_allowed_sites` (site_manager with two sites compares those two only), `analytics.export_row_masking`, `reports.recipient_recheck` | 5 |
| platform | `settings.versioned`, `platform.settings_admin_restricted`, `diagnostics.no_secrets`, `jobs.context_rebuilt`, `jobs.revoked_user_report_skipped`, `jobs.payload_validated`, `jobs.dead_letter`, `platform.read_only_mode_blocks_writes` (P2: with `platform.maintenance.read_only` enabled, every mutating command from a role outside the allow-list is refused before any write; reads, sign-in and health endpoints work), `platform.read_only_mode_allow_list` (P2: allow-listed roles write normally; toggling writes `platform.setting.changed`), `platform.sync_conflict_resolve_requires_approve` (P7) | 1, 2, 7 |
| portal (P8) | `authz.portal.tenant_isolation`, `portal.auth.lockout`, `portal.ratelimit`, `webhook.signature_invalid_rejected`, `webhook.replay_ignored`, `webhook.redirect_not_trusted`, `webhook.amount_mismatch_flagged`, `payments.no_card_fields`, `payments.refund_audit` | 8 |

### 5.3 Security controls (names from `docs/security.md` section 2, `tests/integration/security/`)

`auth.lockout.after_n_failures`, `auth.ratelimit.login_ip`, `auth.error.generic`,
`auth.enumeration.reset`, `auth.enumeration.login_timing` (response time variance < 50 ms
between unknown user and wrong password, 50 samples), `auth.reset.single_use`,
`auth.reset.expiry`, `auth.reset.revokes_sessions`, `auth.reset.token_bound`,
`auth.lifecycle.deactivated_denied`, `audit.auth_events`, `session.cookie.attributes`
(`__Host-bc_session; HttpOnly; Secure; SameSite=Lax; Path=/`), `session.rotate_on_login`,
`session.idle_expiry`, `audit.session_in_events`, `jobs.session_purge`,
`csrf.origin_mismatch_rejected`, `csrf.form_token_required`, `validation.strict_schema`,
`validation.decimal_only`, `errors.no_stack_in_response`, `api.pagination_enforced`,
`headers.hsts`, `headers.csp`, `scan.payload_grammar`, `scan.rejects_url`,
`label.payload_minimal`, `scan.ratelimit`, `upload.rejects_mismatch`,
`upload.reencodes_image`, `upload.size_cap`, `upload.exif_stripped`, `files.no_direct_access`,
`upload.av_quarantine` (P9), `import.rejects_macro`, `import.values_only`,
`export.formula_neutralized` (unit, every prefix character `= + - @ \t \r`),
`import.duplicates_flagged`, `import.requires_approval`, `import.row_cap`, `audit.import_events`,
`documents.reprint_audit`, `documents.hash_recorded`, `audit.document_events`,
`jobs.pdf_queue_limit`, `audit.job_actor`, `offline.*` (section 6), `audit.admin_events`.
Each runs in the phase the security document assigns and is referenced by id in the gate report.

---

## 6. Offline tests (Phase 7; API groundwork Phase 2)

All e2e, project `mobile-360`, registered device fixture, warehouse_operator at NFD unless
stated. Connectivity is driven with `context.setOffline(true)` and, for partial connectivity,
`page.route('**/api/v1/**', route => delay(35_000))` (requests time out). State assertions
query the server through `tests/kit/http.ts` after reconnection. Server-side counterparts run as
integration tests against `POST /api/v1/sync/commands`.

| Test id | Scenario (from `docs/offline-sync.md` section 9) | Expected |
|---|---|---|
| `offline.airplane_mid_workflow` | Scan box, go offline before confirming destination, confirm | Command in outbox with `Sync Pending` chip and banner "Saved on this device. 1 change will sync…"; after `setOffline(false)` the move is posted once; chip clears |
| `offline.tab_closed_pending` | Queue 3 moves offline, close the tab, reopen | Outbox persisted in IndexedDB; 3 pending shown; sync once online |
| `offline.app_restart` | Queue, kill the browser context, new context with same storage | Same as above; `sync_log` shows one flush |
| `offline.time_skew_flagged` | `page.clock.setSystemTime(now + 20 min)`, queue a dispense capture, sync | Server stores `clientCreatedAt`, sets `posted_at` to server time, flags skew > threshold (A-OFF-05: 10 minutes; `docs/security.md` adopts the same value) on the record and in the `platform.sync_command.replay_accepted` audit; not rejected |
| `offline.duplicate_scan_same_box` | Scan the same box twice for the same move offline | UI asks "Already scanned. Scan it again?"; forcing it yields one command (same idempotency key); server posts once |
| `offline.partial_connectivity` | Requests time out during flush | Outbox retries with backoff; no duplicate posting (`idempotency.concurrent_duplicates_single_row` via HTTP); status `syncing` → `synced` |
| `offline.replay_after_lost_response` | Server applies the batch but the response is dropped (route abort after request) | Client resends; server returns stored results; one ledger row per command |
| `offline.expired_session` | Session expires while offline | New offline commands blocked ("sign in to continue"); existing queue retained; after sign-in the queue flushes; replay from the old session id rejected (`offline.replay.revoked_session`) |
| `offline.permission_revoked_while_offline` | Admin removes `inventory.movement.post` while the device is offline | On reconnect `PERMISSIONS_CHANGED`; queued moves are rejected to the conflict list; nothing posted |
| `offline.auth_snapshot_too_old` | Offline authorization snapshot older than 12 h with no server round trip (A-OFF-02; distinct from the 8 h online permission refresh in `docs/security.md`, which `authz.session.permissions_changed` covers) | New offline commands blocked until reconnect; queued commands retained |
| `offline.online_only_rejected` | Craft a `quality.disposition.approve` command in the outbox | Server rejects (`offline.online_only_rejected`); UI never offers the action offline ("Needs a connection: QA release is online-only") |
| `offline.replay.revalidated` | Move of a lot that was put `on_hold` by QA while offline | Command rejected (V-HOLD); `sync_conflicts` row; device shows the conflict; nothing posted |
| `offline.conflict_queued` and `offline.conflict_resolved_each_way` | site_manager resolves: re-apply with corrected data, discard with reason, escalate to adjustment | Re-apply creates a new audited command; discard audited `platform.sync_conflict.resolved`; original never applied silently |
| `offline.dependency_failed` | Second move of the same box after a rejected first move | Marked `conflict: dependency_failed`; independent commands still apply |
| `offline.dispense_capture_rules` | Offline dispense on a registered device: wrong lot, out of tolerance, operator = checker | Blocked locally where cached data allows; the server stores an out-of-tolerance or wrong-lot capture as a `dispense_records` row with `is_within_tolerance = false`, no consumption posted, plus a `deviations` stub (`docs/data-model.md` 11.5), never auto-accepted |
| `offline.retry_max_attempts_failed` | Server unreachable (route abort) for every flush; `settings.offline.max_attempts` lowered to 3 in the fixture (A-OFF-08, default 20) | After the third failed attempt the command shows device-side status `failed` under "Could not reach the server" and the periodic retry timer stops for it (no further requests observed); no `sync_conflicts` row exists; a manual "Sync now" resets `attempts` once and, with the server reachable, posts the command once |
| `offline.queue_age_exceeded_to_conflict` | `page.clock` advances past `settings.offline.max_queue_age_hours` (A-OFF-09, default 72 h) before the queued move is flushed | Device warns before the limit ("Sync within N h…"); at flush the server rejects the command with reason `auth_snapshot_expired`, writes a `sync_conflicts` row for review and `platform.sync_command.replay_rejected`; nothing posted; after re-authentication a reviewer may re-apply it as a new command |
| `offline.count_plan_closed` | Count line replayed after the count left `in_progress` | Rejected to conflict queue; recount candidate |
| `offline.logout_clears_cache` | Logout with pending commands | Warning lists pending commands; "discard" audited `platform.sync_command.discarded`; IndexedDB empty afterwards; next user on the shared device sees nothing |
| `offline.reference_freshness_badge` | Cached lot card 25 h old | "data as of" badge; full reference refresh on reconnect (A-OFF-01) |
| `offline.no_sensitive_cache` | Inspect IndexedDB after use by finance and HR users | No pricing, cost, payroll or personal data tables present |

Phase 7 exit (G7) requires every row above green in CI on `mobile-360` plus the manual run of
section 9 AC-20 on the company's phones.

---

## 7. Device and browser matrix

Confirmed facts: the brief requires representative iOS and Android devices, keyboard-wedge
USB/Bluetooth scanners, and a 360 px minimum layout (`docs/ux-system.md` 2.15). Everything else
below is an assumption until IT answers Q-A-03.

| Row | Device / browser | Role in testing | Automated | Manual at gates | Assumption |
|---|---|---|---|---|---|
| D1 | Android phone, Chrome current, 360 to 412 px CSS width, shared floor device | Primary operator device: scan, receive, move, weigh, pack, dispatch, count | `mobile-360` project on every PR; `mobile-360-camera` nightly | G2, G3, G4, G7 with the company's phones | A-TST-01: reference device is a mid-range 2023-class Android (4 GB RAM) |
| D2 | iPhone, Safari 16.4+, 375 to 430 px | Secondary operator / supervisor; camera scan via ZXing fallback where `BarcodeDetector` is absent | `mobile-webkit` nightly | G2, G4, G7 | A-TST-02: no iOS device farm; one company iPhone used manually |
| D3 | iPad / Android tablet, Safari or Chrome, 768 to 1024 px, managed device | Dispensing station, checklists, pack verification, QA tablet | `tablet-768` nightly | G3, G7 | A-TST-08: floor tablets are shared; user switch tested |
| D4 | Windows or macOS desktop, Chrome/Edge current, 1280 px+ | Supervisors, planners, owners, admins, printing A4 | `desktop-chromium` on every PR | G1 to G9 | A-TST-05: last two versions of Chrome/Edge; Firefox best-effort nightly |
| D5 | Keyboard-wedge scanner (USB on desktop, Bluetooth on phone) | Scan fields on every scan page | Fake wedge in CI (section 2.1) | G2, G4 with the company's scanner | A-TST-03: scanner sends payload + Enter, no prefix; Tab terminator configurable |
| D6 | Thermal label printer, 50 × 30, 100 × 50, 100 × 150 mm | Lot, box, pallet labels | PDF and QR round-trip in CI | G2 (label test page per template), G4 | A-TST-04: no printer in CI; browser printing of label-sized PDFs (A-PRD-05) |
| D7 | A4 laser/inkjet printer | BMR, DR, pick list, GR | Print-media screenshots and PDF text checks in CI | G3 (BMR reviewed by production and QA), G4 (DR) | — |
| D8 | Network: office Wi-Fi, floor Wi-Fi intermittent, phone on 4G | Performance and offline | Lighthouse throttling (A-TST-06); `setOffline`, delayed routes | G7 walk test across the floor dead zones (Q-OFF-01) | A-TST-06: 4G profile 1.6 Mbps / 750 kbps / 150 ms RTT, 4× CPU slowdown |

Accessibility is checked on D1 and D4 by axe in every flow spec and manually at each gate with
200 % zoom on D4 and system font scaling on D1 (`docs/ux-system.md` section 8).

---

## 8. Test data policy

| Rule | Detail |
|---|---|
| Fictional only | Every person, customer, supplier, address, email and phone number in seed and fixtures comes from `src/db/seed/fictional.ts`; names are obviously invented ("Narra Oils Trading (fictional)", "Kalinga Wellness Store (fictional)"); emails end in `@bryels-care.test` (same fixture list as the demo seed, `docs/data-model.md` 13.5); no real employee, customer, supplier or price. |
| Reference material from the brief | The Acapulco Soap BMR values (five ingredients, 17,600 g) are seeded as the example formula with the header "example from the paper BMR; tolerances are fictional placeholders; verify with authorized personnel before production use". No other formula, test, limit or statutory value is seeded as if real. |
| Seed profiles | `base` (organization, the two fictional sites of `docs/data-model.md` 13.5, `NFD` "Northfield Plant" and `RVS` "Riverside Depot", one warehouse and line each, special locations, 13 roles, permission catalogue, one user per role per site plus the three org-wide users, UOMs and conversions, reason codes, numbering rules, settings); `e2e` (base + released and blocked lots, boxes, a planned work order, an open count, a confirmed order); `demo` (richer, for staging walkthroughs); `perf` (A-PRD-12 volumes for section 11). |
| Seed guard | `pnpm db:seed` refuses when `APP_ENV=production` or when the target database contains any `stock_movements` row not created by a seed run (S1-10); exit code non-zero. |
| Credentials | Dev/staging passwords are generated by the seed command and printed once; never committed; staging users are deactivated before go-live. |
| Determinism | Seed uses fixed UUIDv7 ids (fixed clock and seeded random) so e2e selectors and snapshots are stable. |
| Production data | Never restored to developer machines or CI; anonymised extracts need owner approval (`docs/security.md` section 6). Acceptance tests at gates use staging with seed data; the go-live rehearsal (Phase 9) uses the migrated data set in a separate environment. |
| Cleanup | Tests create what they need and never depend on another test's rows; worker databases are dropped at teardown; e2e database is re-seeded per run. |

---

## 9. Acceptance test procedures

Each procedure is executed by the named role on the device row of section 7, on staging, with
the seed profile `e2e` unless stated. "Automated" lists the test ids that must be green in the
CI run referenced by the gate report; "Manual" is what a person verifies on the company's
hardware. Results are recorded as described in section 1.3.

### 9.1 AC-10 Cross-site isolation (Gate G1 framework, G2 inventory)

1. Sign in as `warehouse_operator.nfd@bryels-care.test` (warehouse_operator, NFD only) on D4.
2. Open an RVS lot URL copied from the RVS operator's screen. Expected: "This record isn't available at your sites." No lot fields visible.
3. In devtools, replay the lot list request with `siteId` = RVS. Expected: 404 or empty list; no RVS rows.
4. Replay a movement post with an RVS location in the body. Expected: 404/422; RVS balance unchanged (verified by the RVS operator).
5. Export the stock list with an RVS filter. Expected: file contains only NFD rows; audit viewer (system_admin) shows `platform.export.created` with the applied scope and `identity.authorization.denied` events for steps 2 to 4.
6. Repeat step 2 on D1 at 360 px. Expected: same denied state, no horizontal scroll.

Automated: `authz.cross_site.*` for identity, masterdata (G1) and inventory, procurement (G2); `authz.cross_site.scan`. Evidence: screenshots of steps 2 to 5 and the audit viewer.

### 9.2 AC-11 Receipt posting and duplicate submission (G2)

1. As warehouse_operator on D1, Receive Materials → expected receipt → scan `BC:MAT:RM-COCONUT-OIL` with D5, enter 25 kg, supplier lot, expiry.
2. Post. Expected: toast with the GR number; lot card shows status Quarantined, location Receiving; ledger shows one `receipt` movement with user, time, site, source GR.
3. Tap Post again immediately (double tap) and once more after a reload with the same draft. Expected: "already posted" message; still one movement and one lot.
4. Print labels (D6). Expected: label with material, lot, supplier lot, received date, expiry, QUARANTINE, QR; scanning the label with D1 camera opens the same lot card.
5. Before posting, attempt to move the lot. Expected: no stock exists; move refused.

Automated: `idempotency.*`, `ledger.projection.updated_in_transaction`, `procurement.receipt_creates_lot_only_on_post`, `uom.entered_and_base_stored`, label QR round trip. Evidence: photos of the printed label and the phone screen, audit export.

### 9.3 AC-12 Blocked stock cannot be issued (G2 status, G3 issue)

1. As qa_qc, place lot L1 `on_hold`; let lot L2 expire (expiry date yesterday, nightly job run on demand by system_admin); mark lot L3 `rejected`; mark L4 `recalled` via a `recall` lot disposition (FR-quality-01; recall cases are Phase 6).
2. As warehouse_operator on D1, scan each lot. Expected: risk banner (Quarantined / QA Hold / Expired / Rejected / Recalled) with icon and text; Move to a released bin and Allocate greyed with reason.
3. As production_operator on D3 during dispensing, scan each lot. Expected: "wrong lot / not eligible" with the expected lot shown; no dispense row.
4. As qa_qc, use the controlled exception for L1 (sampling, reason). Expected: allowed for quarantine/on_hold only; badge on the record; audit `inventory.stock_movement.held_stock_issued`. Attempt the same for L2, L3, L4. Expected: refused, no exception path.

Automated: `stock.blocked.matrix`, `stock.blocked.*`, `expiry_job.sets_expired`, `disposition.only_path_to_released`, `fefo.excludes_blocked`. Evidence: screenshots of each banner and the audit rows.

### 9.4 AC-13 Batch snapshot (G3)

1. As production_planner on D4, create work order WO-1 for Acapulco Soap, 17,600 g, on formula revision v1; create batch B1.
2. As the process owner, submit formula revision v2 changing coconut oil to 3,800.0 g; qa_qc and site_manager approve v2 effective today.
3. Open B1. Expected: ingredient table still shows 3,723.2 g, revision v1; BMR preview header shows v1.
4. Create batch B2 from a new work order. Expected: B2 shows v2 values.
5. Generate the BMR PDF for B1 before and after step 2. Expected: identical content (compare page text).

Automated: `batch.snapshot.*`. Evidence: both PDFs attached, diff output, screenshots.

### 9.5 AC-14 Dispensing rules (G3)

1. On D3 as production_operator, batch B1 in `materials_staged`: scan `BC:LOT` of a palm-oil lot on the coconut-oil line. Expected: blocked, expected lot shown.
2. Scan the correct lot, select scale `SC-01`, enter 3,650.0 g. Expected: blocked as out of tolerance; re-weigh offered.
3. Enter 3,700.0 g. Expected: accepted, within tolerance, operator and time shown.
4. Try to tick "checked" on the same session. Expected: refused. Checker signs in on their own device/session and confirms. Expected: checked by a different user.
5. Enter 3,650.0 g on another line and request the exception. Expected: qa_qc approval screen requires reason; after approval the row shows the deviation flag and a Deviation exists; audit `production.dispense_record.over_tolerance_approved`.
6. Enter the weight in `kg` (3.7). Expected: stored as 3,700 g; displayed in g.

Automated: `dispense.*`, `tolerance.*`, `sod.dispense.*`, `uom.*`, `production.wrong_material_never_allowed`. Evidence: screenshots, dispensing sheet PDF, audit rows.

### 9.6 AC-15 Batch completion trail (G3)

1. Complete all steps of B1 on D3 (line clearances with checker, process steps with readings, packaging reconciliation, yield entry with 5 % scrap and a rework record).
2. Transfer to quarantine (checklist 7) scanning the quarantine `BC:LOC`. Expected: in one transaction consumption movements per material lot, one output lot in Quarantined status at the quarantine location, finished-product inspection created; batch `awaiting_qc`.
3. As qa_qc enter results, review (second QA user), disposition release. Expected: lot `released`, batch `released`; disposition row; test results append-only (enter a correction and confirm the original remains visible).
4. Close the batch. Expected: BMR final PDF; `production_postings` rows each linked 1:1 to a `stock_movements` row; yield record with theoretical, actual, variance, scrap, rework.
5. Open the stock card of each consumed lot. Expected: consumption lines reference B1.

Automated: `ledger.*`, `statemachine.*` (batch), `concurrency.batch_step_posted_once`, `sod.*`, `quality.test_result_void_appends`, `genealogy.forward_and_backward`. Evidence: BMR PDF, ledger export, screenshots.

### 9.7 AC-16 Box scan and idempotent move (G2 box, G4 finished goods)

1. On D1 scan a finished-goods `BC:BOX` label with the camera, then with D5. Expected: card shows SKU, lot, quantity, status chip, location, lineage link; allowed actions only.
2. Move: scan destination `BC:LOC`. Expected: success toast; location updated; one transfer movement with `container_id`.
3. Scan the same box and destination again within seconds and after a reload. Expected: "Already moved to … at … by you"; still one movement.
4. Split the box 60/40; scan the child box. Expected: child label printed; lineage shows parent; contents reconcile.
5. Turn on airplane mode (G7 repeat) and perform step 2; reconnect. Expected: posted once, `Sync Pending` chip cleared.

Automated: `container.lineage.*`, `idempotency.*`, `scan.payload_grammar`, `offline.duplicate_scan_same_box` (G7), e2e `flows/inventory/scan-move.spec.ts` on both viewports. Evidence: photos of labels and screens.

### 9.8 AC-17 Over-shipment block and shipment reconciliation (G4)

1. As sales_cs, order SO-1 for 10 boxes of ACS-100G; confirm; allocate (FEFO). Note the available quantity of the lot.
2. As warehouse_operator on D1, pick 10 boxes by scan; at pack verification scan an 11th box. Expected: blocked "over shipment"; the 11th box is not added.
3. As site_manager (not the order creator) approve the exception with reason and customer reference. Expected: 11 allowed; badge on the shipment and DR; audit `sales.shipment.over_shipment_approved`.
4. Generate the DR before dispatch. Expected: stock unchanged (available quantity identical to step 1 minus allocation only).
5. Dispatch. Expected: available reduced by exactly the shipped quantity; one `shipment` movement per line; DR number assigned; containers `shipped`; order `shipped`.
6. Run the stock reconciliation report. Expected: zero differences.

Automated: `shipment.*`, `fefo.*`, `ledger.projection.matches_ledger`, `authz.exception.over_shipment`, `sales.pricing_masked_on_pick_pack_dr`. Evidence: DR PDF, reconciliation report, screenshots.

### 9.9 AC-18 BMR PDF (G3)

1. Generate the BMR for closed batch B1 from D4; open the preview and the PDF.
2. Check every page: batch number and product in header and footer, `Page x of y`, template version and checksum, formula revision, ingredient table (INCI name, material code, lot, expiry, theoretical, tolerance, actual, UOM, dispensed by, checked by, timestamps, deviation flag), procedure steps with readings and equipment, checklist 1 to 7 with conductor and checker, yield, QC results with spec limits, disposition with QA name and time, remarks, signature areas, QR `BC:DOC:<number>`.
3. Print on D7; compare to the preview. Expected: identical layout; no shell elements.
4. Reprint. Expected: reason required; "REPRINT 1" watermark; audit `documents.generated_document.reprinted`; reprint counter on the record.
5. Scan the QR while signed out. Expected: login required, then the batch record.

Automated: PDF text and visual checks of section 2.2 for the `bmr` template, `documents.reprint_audit`, `documents.hash_recorded`, `documents.qr_requires_auth`, `jobs.pdf_queue_limit`. Evidence: printed BMR reviewed and initialled by production and QA (gate requirement), PDF attached.

### 9.10 AC-19 Attendance import (G5)

1. As hr_payroll on D4 upload the representative time-clock file (anonymised, supplied by HR). Expected: file stored with checksum, size, uploader, time.
2. Map columns; preview. Expected: per-row status: ok, unknown employee, duplicate, missing punch, outside period, invalid timestamp; counts shown.
3. Upload the same file again. Expected: "already imported" with the date; re-run needs a reason.
4. Resolve exceptions: map one unknown id to an employee, confirm one duplicate as duplicate, leave one missing punch unresolved.
5. Post. Expected: ok and resolved rows posted; unresolved rows listed, not posted; exception report generated; original file downloadable (audited); events immutable; correction request by site_manager then approval by a different hr_payroll user appends an event.
6. Sign in as site_manager of another site. Expected: no access to the import or personal data.

Automated: `import.duplicates_flagged`, `import.requires_approval`, `import.values_only`, `import.rejects_macro`, `import.row_cap`, `hr.attendance_correction_not_self`, `hr.personal_data_*`, `export.formula_neutralized`. Evidence: exception report, audit export.

### 9.11 AC-20 Offline commands (G7)

Run section 6 scenarios manually on D1 and D3 on the floor: airplane mode mid-move, close the
app with 3 pending, restart, change the phone clock +20 minutes, duplicate scan, walk through a
dead zone during sync, let the session expire, have the admin revoke a permission while
offline, then resolve the resulting conflicts as site_manager each way. Expected per row of
section 6. Evidence: screen recording per scenario, conflict queue screenshots, ledger export
showing single postings.

Automated: all `offline.*` rows green on `mobile-360` in the gate CI run.

### 9.12 AC-21 KPI reconciliation (G5)

1. Seed profile `perf` (one month of data) on staging. As owner_director open the executive overview for that month, all sites. Expected: every tile shows definition, time basis, filters, refresh time and actual/estimate label.
2. For each owner KPI (output, yield, stock value, near-expiry, fill rate, quality holds, attendance coverage) drill down to the source list and export it. Expected: the tile value equals the recomputation from the exported rows (the analytics specialist supplies the reconciliation SQL per KPI, stored in `docs/analytics-kpis.md`).
3. Repeat as site_manager of NFD. Expected: NFD-only numbers.
4. Change a filter. Expected: tiles and drill-down agree.

Automated: `analytics.kpi.reconciles_to_source` (one test per KPI: compute from the fact tables with the seed clock and compare to the KPI query, exact `decimal.js` equality), `analytics.owner_dashboard_filters_to_allowed_sites`, dashboard p95 (section 11). Evidence: exported lists and the reconciliation query output.

### 9.13 AC-22 Permission coverage (every gate)

1. The gate report lists the `authz-coverage` job output: permission catalogue size in code equals the matrix; every mutating command has `@perm` tags with tests; zero uncovered.
2. A reviewer picks three random commands and invokes them through the API without the permission and from the wrong site. Expected: 403 / 404 and `identity.authorization.denied` events.

Automated: `authz-coverage` job, section 5 sets. Evidence: job log and the three manual probes.

### 9.14 AC-23 Deployment (G1 deploy, G9 restore drill)

1. Following `docs/deployment-railway.md` only, a team member who did not write it deploys to a fresh staging environment: variables, migrations as pre-deploy, `web` and `worker` services, bucket. Expected: `/api/health` 200, `/api/ready` 200; seed loaded; sign-in works on D1 and D4.
2. Stop the database. Expected: `/api/ready` 503, `/api/health` 200 (S1-08).
3. G9: restore the latest encrypted backup into an empty database and run the reconciliation report and `pnpm db:migrate` (no-op). Expected: zero reconciliation differences; row counts match the backup manifest; time to restore within A-PRD-33 RTO.
4. Rollback rehearsal: deploy the previous image with the current schema. Expected: documented rollback steps hold.

Automated: `migrations.apply_from_zero_and_noop` (S1-09), `health.ready_reflects_database`, `seed.guard_production`. Evidence: deploy log, health responses, restore timing record signed by the operations contact.

### 9.15 Slice 1 tests S1-01 to S1-15 (Gate G1)

| S1 | Automated test ids | Layer | Manual check at G1 |
|---|---|---|---|
| S1-01 | `authz.cross_site.url` (masterdata.location), `authz.cross_site.query`, `audit.authz_denied_written` | integration | 9.1 steps 1 to 3 |
| S1-02 | `authz.cross_site.body` (masterdata.location create) | integration | 9.1 step 4 |
| S1-03 | `authz.sod.approve_own` (platform settings change: the submitting `system_admin` approving their own request gets 409 `SEPARATION_OF_DUTIES`), `authz.sod.other_approver_ok` (a second `system_admin` or an `owner_director` holding `platform.settings.approve` succeeds), `authz.sod.site_manager_cannot_approve_settings` (a `site_manager` gets 403 `PERMISSION_DENIED`) | integration | Fixture: two `system_admin` users plus one `owner_director`; one admin submits on D4, the other admin approves on D1 |
| S1-04 | `identity.seeded_role_read_only` (an edit to a seeded `is_system` role such as `site_manager` is rejected and `role_permissions` is unchanged; cloning into custom roles is Phase 1b, US-1-29), `identity.assignment_change_audited_and_effective` (changing a user's role assignment writes `identity.site_assignment.granted` / `.revoked` with before/after role, and the user's effective permissions change at the next request), e2e `flows/identity/audit-viewer.spec.ts` | integration + e2e | Fixture user moved from `warehouse_operator` to `site_manager` at NFD; audit viewer filtered by entity type `user_site_assignments` shows the change, and the user's next request reflects the new role |
| S1-05 | `identity.revoke_all_sessions`, `authz.session.revoked` | integration + e2e (two contexts) | Two devices: D1 and D4 |
| S1-06 | `auth.lifecycle.deactivated_denied`, `auth.error.generic`, `audit.auth_events` | integration | Deactivated user attempts sign-in |
| S1-07 | e2e `states/mobile-360.spec.ts`: for every Slice 1 route assert `document.scrollingElement.scrollWidth <= 360`, every interactive element ≥ 44 px (48 px in operator mode), primary action visible without scrolling the navigation; axe clean | e2e `mobile-360` | D1 walk-through of every page |
| S1-08 | `health.ready_reflects_database` (database stopped via test container pause) | integration | 9.14 step 2 |
| S1-09 | `migrations.apply_from_zero_and_noop` (fresh database creates exactly the 33 Slice 1 tables of `docs/data-model.md` §13.6; second run no-op; `drizzle-kit check` no drift) | integration | Fresh staging deploy |
| S1-10 | `seed.guard_production`, `seed.names_fictional` (every name in the fictional list; no credential patterns) | integration | Attempt seed on staging with `APP_ENV=production` |
| S1-11 | `identity.site_switcher_lists_allowed_sites`, e2e `flows/identity/site-switcher.spec.ts` (both viewports) | integration + e2e | owner_director vs warehouse_operator on D1 |
| S1-12 | `uom.dimension_mismatch_rejected`, `uom.mass_to_mass_exact` | unit + integration | Create conversions on D4 |
| S1-13 | `numbering.unique_under_concurrency` (20 parallel, `GR-{YY}-{SEQ}`, SEQ width 5) | integration (concurrency harness) | — |
| S1-14 | `session.idle_expiry` (per device class, clock injected), `session.absolute_expiry`, `session.active_continues` | integration | Wait past idle on D1 |
| S1-15 | CI configuration test `ci.required_checks_present` (reads `.github/workflows/ci.yml` and branch protection via `gh api`); PR with a deliberately failing authz test is blocked | CI | Reviewer opens the blocked PR |

### 9.16 Migration rehearsal checks MC-01 to MC-16 (G9; G4 when the owner chooses an early go-live after Phase 4)

The normative list of checks with pass criteria, and the rehearsal schedule (R1 structural at
the end of Phase 2, R2 dress rehearsal at T-14, R3 cutover at T0), is `docs/data-migration-plan.md`
section 11; it is not repeated here. This section fixes how the checks are executed and
evidenced (backlog E-9-03 / US-9-06; E-2-07 for an early go-live; risk R-12).

1. Environment: R1 and R2 run on staging restored to the pre-load backup point with maintenance
   mode on (`docs/operations-runbook.md`, `docs/deployment-railway.md`) and
   `MIGRATION_WINDOW_OPEN` set only for the load window; R3 runs on production. Never on a
   developer machine or in CI (section 8, production data rule).
2. Executed by `principal-architect` and `qa-test-engineer` with the custodians of migration plan
   section 2; each MC check is recorded pass/fail with the evidence below in the cutover record
   (`docs/acceptance/<phase>/migration/`, section 1.3). A failed check blocks the next rehearsal
   unless the migration plan's "approved fix" rule applies (R2 pass criterion).
3. The automated ids below run against the migrated database copy (`tests/integration/migration/`,
   executed with `TEST_DATABASE_URL` pointing at the staging copy, never at production).

| MC | Automated test ids | Manual evidence |
|---|---|---|
| MC-01, MC-02 | `migration.rows_complete_no_unresolved_errors`, `migration.entity_counts_equal_accepted_rows` | Import job summary per file |
| MC-03, MC-04 | `migration.opening_quantities_reconcile` (`decimal.js`, exact to 6 decimals), `inventory.reconcile` job output, `ledger.projection.matches_ledger` on the migrated shape | Reconciliation report, zero differences |
| MC-05 | — | Variance report per item against the frozen S-01 sheets; site manager sign-off above threshold (A-MIG-02) |
| MC-06 | `migration.label_job_per_opening_lot`, `container.verified_by_scan_listed` | Label verification screen: remaining list per location; photos of three printed labels |
| MC-07, MC-08 | `migration.disposition_per_opening_lot`, `expiry_job.sets_expired`, `fefo.selects_earliest_expiry` on 10 sampled materials | Bulk disposition export |
| MC-09 | `migration.no_duplicate_codes_or_legacy_numbers` | Query output |
| MC-10, MC-11 | — | Custodian spot-check sheet (10 % sample, ≤ 1 % errors); open-order count and quantity against the frozen S-12 extract, every order `confirmed` |
| MC-12 | `documents.legacy_document_opens_from_lot`, `authz.cross_site.url` (`legacy_documents`) | Screenshots: 3 finished-goods lots (legacy BMR opens), 3 material lots (label and lot page show supplier lot and expiry) |
| MC-13 | — | Timing record per cutover step against the window (A-MIG-09) |
| MC-14 | `migrations.apply_from_zero_and_noop` on the restored copy | Restore drill within RTO (A-PRD-33) and ledger reconciliation after restore; shares evidence with 9.14 step 3 |
| MC-15 | `authz.cross_site.*` (section 5.1) executed against the migrated database | CI run URL of that execution |
| MC-16 | `audit.import_events`, `migration.opening_movements_reference_receipt` (`source_document_type = 'goods_receipt'`, opening receipt id set) | Audit viewer export: one `platform.import_job.posted` per job with counts |

### 9.17 Printer and label tests T-01 to T-18 (G2 to G5)

`docs/reports-and-templates.md` section 12 is the normative list (method, pass criterion and gate
per test); labels follow section 8.3 of that document. This section maps each test to its
executor, device row and evidence so both documents stay in step.

| T | Executed as | Automated test ids (must be green in the gate CI run) | Device / role | Evidence |
|---|---|---|---|---|
| T-01 | Manual at G2: print the test page of every label template on each company printer at 203 and 300 dpi; measure the 50 mm ruler mark and QR module | — (A-TST-04: no printer in CI) | D6; warehouse_operator with qa-test-engineer | Photo of label with ruler, measurement sheet |
| T-02 | Manual at G2 on the device matrix; CI counterpart is the label QR round trip (section 2.2) and `mobile-360-camera` | `scan.payload_grammar`, e2e camera scan specs | D1, D2; warehouse_operator | Screen recording per label kind, decode times |
| T-03 | Manual at G2 with each company scanner; terminator variants | `scanWedge` specs (section 2.1) | D5 on D1 and D4 | Payload shown equals printed payload |
| T-04 | Company test: labels in cold room, wet area, 7 days of handling, started before G2 week | — | D1 for re-scan | Photos before/after, scan results |
| T-05 | CI | `scan.payload_grammar`, `label.payload_minimal`, `numbering.output_matches_payload_grammar` (every rule output matches `^[A-Z0-9][A-Z0-9._-]{0,63}$`; `_` allowed, lowercase rejected at rule configuration) | — | CI run URL |
| T-06 | CI plus 9.9 step 4 | `documents.reprint_requires_reason`, `documents.reprint_audit` (audit `documents.generated_document.reprinted`; label reprints `documents.label_job.printed` with `reprint_of_id`) | D4, D6 | Audit rows, reprint counter screenshot |
| T-07 | CI plus manual at G2 | `label_job.status_transitions` (`queued → rendering → ready → printed`), `label_job.retry_single_identity`, `jobs.dead_letter` | D1 creates, print station on D4 prints | Action Center failure screenshot, single label identity |
| T-08 | 9.9 (AC-18) | section 2.2 PDF checks for the `bmr` template | D4, D7; production and QA reviewers | Initialled printed BMR |
| T-09 | Nightly | `pdf.page_break_stress` on `fixtures.stressBatch()` (60 BOM lines, 30 steps × 10 parameters, 3 inspections, 40 audit rows) | — | PDF artefact |
| T-10 | 9.4 step 5 | `batch.snapshot.later_revision_no_effect`, `documents.template_version_change_no_effect` | D4 | Text diff empty except footer timestamp |
| T-11 | CI | `documents.preview_text_equals_pdf_text`, `documents.hash_recorded` | — | CI run URL |
| T-12 | CI (section 5) | `authz.cross_site.url` (`generated_documents`), `documents.generated_scoped_by_source_record`, `authz.role_escalation.missing_permission` (auditor reprint, operator template approve), `sales.pricing_masked_on_pick_pack_dr` | — | CI run URL |
| T-13 | 9.8 steps 4 and 5 | `shipment.draft_no_stock_change`, `shipment.dispatch_posts_issue` | D1, D4, D7 | Three DR copies, portal copy without internal data |
| T-14 | G4 manual plus e2e | `pack.verification_blocks_mismatch`, `container.repack_preserves_history` (packing list v2 supersedes v1 with lineage) | D1, D3 | Packing list v1 and v2 |
| T-15 | CI after the concurrency suite | `report.stock_card_reconciles` (50 random lots, zero differences, any difference printed) | — | Report output |
| T-16 | 9.10 step 5 | `import.values_only`, `audit.import_events`, `export.formula_neutralized` | D4; hr_payroll | Exception report, audit export |
| T-17 | Manual at G3 | — | D1, D2, D4 PDF viewers | Screenshots per viewer; metadata dump |
| T-18 | CI | `jobs.pdf_queue_limit` (11 concurrent requests, 429 on the 11th), PDF memory check of section 11.1 | — | CI run URL, memory sample |

### 9.18 MVP client-demo rehearsal (pre-demo check)

Before every client demo the full storyline of `docs/demo-script.md` is run on a production
build against a freshly reset database: receipt into quarantine, label, keyboard-wedge scan, QA
release, expired-lot release blocked, put-away move, batch plan, start, weigh 5 ingredients
(FEFO-recommended lots, checker ≠ operator), 7 checklist steps, completion, 3 QC results, batch
release, BMR PDF, sales order, FEFO allocation, dispatch, DR PDF, reverse and forward trace,
owner KPIs before and after, audit log, and a 390 × 844 phone check (no horizontal scroll).
The run asserts status chips, numbers and texts, and fails on any error page, console error or
failed request (favicon excluded). It also fails when a screen still looks unchanged after a
successful in-place action: there is no reload fallback and no reload between staging scans
(ADR-043).

`tests/e2e/in-place-actions.cjs` is the focused regression check for ADR-043: on a fresh seed and a
production build it takes 17 in-place actions across receipts, counts, adjustments, QA
inspection and review, holds, settings, batch weighing, notifications and work orders, each right
after a client-side navigation, and fails if any screen still looks unchanged after 10 s (no
reload). Run it 10 times in a row on a fresh seed before changing forms, actions or route layout;
the pre-fix build failed every run, the fixed build passes 10 of 10.

| Run | Result | Evidence |
|---|---|---|
| 23 Oct 2026 (QA) | Passed from a fresh seed after 8 fixes (listed in the QA report of that date) | 32 screenshots, `bmr.pdf` (2 pages), `delivery-receipt.pdf` (1 page); 12 screenshots kept in `docs/demo/` |

Follow-up: move the rehearsal script into `tests/e2e/demo-rehearsal.spec.ts` under the
Playwright configuration of 3.7, so that CI runs it against an ephemeral database.

---

## 10. CI gates and flakiness policy (ADR-013)

### 10.1 Pipeline on every pull request (GitHub Actions)

| Job | Command | Blocking |
|---|---|---|
| `lint` | `pnpm lint` (ESLint incl. boundaries, `no-ledger-mutation`, decimal and security rules), `pnpm format:check` | yes |
| `typecheck` | `pnpm typecheck` (`tsc --noEmit`, strict) | yes |
| `unit` | `pnpm test:unit` with coverage thresholds (section 3.2) | yes |
| `integration` | `pnpm test:integration` against `postgres:16` service container; includes `tests/integration/authz` and `tests/integration/security` | yes |
| `authz-coverage` | `pnpm test:authz-coverage` compares the permission catalogue to `@perm` tags and the matrix section 8 case list per module | yes |
| `migrations` | fresh database: `pnpm db:migrate` twice; `drizzle-kit check` for drift; `seed.guard_production` | yes |
| `e2e-smoke` | `pnpm test:e2e --project=desktop-chromium --project=mobile-360 --grep @smoke` (sign-in, site switch, one flow per shipped slice, page states) | yes |
| `build` | `pnpm build`; client bundle grep for secret variable names | yes |
| `security` | `pnpm audit --prod`, `gitleaks`, Trivy image scan (warn until Phase 9) | yes (audit/gitleaks), warn (Trivy) |
| `docs-sync` | Fails when `src/modules/**` changes without a change under `docs/` or when a permission string in code is missing from `docs/permissions-matrix.md` | yes |

Merges to `main` require every blocking job and one review; the `principal-architect` persona
reviews cross-module changes; the `security-engineer` persona reviews changes under `src/lib/auth`,
`src/modules/identity`, exports, uploads, webhooks.

### 10.2 Nightly and gate runs

| Run | Content |
|---|---|
| Nightly | Full Playwright matrix (`desktop-chromium`, `mobile-360`, `tablet-768`, `mobile-webkit`, `mobile-360-camera`), property tests with 10× iterations, `concurrency.deadlock_free` at 1,000 interleavings, Lighthouse CI (section 11), dependency update PRs |
| Gate | Nightly set plus the manual procedures of section 9 for the phase (including the printer and label tests of 9.17 at G2 to G5), the security checklist of `docs/security.md` 8.1, and the performance report; results attached to the gate report |
| Phase 9 | Load test (section 11.2), penetration test findings, backup/restore drill (9.14), migration rehearsal MC-01 to MC-16 (9.16), go-live checklist (`docs/operations-runbook.md` §17a.1) |

### 10.3 Flakiness policy

1. No test is skipped, quarantined, marked `fixme`, retried into green or deleted to make a
   pipeline pass. `.only`, `.skip`, `.todo` and `test.fixme` fail `lint` on `main`.
2. Unit and integration jobs run with `retry: 0`. The e2e job allows one retry in CI; every
   retried-then-passed test is written to `flakes.json` as a CI artefact and opens or updates an
   issue labelled `flaky` with the trace attached. The author of the test owns it.
3. A flaky test must be fixed within two working days or the feature it covers is reported as
   "not tested" in the next slice report. It is never moved to a non-blocking job.
4. New or changed e2e tests run `--repeat-each=5` in the PR that introduces them.
5. Root causes are fixed in the test kit, not in the test: unstable selectors (use `data-testid`
   and roles), wall-clock dependence (use the clock), shared seed rows (create per test),
   animation timing (`reducedMotion: 'reduce'`), network races (await the API assertion).
6. A failing test is reported verbatim in the slice report even when the cause is understood.

---

## 11. Performance and load checks

Targets come from `docs/PRD.md` section 7 (phone targets) and volumes from A-PRD-12
(≤ 60 users, ≤ 25 concurrent, ≤ 2,000 movements/day, ≤ 100 batches/month, ≤ 20 shipments/day).

### 11.1 Continuous checks (nightly from Phase 1, blocking from Phase 2)

| Check | Tool and method | Threshold |
|---|---|---|
| Operator shell first interactive | Lighthouse CI, mobile emulation, A-TST-06 throttling, pages: sign-in, operator home, scan home, receive, move | TTI ≤ 3.0 s; LCP ≤ 2.5 s; CLS ≤ 0.1; total JS for the operator route group ≤ 250 kB gzip |
| Scan-to-result | Playwright `mobile-360` with cached reference data: time from `Enter` on the wedge input to the scan result card visible, 20 samples | p95 ≤ 1.0 s |
| Posting command server time | Integration timing harness over 200 postings (receipt, transfer, consumption, shipment) on the `perf` seed; server time measured inside the route handler and exposed in `Server-Timing` | p95 ≤ 500 ms; p99 ≤ 1 s |
| Dashboard | `perf` seed, one month, all sites, owner_director | ≤ 3.0 s to full render; underlying queries ≤ 1.5 s |
| Query plans | `EXPLAIN (ANALYZE, BUFFERS)` for every scoped list and the availability query on the `perf` seed | No sequential scan on operational tables above 10,000 rows; all filters start with `site_id` index |
| PDF generation | BMR for a 7-step batch with 5 lines and 40 readings in the worker | ≤ 10 s; Chromium RSS ≤ 512 MB (ADR-016 fallback trigger) |
| Reconciliation job | `inventory.reconcile` on `perf` seed | ≤ 60 s; zero differences |
| Sync replay (P7) | Batch of 50 commands | ≤ 5 s server time; one transaction per command |

### 11.2 Load test (Phase 9, staging)

k6 scenarios: 25 virtual users for 30 minutes mixing scan lookups (120/min/session ceiling),
movement postings at 3× the daily peak (≈ 0.5 postings/s sustained, bursts of 10/s), 5
concurrent dispatches, 2 BMR generations/min, one dashboard refresh/min per owner session, and
a 20,000-row attendance import in parallel. Pass: p95 posting ≤ 500 ms, error rate < 0.1 %
excluding expected 409/429, zero reconciliation differences afterwards, worker queue drained
within 5 minutes, no connection-pool exhaustion (Railway Postgres connection ceiling respected).
Rate limits (`docs/security.md` 4.5) are verified to engage with 429 and `Retry-After`.

### 11.3 As built (Wave 4 W4F, US-9-01): harness and commands

No k6: the harness is Node only, so it runs anywhere the repository runs. Results and the
method are in `docs/load-test-report.md`.

| Step | Command | What it does |
|---|---|---|
| Volume seed | `pnpm load:seed --months 3` on a scratch database (name must contain `load`, `perf` or `scratch`) after `db:migrate` and `db:seed` | 500 materials, 300 SKUs, 200 lots/month, 2,000 movements/day (receipt + transfers, balances projected from the ledger), one audit event per movement, 20 orders/day with lines and shipments, 100 batches/month with yield records, 20,000 notifications; one transaction |
| Posting server time | `LOAD_DATABASE_URL=… pnpm load:postings` (tests/load/posting-timing.load.ts, own vitest config) | receipts, transfers, weighings (recordDispense with checker), dispatches, availability and full reconciliation, timed inside the process through the real services |
| HTTP load | `pnpm build`, `pnpm next start -p <port>`, then `DATABASE_URL=… pnpm load:run --vus 25 --duration 600` (tests/load/run.ts) | 25 virtual users sign in through the real server action and loop over role flows; a burst of 10 parallel moves per warehouse user; then the API rate limit check (429 + Retry-After), reconciliation and the job queue |

Integration test ids added by W4F (`tests/integration/platform/retention.test.ts`):
`retention.unconfirmed_reports_only`, `retention.dry_run_deletes_nothing`,
`retention.legal_hold_blocks_purge`, `retention.implicit_hold_open_complaint`,
`retention.protected_classes_never_purged`, `retention.confirm_not_editor`,
`legal_hold.release_not_placer`, `authz.cross_site.legal_hold`, `authz.role_escalation.retention`,
`restore_drill.signoff_not_performer`, `alerts.restore_drill_overdue`, `health.worker_stale_is_503`;
unit `US-9-08` guide coverage in `tests/unit/help/guides.test.ts`.

---

## 12. Open questions

| Id | Question | Needed from | Blocks |
|---|---|---|---|
| Q-TST-01 | Which exact phone, tablet and scanner models are in use, and are floor devices shared (A-TST-01, A-TST-03, A-TST-08)? | IT (Q-A-03) | Device matrix finalisation before G2 |
| Q-TST-02 | Can one Android phone and one iPhone be made available to the team for every gate from G2, plus the label printer and A4 printer? | Owner, IT | Manual procedures 9.2, 9.7, 9.9 |
| Q-TST-03 | Who from production and QA signs the printed BMR review at G3, and who from HR supplies the anonymised time-clock file for 9.10 (Q-A-06)? | Owner | G3, G5 evidence |
| Q-TST-04 | Closed (architect ruling, 2026-10-16): the clock-skew flag threshold is 10 minutes (`docs/offline-sync.md` A-OFF-05); `docs/security.md` adopts it. `offline.time_skew_flagged` uses 10 minutes. | — | — |
| Q-TST-05 | Closed (applied): `docs/data-model.md` 5.3 and every availability, expiry and effective-date query take `$as_of`; no `CURRENT_DATE` (section 3.6). | database-architect | — |
| Q-TST-06 | Closed (architect ruling, 2026-10-16): the catalogue spellings are canonical (`inventory.movement.*`, `quality.hold.*`, `sales.over_shipment.approve`, `masterdata.formula.approve`); the data model and process maps are renamed. This document already uses the catalogue; the `authz-coverage` check reads `src/lib/permissions.ts`, which must equal `docs/permissions-matrix.md`. | — | — |
| Q-TST-07 | Resolved (architect ruling, 2026-10-16): audit names are `module.entity.event` as in `docs/data-model.md` 8.1 (for example `inventory.stock_movement.posted`, `identity.authorization.denied`); the `docs/security.md` section 5 catalogue and `docs/process-maps.md` are re-keyed to them. Tests assert the data-model names (applied in sections 1.2, 2.2, 4, 5, 6 and 9). `platform.sync_command.discarded` (logout discard of a pending outbox, section 6) is catalogued in data-model 8.1 (architect ruling 74). | — | `audit.*` tests |
| Q-TST-08 | Is a dedicated staging environment with the `perf` seed acceptable for the nightly performance run, or must performance runs use a separate Railway environment to avoid disturbing acceptance testing? | devops-engineer, owner | Section 11 from Phase 2 |
| Q-TST-09 | Does the owner want the manual acceptance records (`docs/acceptance/<phase>/`) kept in the repository or in the company's document system? | Owner | Evidence storage from G1 |
| Q-TST-10 | Independent penetration test budget for G9 (`docs/security.md` open question 4) and whether its findings are gate-blocking. | Owner | Phase 9 plan |

---

## 13. Assumptions (A-TST-nn)

| Id | Assumption (default) | Configurable where | Needs confirmation from |
|---|---|---|---|
| A-TST-01 | Reference Android device is a mid-range 2023-class phone (4 GB RAM, current Chrome), 360 to 412 px CSS width; CI emulates 360 × 640 at 3× | `playwright.config.ts` devices | IT |
| A-TST-02 | iOS is covered by nightly WebKit emulation plus one company iPhone at gates; no device farm | `playwright.config.ts` | IT, owner |
| A-TST-03 | Keyboard-wedge scanners send the payload followed by Enter with no prefix; a Tab terminator is a per-device setting | `settings.scan.terminator` | IT |
| A-TST-04 | No printer in CI; label correctness is proven by PDF/QR round trip in CI and by printing the template test page at G2 | — | IT |
| A-TST-05 | Supported browsers: last two versions of Chrome/Edge (desktop, Android), Safari 16.4+ (iOS, iPadOS, macOS); Firefox desktop best-effort | README support table | Owner |
| A-TST-06 | Performance profile: Lighthouse mobile slow-4G (1.6 Mbps down, 750 kbps up, 150 ms RTT) with 4× CPU slowdown | `lighthouserc.js` | IT |
| A-TST-07 | Local tests use Docker Postgres 16 on port 5433; CI uses the `postgres:16` service container; no shared test database | `docker/compose.test.yml`, workflow | devops-engineer |
| A-TST-08 | Floor devices are shared, so e2e and manual tests include user switching on one device and cache clearing on logout | test fixtures | Site managers (Q-OFF-02) |
| A-TST-09 | PR CI runs the e2e smoke set on `desktop-chromium` and `mobile-360`; the full matrix runs nightly and at gates | workflow | principal-architect |
| A-TST-10 | Real camera decoding is tested with injected video frames in Chromium nightly; PR CI uses the `BarcodeDetector` injection seam | `playwright.config.ts` | frontend-engineer |
