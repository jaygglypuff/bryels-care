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
4. Users always see **sync status**: the device-side outbox status (`pending`, `syncing`,
   `synced`, `failed`, `conflict`) mapped to the server-side `sync_commands.status`
   (`received`, `applied`, `rejected`, `conflict`, `superseded`; `docs/data-model.md` §11.2,
   mapping in section 4.2), and the time of the last successful sync and reference-data
   refresh.
5. A revoked permission or session **cannot be bypassed indefinitely**. Two distinct
   timers apply: an **online** client refreshes its permission set every 8 h or on each sync
   (`docs/security.md`, `docs/permissions-matrix.md`); the **offline authorization snapshot**
   stays valid for 12 h without a server round trip (A-OFF-02), after which no new offline
   command can be queued until the device reconnects. Cached data is cleared on logout or
   device removal.

## 2. Client architecture

| Part | Technology | Responsibility |
|---|---|---|
| Service worker | Serwist (Next.js integration) | Precache app shell; runtime-cache approved reference endpoints; never cache command responses |
| Local store | IndexedDB via Dexie | `reference` tables (products, materials, locations, lots for assigned sites, work orders assigned to the device, formulas and tolerances for those work orders), `outbox` (queued commands), `sync_log`, `device` |
| Outbox | Dexie table + background flush | FIFO per device; each command: `id` (UUIDv7 → `sync_commands.id`), `idempotencyKey` (→ `idempotency_key`), `type` (→ `command_type`), `payload`, `siteId` (→ `site_id`), `deviceId` (→ `device_registration_id`), `createdAt` (client clock → `client_created_at`), `sequence` (→ `client_sequence`), `dependsOn` (→ `depends_on_command_id`), `authSnapshotIssuedAt` (→ `auth_snapshot_issued_at`), `status` (device-side, section 4.2), `attempts`, `nextAttemptAt`, `lastError`, `serverResult`; retry rules in section 4.1 (`docs/data-model.md` §11.2) |
| Flush | `online` event, visibility change, manual "Sync now", periodic timer when online | Sends commands in order to `POST /api/v1/sync/commands` in batches of up to 50 |
| Reference refresh | `GET /api/v1/sync/reference?since=<cursor>` | Incremental updates with server cursor; full refresh on first install or after 24 h gap (assumption A-OFF-01) |
| Auth | Session cookie + short-lived authorization snapshot (permissions, allowed sites, expiry) stored locally | While online the permission set is refreshed every 8 h or on each sync; offline, a snapshot older than 12 h (A-OFF-02, `settings.offline.auth_snapshot_max_age`) blocks new offline commands until the user reconnects; expired session blocks all offline actions |

The app detects connectivity by actual request success, not only `navigator.onLine`.

## 3. Workflow eligibility

| Workflow | Offline policy | What is validated locally | What the server re-validates on replay | Conflict handling |
|---|---|---|---|---|
| View assigned tasks, work instructions, cached product/lot data | **Cached read** when previously synced and permitted | nothing (read-only) | n/a | Show "data as of <time>" badge |
| Scan box/lot/location and create a movement request | **Queueable** (`movement_request`) if site policy allows (default: allowed for warehouse_operator on registered devices, A-OFF-03) | identity exists in cache, destination is a valid location, status not blocked *as cached*, quantity ≤ cached balance | stock exists, lot status, scope, duplicate key, negative stock policy, container lineage | rejected command goes to the device's **conflict list** and the site's **conflict review queue**; nothing is posted |
| Dispensing / weighing capture | **Queueable** (`dispensing`) only on a registered device with a pre-assigned work order whose batch is `materials_staged` or `in_process` and whose formula revision and tolerances are cached (A-OFF-04) | material/lot matches BOM line, within tolerance, operator and checker present, equipment id valid | batch state, lot status, tolerance, operator ≠ checker, approvals, equipment calibration status | out-of-tolerance or wrong-lot captures are never auto-accepted: the server stores the capture as a `dispense_records` row with `is_within_tolerance = false`, posts no consumption, opens a `deviations` stub and sets `batch_materials.status` to `exception`, exactly as online (`docs/data-model.md` §11.5); a `sync_conflicts` row with reason `out_of_tolerance` or `wrong_lot` points the reviewer at it |
| Line clearance and process-step checklist ticks | **Queueable** (`process_steps`) on the same conditions as dispensing | step order prerequisites as cached | batch state, step prerequisites, required readings present | conflict queue |
| Stock count entries (blind) | **Queueable** (`stock_count`) on registered devices for an open count plan | count plan open as cached | count plan still open, line not already counted by another device (dual entries kept, variance shown) | duplicates become recount candidates; a line replayed after the count closed is rejected with reason `count_closed` |
| Receiving, put-away confirmations | **Queueable** (`receiving`; Phase 7, after warehouse validation) | PO line and location exist in cache | PO state, quantities, supplier lot uniqueness | conflict queue |
| Pick scans and pack verification scans (W09-06/07) | **Queueable** (`pick_pack`) on registered devices for an order in `allocated` or `picking` as cached | box/lot is allocated to the order as cached, quantity ≤ allocated | allocation and order state, over-quantity rejected, container lineage | conflict queue; shipment dispatch itself stays online-only |
| QA release, dispositions, holds | **Online-only** | — | — | — |
| Financial posting, payroll approval, permission changes, formula/routing approvals | **Online-only** | — | — | — |
| Customer order draft or notes | **Later phase**; queueable as draft only | — | price/availability re-check before confirmation | user confirms online |
| Reports and dashboards | **Cached snapshot** only where useful | — | — | timestamp shown; never implied real-time |

Policies are configuration (`settings.offline.*` per site and role), editable by
`system_admin`, with safe defaults above. The workflow code in brackets is the value stored
in `device_registrations.allowed_offline_workflows` (`docs/data-model.md` §11.1): a device
may run a queueable workflow offline only when the site policy allows it **and** the code is
granted to that device. The six codes are `movement_request`, `dispensing`, `process_steps`,
`stock_count`, `receiving`, `pick_pack`; anonymous (unregistered) browsers get cached reads
and `movement_request` only.

## 4. Command replay protocol

```
client                                     server
  |-- POST /api/v1/sync/commands ---------->|
  |   [{id, idempotencyKey, type, payload,  |  for each command, in clientSequence order:
  |     siteId, deviceId, clientCreatedAt,  |   0. insert sync_commands row, status `received`
  |     clientSequence, dependsOn,          |   1. authenticate session, load AuthContext
  |     authSnapshotIssuedAt}]              |   2. check idempotency key: if seen → return stored result
  |                                         |   3. run the normal command pipeline (validate → authorize → transact → audit)
  |                                         |   4. store result against the key; status → applied | rejected | conflict
  |<-- 200 [{id, status: applied|rejected|  |
  |         conflict, serverResult,         |
  |         errorCode, errorMessage}]       |
```

Field mapping (client camelCase → `sync_commands` column, `docs/data-model.md` §11.2):
`id` → `id`; `idempotencyKey` → `idempotency_key`; `type` → `command_type`; `siteId` →
`site_id`; `deviceId` → `device_registration_id` (null for anonymous browsers);
`clientCreatedAt` → `client_created_at`; `clientSequence` → `client_sequence`; `dependsOn` →
`depends_on_command_id`; `authSnapshotIssuedAt` → `auth_snapshot_issued_at`. The server adds
`received_at`, `sync_batch_id`, `position_in_batch`, `replayed_at` and `correlation_id`.

- Order is preserved per device; a rejected command does not block later independent
  commands, but a command that depends on a rejected one (e.g. second move of the same box)
  is marked `conflict: dependency_failed`.
- Server time is authoritative for `posted_at`; `clientCreatedAt` is stored for audit and
  shown to reviewers. Clock skew beyond a threshold (A-OFF-05: 10 minutes) is flagged, not
  fatal.
- Replay is idempotent at the server even if the client resends a batch after a lost
  response.

### 4.1 Retry policy

Plain language: the phone keeps trying to send its queue on a slowing schedule as long as the
problem is the connection. If the server has actually looked at a command and said no, the
phone stops retrying that command and shows it as a conflict for a supervisor. Nothing is
retried forever and nothing is ever posted twice.

| Rule | Behaviour | Setting / assumption |
|---|---|---|
| Flush triggers | `online` event, visibility change (tab/app foregrounded), manual "Sync now", periodic timer while online (every `retry_schedule` tail interval); a flush sends the queue head-first in batches of up to 50 | — |
| Transport failure (retried) | Request timeout (30 s), network error, HTTP 5xx, 429, or a lost response: the batch is resent **unchanged** (same ids and idempotency keys) at the next scheduled attempt; the server's stored results make the resend harmless | `settings.offline.retry_schedule` |
| Backoff schedule | After each failed attempt: 5 s, 30 s, 2 min, 10 min, 30 min, then every 30 min while online; each wait is jittered ±20 %; the schedule restarts from 5 s on an `online` event or manual "Sync now" | `settings.offline.retry_schedule` (A-OFF-08, default as listed) |
| Maximum attempts | A command whose transport attempts exceed `max_attempts` moves to device-side status `failed` and stops the periodic timer for that command; a manual "Sync now" resets `attempts` to 0 once per tap. Because the server never saw the command, no `sync_conflicts` row exists; the sync panel on the device lists it under "Could not reach the server", and the site's device list shows the stale `device_registrations.last_sync_at` (`docs/data-model.md` §11.1) so a supervisor can intervene | `settings.offline.max_attempts` (A-OFF-08, default 20) |
| Server rejection (not retried) | HTTP 200 with per-command status `rejected` or `conflict`, or HTTP 4xx other than 429 for the batch: the command is terminal on the device (`conflict`), the server has created the `sync_conflicts` row (section 5) and the command is **never resent**; a corrected re-apply is a new command with a new id and key | — |
| Ordering | FIFO per device is preserved on retry: the head command is attempted first; a command with `dependsOn` pointing at a rejected command is marked `conflict: dependency_failed` locally and is not sent | — |
| Maximum queue age | A command whose `client_created_at` is older than `max_queue_age_hours` at flush time is still sent, but the server rejects it with reason `auth_snapshot_expired` (its snapshot is by definition older than the 12 h validity, A-OFF-02) and routes it to conflict review, where a reviewer may re-apply it after the user has re-authenticated. The device warns before the limit is reached ("Sync within N h or these changes will need review"). `max_queue_age_hours` must be ≥ `auth_snapshot_max_age` | `settings.offline.max_queue_age_hours` (A-OFF-09, default 72 h); closes the "Device offline for days" exception in `docs/process-maps.md` W02 |
| Give-up is never silent | Every `failed` or `conflict` outcome is shown in the sync panel with the server's `errorMessage` or the last transport error, and nothing is removed from the outbox until the user has seen it (logout warning in section 6, A-OFF-06) | — |

### 4.2 Status mapping

| Device-side outbox `status` | Meaning on the device | Server `sync_commands.status` (`docs/data-model.md` §11.2) |
|---|---|---|
| `pending` | queued, not yet sent, or waiting for the next retry attempt | no row yet |
| `syncing` | sent, response not yet received | `received` |
| `synced` | server applied it; the "Pending sync" chip disappears | `applied` |
| `failed` | transport attempts exhausted (section 4.1); retry on manual "Sync now" | no row (the server never saw it) |
| `conflict` | server rejected or conflicted it; a `sync_conflicts` row exists | `rejected` or `conflict` |
| — (device shows the resolution outcome) | a reviewer replaced it with a new command (`resolution_command_id`) | `superseded` |

## 5. Conflict review

A `sync_conflicts` record (`docs/data-model.md` §11.3) is created for every rejected or
conflicted command with: device (`device_registration_id`), user, site, command type, the
payload as sent (`client_state`) and the current server snapshot of the related record
(`server_state`), `reason_code` from the catalogue (`validation_failed`, `permission_denied`,
`site_not_allowed`, `state_changed`, `stock_not_eligible`, `insufficient_stock`,
`out_of_tolerance`, `wrong_lot`, `duplicate_key_mismatch`, `dependency_failed`,
`auth_snapshot_expired`, `session_revoked`, `count_closed`, `other`) plus a human-readable
`reason_message`, related record (`related_entity_type`, `related_entity_id`,
`related_entity_number`), created time, status (`open`, `resolved_applied`,
`resolved_discarded`, `resolved_amended`, `escalated`), `resolved_by`, `resolved_at`,
`resolution_note` (required on every resolution), `resolution_command_id` (the new command
created for re-apply or amend) and `escalated_entity_type` / `escalated_entity_id`
(`deviation` or `stock_adjustment`).

- Reviewers (site_manager, or the module's supervisor role) see the queue in the action
  centre; the originating user sees their own conflicts on the device.
- Resolution options are explicit: re-apply with corrected data (creates a **new** command
  recorded in `resolution_command_id`, audited; status `resolved_applied` or
  `resolved_amended`), discard with reason (`resolved_discarded`), or escalate to a
  deviation (production) or stock adjustment with approval (inventory), which sets status
  `escalated` and the `escalated_entity_*` columns. The original command is never silently
  applied; when a resolution command replaces it, the original `sync_commands` row becomes
  `superseded`.

## 6. Security on the device

- Secrets never live in the PWA. The session cookie is HttpOnly; the local store holds only
  business reference data for assigned sites and the user's own queued commands.
- IndexedDB is encrypted at rest only where the platform does it (iOS/Android app storage);
  the web app additionally limits what it caches (no payroll, pricing, cost or personal data
  offline) rather than promising encryption it cannot guarantee.
- Logout, device removal by an admin, or session revocation clears the local store on next
  app open; queued commands that were not synced are listed to the user before clearing and
  exported to a support bundle if the user requests it (A-OFF-06).
- Registered devices (entity Device, table `device_registrations`, `docs/data-model.md`
  §11.1, with `device_class` and `allowed_offline_workflows` per device) are required for
  dispensing, process steps, counting, receiving and pick/pack offline; anonymous browsers
  get cached reads and movement requests (`movement_request`) only.

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
- Every queued record displays a "Pending sync" chip in its list and detail until applied;
  the chip and the sync panel follow the device-side statuses and retry rules in sections
  4.1 and 4.2 (`failed` shows "Could not reach the server, N attempts, retrying…" or "Tap
  Sync now"; `conflict` shows the server's reason and links to the conflict; a queue
  approaching `max_queue_age_hours` shows a countdown warning).
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
| A-OFF-08 | Retry schedule and maximum transport attempts per command (`settings.offline.retry_schedule`, `settings.offline.max_attempts`) | 5 s, 30 s, 2 min, 10 min, 30 min, then every 30 min (jittered ±20 %); 20 attempts | IT |
| A-OFF-09 | Maximum queue age before a command needs re-authentication and conflict review (`settings.offline.max_queue_age_hours`; must be ≥ A-OFF-02) | 72 h | IT / site managers |
| Q-OFF-01 | Which areas actually lack connectivity, and for how long? | — | IT / site managers |
| Q-OFF-02 | Are devices shared between operators or individually assigned? (affects device registration and re-auth) | — | site managers |
| Q-OFF-03 | Are managed tablets (MDM) available for dispensing stations? | — | IT |
