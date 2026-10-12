# Offline and sync strategy

Owner: `principal-architect` with `frontend-engineer` and `security-engineer`. Status:
Proposed (ADR-018). Implementation phase: 7 (PWA hardening), with the command API designed
for replay from Phase 2.

## 1. Principles

1. The **server is authoritative** for all posted business state. Offline mode is a
   constrained local working set plus a durable queue of commands, never a second database.
2. Offline is **selective and explicit**. Only the workflows in section 3 may run offline;
   everything else shows a clear "online required" state.
3. Every queued command is **idempotent** (client UUIDv7 id + idempotency key) and is
   **re-validated** by the server as if it were typed online: permissions, site scope, record
   state, lot status, tolerances, duplicate keys.
4. Users always see **sync status**: pending, syncing, synced, failed, conflict, and the
   time of the last successful sync and reference-data refresh.
5. A revoked permission or session **cannot be bypassed indefinitely**: the client requires
   periodic re-authentication and authorization refresh; cached data is cleared on logout or
   device removal.

## 2. Client architecture

| Part | Technology | Responsibility |
|---|---|---|
| Service worker | Serwist (Next.js integration) | Precache app shell; runtime-cache approved reference endpoints; never cache command responses |
| Local store | IndexedDB via Dexie | `reference` tables (products, materials, locations, lots for assigned sites, work orders assigned to the device, formulas and tolerances for those work orders), `outbox` (queued commands), `sync_log`, `device` |
| Outbox | Dexie table + background flush | FIFO per device; each command: `id` (UUIDv7), `idempotencyKey`, `type`, `payload`, `siteId`, `createdAt` (client clock), `status`, `attempts`, `lastError`, `serverResult` |
| Flush | `online` event, visibility change, manual "Sync now", periodic timer when online | Sends commands in order to `POST /api/v1/sync/commands` in batches of up to 50 |
| Reference refresh | `GET /api/v1/sync/reference?since=<cursor>` | Incremental updates with server cursor; full refresh on first install or after 24 h gap (assumption A-OFF-01) |
| Auth | Session cookie + short-lived authorization snapshot (permissions, allowed sites, expiry) stored locally | Snapshot older than 12 h (A-OFF-02) blocks new offline commands until the user reconnects; expired session blocks all offline actions |

The app detects connectivity by actual request success, not only `navigator.onLine`.

## 3. Workflow eligibility

| Workflow | Offline policy | What is validated locally | What the server re-validates on replay | Conflict handling |
|---|---|---|---|---|
| View assigned tasks, work instructions, cached product/lot data | **Cached read** when previously synced and permitted | nothing (read-only) | n/a | Show "data as of <time>" badge |
| Scan box/lot/location and create a movement request | **Queueable** if site policy allows (default: allowed for warehouse_operator on registered devices, A-OFF-03) | identity exists in cache, destination is a valid location, status not blocked *as cached*, quantity ≤ cached balance | stock exists, lot status, scope, duplicate key, negative stock policy, container lineage | rejected command goes to the device's **conflict list** and the site's **conflict review queue**; nothing is posted |
| Dispensing / weighing capture | **Queueable** only on a registered device with a pre-assigned work order whose batch is `materials_staged` or `in_process` and whose formula revision and tolerances are cached (A-OFF-04) | material/lot matches BOM line, within tolerance, operator and checker present, equipment id valid | batch state, lot status, tolerance, operator ≠ checker, approvals, equipment calibration status | out-of-tolerance or wrong-lot captures are never auto-accepted; server records the capture as `pending_review` with a deviation stub |
| Line clearance and process-step checklist ticks | **Queueable** on the same conditions as dispensing | step order prerequisites as cached | batch state, step prerequisites, required readings present | conflict queue |
| Stock count entries (blind) | **Queueable** on registered devices for an open count plan | count plan open as cached | count plan still open, line not already counted by another device (dual entries kept, variance shown) | duplicates become recount candidates |
| Receiving, put-away confirmations | **Queueable** (Phase 7, after warehouse validation) | PO line and location exist in cache | PO state, quantities, supplier lot uniqueness | conflict queue |
| QA release, dispositions, holds | **Online-only** | — | — | — |
| Financial posting, payroll approval, permission changes, formula/routing approvals | **Online-only** | — | — | — |
| Customer order draft or notes | **Later phase**; queueable as draft only | — | price/availability re-check before confirmation | user confirms online |
| Reports and dashboards | **Cached snapshot** only where useful | — | — | timestamp shown; never implied real-time |

Policies are configuration (`settings.offline.*` per site and role), editable by
`system_admin`, with safe defaults above.

## 4. Command replay protocol

```
client                                     server
  |-- POST /api/v1/sync/commands ---------->|
  |   [{id, idempotencyKey, type, payload,  |  for each command, in order:
  |     siteId, deviceId, clientCreatedAt,  |   1. authenticate session, load AuthContext
  |     authSnapshotIssuedAt}]              |   2. check idempotency key: if seen → return stored result
  |                                         |   3. run the normal command pipeline (validate → authorize → transact → audit)
  |                                         |   4. store result against the key
  |<-- 200 [{id, status: applied|rejected|  |
  |         conflict, serverResult, error}] |
```

- Order is preserved per device; a rejected command does not block later independent
  commands, but a command that depends on a rejected one (e.g. second move of the same box)
  is marked `conflict: dependency_failed`.
- Server time is authoritative for `posted_at`; `clientCreatedAt` is stored for audit and
  shown to reviewers. Clock skew beyond a threshold (A-OFF-05: 10 minutes) is flagged, not
  fatal.
- Replay is idempotent at the server even if the client resends a batch after a lost
  response.

## 5. Conflict review

A `sync_conflicts` record is created for every rejected or conflicted command with: device,
user, site, command type, payload, server reason, related record, created time, status
(`open`, `resolved_applied`, `resolved_discarded`, `resolved_amended`), reviewer, note.

- Reviewers (site_manager, or the module's supervisor role) see the queue in the action
  centre; the originating user sees their own conflicts on the device.
- Resolution options are explicit: re-apply with corrected data (creates a **new** command,
  audited), discard with reason, or escalate to a deviation (production) or stock adjustment
  with approval (inventory). The original command is never silently applied.

## 6. Security on the device

- Secrets never live in the PWA. The session cookie is HttpOnly; the local store holds only
  business reference data for assigned sites and the user's own queued commands.
- IndexedDB is encrypted at rest only where the platform does it (iOS/Android app storage);
  the web app additionally limits what it caches (no payroll, pricing, cost or personal data
  offline) rather than promising encryption it cannot guarantee.
- Logout, device removal by an admin, or session revocation clears the local store on next
  app open; queued commands that were not synced are listed to the user before clearing and
  exported to a support bundle if the user requests it (A-OFF-06).
- Registered devices (`devices` table) are required for dispensing and counting offline;
  anonymous browsers get cached reads and movement requests only.

## 7. Cached data policy

| Data | Scope | Refresh | Retention offline |
|---|---|---|---|
| Products, SKUs, materials, UOMs, locations, reason codes | assigned sites | incremental, on each sync | until logout or 30 days (A-OFF-07) |
| Lots and balances for assigned sites | assigned sites, released/quarantine/hold statuses included so blocked state is visible | incremental | 7 days |
| Work orders, batches, formula revisions, tolerances, instructions | assigned to device/user | on assignment and each sync | until batch closed + 7 days |
| Count plans | open plans for assigned sites | each sync | until plan closed |
| Tasks, notifications | user | each sync | 7 days |
| Dashboards | user, snapshot | on view while online | 24 h, badge shows age |

## 8. User experience requirements

- Global sync indicator in the top bar / bottom tab: cloud icon with state and pending count;
  tap opens the sync panel (last sync, pending commands, failures, conflicts, "Sync now").
- Every queued record displays a "Pending sync" chip in its list and detail until applied.
- An offline-ineligible action shows a disabled control with "Available when online"; it is
  never hidden, so users understand why.
- First-run install prompt and "works offline for: ..." explanation in Help.

## 9. Tests (Phase 7 acceptance; see `docs/testing.md`)

Airplane mode mid-workflow; browser tab closed with pending commands; app restart; device
clock skew; duplicate scan of the same box; partial connectivity (requests time out);
expired session during offline work; permission revoked while offline; replay after lost
response (no duplicate posting); conflict routed to the queue and resolved each way.

## 10. Assumptions and open questions

| Id | Assumption / question | Default | Needs |
|---|---|---|---|
| A-OFF-01 | Full reference refresh after 24 h without sync | 24 h | owner / IT |
| A-OFF-02 | Authorization snapshot validity for offline commands | 12 h | owner / security |
| A-OFF-03 | Movement requests may be queued by warehouse operators | allowed on registered devices | warehouse lead |
| A-OFF-04 | Dispensing offline only on registered devices with pre-assigned batches | yes | production / QA |
| A-OFF-05 | Clock skew flag threshold | 10 min | IT |
| A-OFF-06 | Unsynced commands exported to a support bundle before clearing | yes | IT |
| A-OFF-07 | Reference cache retention | 30 days | IT |
| Q-OFF-01 | Which areas actually lack connectivity, and for how long? | — | IT / site managers |
| Q-OFF-02 | Are devices shared between operators or individually assigned? (affects device registration and re-auth) | — | site managers |
| Q-OFF-03 | Are managed tablets (MDM) available for dispensing stations? | — | IT |
