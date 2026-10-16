# Operations runbook

Owner: `devops-engineer` (with `principal-architect`; security procedures reviewed by
`security-engineer`). Status: Proposed for Gate 0; rehearsed in Phase 1 (admin procedures),
Phase 2 (jobs, reconciliation), Phase 5 (imports), Phase 7 (sync), Phase 9 (restore,
incidents). Companion documents: `docs/deployment-railway.md` (platform, backups, rollback),
`docs/security.md` (access, audit, incident hooks), `docs/permissions-matrix.md` (who may do
what), `docs/offline-sync.md` (conflict rules), `docs/process-maps.md` (business workflows).

For owners: this is the "what do we do when" book. Each procedure says who may do it, what
to click, what gets recorded, and when to stop and call someone. For engineers: it fixes the
permission strings, audit events, job names and commands used, so the diagnostics page and
the admin screens must match it. Access and audit rules are not restated here; the relevant
`docs/security.md` section is cited instead. Every `A-OPS-nn` is an assumption listed in
section 20 that needs owner confirmation.

## 1. Who does what

| Role in operations | System role / permission | Responsibilities | Named person (owner fills in) |
|---|---|---|---|
| Owner | `owner_director` | gate approvals, approval-rule changes (`platform.approval_rule.admin`), incident sign-off, holds the backup private key (copy 1) | |
| Operations contact | Railway production member; `system_admin` | production variables, secrets rotation, restores, backup key (copy 2), deploy promotion reviewer (A-OPS-01) | |
| System administrator | `system_admin` | users, roles, assignments, settings, numbering, jobs, imports, diagnostics, L2 support | |
| Site manager | `site_manager` | L1 support on the floor, sync conflict review, count/adjustment approvals, printer and scanner first checks | per site |
| QA/QC | `qa_qc` | revision approvals, dispositions, BMR reprint awareness, quality incident calls | |
| Engineering (L3) | repository maintainers | code fixes, migrations, restore execution with the operations contact | |

Two-person rules: production variable changes, restores, secrets rotation and manual
database sessions are performed by one person and witnessed by a second (owner or
operations contact), and both are named in the log entry (appendix A).

## 2. Routine administration

Account states, token lifetimes, lockout and session rules are defined in
`docs/security.md` section 3 and are not repeated. Admin screens: `docs/ux-system.md` 9.10.

### 2.1 Invite a user

1. Admin → Users → Invite (`identity.user.create`, `identity.invitation.create`). Enter
   work email, display name, initial role and site(s). Organization-wide assignment is
   only offered for `owner_director`, `system_admin`, `auditor`.
2. The invitation email carries a 72-hour single-use link (`docs/security.md` 3.8). If it
   expires, use Resend; the old link dies.
3. The user sets a password (and TOTP if the role requires it) and becomes `active`.
4. Recorded: `identity.user_created`, `identity.invitation_sent`, `identity.assignment_granted`.
5. Shared floor devices: the person signs in with personal credentials; no shared accounts
   (`docs/security.md` 8.2 item 4).

### 2.2 Assign roles and sites

1. Admin → Users → user → Site assignments (`identity.site_assignment.admin`, restricted:
   re-authentication and TOTP apply, `docs/security.md` 3.6, 3.7).
2. Add a row per (site, role); set `valid_to` for temporary cover. The grid shows
   separation-of-duties warnings when one person would both submit and approve the same
   record type (`docs/permissions-matrix.md` section 5).
3. The user's cached permissions refresh within 60 seconds; offline devices re-authenticate
   on next sync (`docs/permissions-matrix.md` 4.3).
4. Granting a role with restricted permissions starts the 7-day TOTP enrolment grace
   (A-SEC-13); tell the user.
5. Recorded: `identity.assignment_granted` / `identity.assignment_revoked` /
   `identity.assignment_scope_changed`; restricted grants appear in the owner's weekly
   access report.

### 2.3 Change a role's permissions

Built-in roles are read-only. Clone to a custom role (`identity.role.admin`), edit with a
change reason, test on staging with a seeded user, then grant. Recorded:
`identity.role_created` / `identity.role_updated` with the permission diff and sensitivity.
`system_admin` can never hold quality release, finance posting or payroll permissions, and
the screen refuses such grants (`docs/security.md` 2.11).

### 2.4 Lock, unlock, password reset

| Situation | Action | Permission | Recorded |
|---|---|---|---|
| Suspected misuse | Users → Lock (reason) | `identity.user.admin` | `identity.user_locked` |
| Auto-lockout after failed sign-ins | wait for the timer or Unlock after verifying identity | `identity.user.admin` | `auth.unlocked` |
| Forgotten password | user uses "Forgot password" (30-minute link); admin may trigger "Force reset" which sends the same link and revokes other sessions; admins never set or see passwords | `identity.user.admin` | `auth.password_reset_requested` |
| Email changed | user starts from Profile with re-authentication; admin edits only with `identity.user.edit` and a reason | | `identity.user_updated` |

### 2.5 MFA (TOTP) reset

1. Verify identity in person or on a video call with the site manager present (A-OPS-03);
   write who verified in the reason field.
2. Users → Security → Reset MFA (`identity.mfa.admin`). The user re-enrols at next sign-in;
   privileged actions are blocked until then.
3. Recorded: `auth.mfa_reset`; the user is notified by email.

### 2.6 Revoke sessions and lost devices

1. Users → Sessions → Revoke one (`identity.session.void`) or Sign out everywhere
   (`identity.user.admin`). The device fails its next request.
2. Lost or stolen device: additionally discard its outbox server-side
   (`platform.sync_command.void`, Phase 7), remove push subscriptions, mark the device in
   the device register. Evidence per `docs/security.md` 8.3 ("Lost or stolen device").
3. Recorded: `auth.session_revoked`, `auth.sessions_revoked_all`, `offline.outbox_discarded`.

### 2.7 Deactivate and offboard (checklist)

Trigger: HR notice or role change. Target: same working day; before the end of the last shift
for floor staff (A-OPS-05). Deactivation keeps the user row for audit attribution; nothing is
deleted.

1. Users → Deactivate with reason (`identity.user.admin`). The system revokes all sessions,
   invitation and reset tokens, scheduled-report subscriptions and portal links
   (`docs/security.md` 3.9).
2. Reassign open work: pending approvals where the person is the only approver, open work
   orders or counts assigned to them, scheduled reports they own, alert recipient lists.
3. Devices: if a personal phone was used, confirm the app was signed out (cache cleared on
   next open); if a shared device, nothing to do.
4. Records: export nothing; their history stays attributed to them.
5. Recorded: `identity.user_deactivated`; the weekly access report lists the deactivation.
6. Reactivation (returning staff) uses `identity.user.admin` with a reason
   (`identity.user_reactivated`); assignments are re-granted explicitly, never restored
   automatically.

### 2.8 Structure changes

Sites, departments, warehouses, lines (`masterdata.*.admin`), special locations
(`masterdata.location.admin`) and equipment blocking rules (`masterdata.equipment.admin`)
are changed on staging first, then on production with a reason. A location is deactivated,
never deleted; a location holding stock cannot be deactivated until moved. Recorded:
`masterdata.site_changed`, `masterdata.location_special_designated`,
`masterdata.equipment_blocking_rule_changed`.

## 3. Master data and revision approvals

Revisions (formula, routing, work instruction, inspection plan, label and document
templates) follow `docs/process-maps.md` W12 and `docs/data-model.md` section 4. The
administrator supports the flow but never approves quality-relevant revisions.

| Task | Who | Permission | Rule |
|---|---|---|---|
| Draft a revision | author | `masterdata.formula.{create,edit,submit}` and equivalents | tolerance required on every BOM line; no system default |
| Review | reviewer ≠ author | `masterdata.*.view` | checklist in W12-03 |
| Approve with effective date | per `approval_rules` (default: `qa_qc` then `site_manager`/`owner_director`) | `masterdata.formula.approve` (restricted), `masterdata.routing.approve` | approver ≠ author ≠ reviewer where staffing allows |
| Approve template versions | `qa_qc` for BMR/dispensing sheet; `site_manager` for DR/pick list | `documents.template.approve`, `masterdata.label_template.approve` | print the test page on the real printer before approval (`docs/ux-system.md` 10) |
| Retire a revision | approver | `masterdata.formula.void`, `documents.template.void` | obsolete, never delete; old BMRs still render with their snapshot |

Administrator checks before an approval is released to production: open batches that will
keep the old revision are listed and understood by production; the effective date is not in
the past; label templates were printed and scanned. Recorded: `masterdata.formula_approved`
and siblings. Never edit an effective revision in the database; a wrong approval is fixed by
a new revision.

## 4. Numbering rule changes

Numbering rules (`numbering_rules`, ADR-009) are versioned, per site and document type, and
changes apply to future numbers only (`docs/security.md` 2.11).

1. Confirm the request with the process owner (production/QA for batch and lot numbers;
   sales for SO/DR; procurement for PO/GR) and that the new pattern keeps numbers unique
   per organization.
2. On staging, create a new version with the new pattern and an effective date
   (`platform.numbering_rule.admin`, restricted). Issue 20 numbers through the test
   command (PRD S1-13) and check they are distinct, consecutive and sortable.
3. On production, create the same version with the agreed effective date. Sequences never
   go backwards; a `reset period` change takes effect at the next period boundary.
4. Legacy paper numbers from before go-live live in `legacy_number` fields
   (`docs/data-migration-plan.md`); they are never re-issued.
5. Recorded: `platform.numbering_rule_changed` with before/after; note in appendix A.

## 5. Settings and approval rules

`platform.settings.admin` (system administrator) changes session policy, offline policy,
alert thresholds, retention policies and feature switches; `platform.approval_rule.admin`
(owner only) changes approval thresholds and separation-of-duties rules
(`docs/permissions-matrix.md` 5.2). Both are restricted actions, versioned with actor and
reason, and recorded as `platform.settings_changed` / `platform.approval_rule_changed`. Try
every change on staging first; business rules marked "qualified reviewer" in
`approval_rules.reviewed_by` are not changed without that reviewer's sign-off.

## 6. Failed background jobs

Jobs run in the worker (ADR-015; `docs/deployment-railway.md` 2.2). A job that fails five
times is dead-lettered and raises the failed-jobs alert (`docs/deployment-railway.md` 8.3).

1. Diagnostics → Jobs (`platform.job.view`): filter `failed` and `dead`; open the job to see
   kind, payload summary (no secrets), attempts, last error, `correlationId` and the
   originating user.
2. Classify: **transient** (timeout, connection reset, bucket 5xx) → Retry
   (`platform.job.admin`, recorded `platform.job_retried`); **poison** (payload invalid,
   referenced record deleted or in a state that no longer allows the action) → Cancel with
   reason (`platform.job_cancelled`) and tell the originating user; **bug** → open an
   incident S3 (section 12), capture the `correlationId`, escalate to L3.
3. Jobs are idempotent and keyed, so a retry never duplicates a posting; if a retry would be
   unsafe for business reasons (for example the batch has since been reopened), cancel.
4. Never re-run a job's effect by hand with SQL.

| Job kind | Typical failure | Action |
|---|---|---|
| PDF generation (BMR, dispensing sheet, DR, pick list) | renderer disabled (`PDF_RENDERER=disabled`), Chromium out of memory | configure renderer (Phase 3); retry once; if memory, report under ADR-016 |
| Label batch | template version retired | regenerate from the current approved template |
| Import processing | malformed file, mapping mismatch | section 7 |
| Scheduled report | recipient lost permission (dropped, listed in audit), query timeout | fix recipients; narrow filters |
| Notification / email | `EMAIL_PROVIDER=none`, SMTP rejected | configure provider; retry |
| `inventory.reconcile` | none expected; differences are not failures | section 9 |
| Expiry and FEFO scan | long run | retry off-peak |
| `platform.partition_maintenance` | partition exists | safe to retry; if the audit `DEFAULT` partition is non-empty, incident S2 |
| `platform.backup_dump` | bucket or key error | section 13.5; backup-age alert follows |
| `platform.metrics_sample`, `platform.alerts_evaluate` | database busy | retry; if repeated, capacity incident |
| Sync replay (Phase 7) | conflicts are not failures | section 8 |

## 7. Failed or partial imports

ImportJob states: `uploaded → validated → under_review → posted | rejected | failed`
(`docs/data-model.md` 3.10); attendance imports additionally follow W10 in
`docs/process-maps.md`. Nothing is posted until an authorised person posts; ambiguous rows
are never posted silently (AC-19).

| Situation | What you see | Action | Permission | Recorded |
|---|---|---|---|---|
| `failed` during parse | status `failed`, error summary, original file kept | download the error file; fix the source file or create a new mapping version; upload again (same checksum requires a re-run reason) | `platform.import_job.create`, `hr.attendance_import.create` | `platform.import_posted` only on later success |
| Rows rejected in preview | counts: ok / duplicate / unknown / invalid | resolve each exception type explicitly (map unknown id, confirm duplicate, request correction, reject with reason) | `platform.import_job.submit`, `hr.attendance_import.edit` | `hr.attendance_exception.resolved` |
| Posted with rejected rows ("partial") | status `posted` with rejected count > 0 | rejected rows stay listed; a follow-up import of the corrected rows is normal; never edit `import_job_rows` | `platform.import_job.post`, `hr.attendance_import.post` | `platform.import_posted` |
| Wrong file posted | – | Reverse the import: reversal events for every created record with reason; original file and rows retained | `platform.import_job.void`, `hr.attendance_import.*` per W10-08 | `platform.import_reversed`, `hr.attendance_import.reversed` |
| Suspicious or malicious file | virus scan flag or odd content | void the import, mark the attachment blocked, follow `docs/security.md` 8.3 | `platform.import_job.void`, `platform.file.admin` | |

Attendance events already used by an approved payroll period need `finance` plus
`hr_payroll` approval to reverse (Phase 6). Failed import jobs are kept 90 days before
archival (A-OPS-09); original files follow `docs/security.md` section 7.

## 8. Sync conflict queue (Phase 7)

Rules are in `docs/offline-sync.md` sections 4 and 5; this is the operating routine.

1. Action centre → Sync conflicts (`platform.sync_conflict.view`): each row shows device,
   user, site, command type, payload summary, server reason (for example `lot_on_hold`,
   `insufficient_stock`, `dependency_failed`, `time_skew`), and the related record.
2. The reviewer (`site_manager` or the module's supervisor role) chooses one resolution
   (`platform.sync_conflict.approve`): **re-apply with corrected data** (creates a new,
   online command), **discard with reason**, or **escalate** to a deviation (production) or
   a stock adjustment with approval (inventory). The original command is never applied as-is.
3. `dependency_failed` conflicts are resolved after their parent; the queue shows the chain.
4. `time_skew` flags are informational: the server time stands; note the device in the
   device register if it recurs.
5. Target: conflicts resolved within one working day; older than two days escalate to the
   owner (A-OPS-08). The sync-backlog alert (`docs/deployment-railway.md` 8.3) fires at 20
   open conflicts.
6. Recorded: `offline.conflict_resolved` with the resolution choice; the originating user
   sees the outcome on the device.

## 9. Ledger-versus-balance reconciliation differences

The nightly job `inventory.reconcile` compares the stock ledger with the balance projection
(`docs/data-model.md` 5.6) and never corrects anything itself. Any difference is a critical
notification to `system_admin` and the site's `site_manager` and is handled as incident S2
(A-OPS-06).

1. Diagnostics → Reconciliation: read the difference rows (site, lot, location, container,
   ledger quantity, projected quantity) and the second-query results (quality status
   mismatch, reserved/allocated mismatch, container contents).
2. Freeze nothing yet; open the lot and list its movements since the last clean run
   (`inventory.movement.view`).
3. Find the cause:

| Likely cause | How to confirm | Correction |
|---|---|---|
| Projection update failed inside a posting (bug, crash mid-transaction should be impossible) | ledger sum ≠ projection; movements look complete and non-duplicated | enqueue `inventory.rebuild_balances` for the affected keys (recomputes projection rows from the ledger; audited; see note) |
| Duplicate posting (idempotency miss) | two movements with the same source document and quantity seconds apart | reversal of the duplicate with reason by the module approver (`inventory.movement.void`), then rebuild |
| Movement posted to a `blocked` or wrong location | `V-LOC` should have blocked it | reversal plus replacement movement; investigate the bypass as a bug |
| Manual database change | audit shows no command for the change | incident S1; `docs/security.md` 8.3; restore considerations (section 13) |
| Quality status drift | lot status ≠ balance status | rebuild for that lot; check the disposition that changed it |

4. Record the finding, the correction, the reversal ids and the rebuild job id in the
   incident register; inform the owner when the difference exceeds PHP 20,000 at standard
   cost or touches a released finished-goods lot (A-OPS-06).
5. Re-run `inventory.reconcile` on demand and confirm zero rows.

Note for the architect: `inventory.rebuild_balances` and the permission that may enqueue it
(suggested `inventory.balance.admin`, sensitivity S) do not exist in the data model or the
permissions matrix yet; see section 21.

## 10. Document reprint control

Generated documents keep template version, source revision, generator and reprint history
(`docs/data-model.md` 3.10; `docs/ux-system.md` 10).

| Rule | Detail |
|---|---|
| Who | `documents.reprint.create` (default: production and QA for BMR and dispensing sheets, warehouse and sales for DR and pick lists per the matrix) |
| How | Document → Reprint → reason code and note (mandatory) → the PDF renders with watermark `REPRINT n` and the reprint counter increments |
| Recorded | `documents.reprinted` (reason, template version, source revision, requester); listed on the document's history |
| BMR reprints | QA is notified of every BMR reprint by notification rule (A-OPS-07); paper copies are uncontrolled unless signed (wording validated by QA) |
| Superseded documents | when the source record changes after generation, the old document is marked superseded (`documents.generated_document.void`, `documents.superseded`); the superseded PDF stays downloadable with a SUPERSEDED watermark |
| Downloads | signed links expire in 5 minutes; every download is `documents.downloaded` (`docs/security.md` 4.8) |
| Review | the weekly access report lists reprint counts by document kind and user; unexplained spikes are reviewed by QA |

## 11. Label printer and scanner troubleshooting

First checks are done by the site manager (L1); printers are PDF-capable label printers
and documents print from the browser or a PDF (A-PRD-05, A-UX-04, A-OPS-13).

| Symptom | Check | Fix |
|---|---|---|
| Label prints blank or shifted | printer driver scaling set to 100 % / "actual size"; paper size in the driver equals the template size (50×30, 100×50, 100×150 mm); correct printer selected | reprint the template test page (`docs/ux-system.md` 10); fix driver; if the template is wrong, raise with QA/admin (new template version) |
| Barcode prints but will not scan | quiet zone ≥ 2 mm, darkness/heat setting, ribbon or stock mismatch, label too small for the payload | adjust printer darkness; use the larger template; symbology per label template (ADR-017) |
| Camera scanning does nothing | page served over HTTPS (camera is blocked on HTTP); browser camera permission granted; lens clean; lighting | allow camera in browser settings; `Permissions-Policy: camera=(self)` is set by the app; if `BarcodeDetector` is unsupported the app falls back to ZXing automatically |
| Scan reads but says "wrong item" | the step expects a different lot/box/location (`V-MAT`, `docs/process-maps.md` 1.5) | read the expected item shown; rescan; never override without the controlled exception |
| Scan reads but nothing happens on a USB/Bluetooth scanner | scanner configured to send Enter as terminator; keyboard layout; the scan field has focus | reconfigure scanner (vendor manual); tap the scan field; the app shows a focused-field indicator |
| Duplicate scan posted twice? | it cannot: repeated scans carry the same idempotency key and return the original result (`V-DUP`) | if two different movements exist, section 9 |
| Label text wrong (dates, status) | template version and data | fix data on the record (lot edit with reason), reprint; template errors go to a new version |
| Printer offline | network/USB, paper out | local IT; print later; labels can be queued as a label batch job |

Escalate to L2 when the test page is wrong on two printers, when scanning fails on all
devices of a site, or when a scan payload does not follow `BC:<TYPE>:<CODE>`
(`docs/security.md` 4.9).

## 12. Incident process

### 12.1 Severity

| Severity | Definition | Examples | Acknowledge | Owner informed |
|---|---|---|---|---|
| S1 | production unusable or data integrity at risk for a site | web or worker down, database unreachable, reconciliation difference from an unknown cause, suspected data leak | 15 min (A-OPS-02) | immediately; restricted-data incidents within 1 hour (`docs/security.md` 8.3) |
| S2 | major function degraded with workaround | PDF generation down, imports failing, failed backup, deploy failed, error rate alert | 1 hour | same day |
| S3 | minor function or single user affected | one printer, one account locked out, a report wrong | next business day | weekly summary |
| S4 | cosmetic or improvement | wording, layout | backlog | – |

### 12.2 Roles and timeline

Incident lead (system administrator or operations contact), communicator (keeps the status
message current), scribe (keeps the timeline). One person may hold all three for S3/S4.

1. **Detect**: alert, monitor, user report, diagnostics (section 17).
2. **Acknowledge** in the chat channel within the target; open an incident register entry
   (appendix A) with severity and lead.
3. **Triage**: diagnostics page, Railway deploy and service logs by `requestId`, error
   reporter, audit log (`platform.audit.view`). Preserve evidence before changing anything
   (`docs/security.md` 8.3 lists what to keep per security trigger).
4. **Mitigate**: rollback (`docs/deployment-railway.md` 11), `MAINTENANCE_MODE`, disable a
   feature switch, retry jobs, restore (section 13). Security triggers follow the first
   actions in `docs/security.md` 8.3 exactly.
5. **Communicate**: internal status every 30 minutes for S1, hourly for S2; message
   template: what is affected, since when, workaround, next update time.
6. **Resolve**: confirm with the reporter and the diagnostics page; record end time.
7. **Postmortem** for S1/S2 within five working days (A-OPS-10), blameless, owner receives
   the summary; actions become backlog items or document changes.

### 12.3 Postmortem template

```
Incident: <id> <title>            Severity: S<n>      Lead: <name>
Detected: <time, how>   Acknowledged: <time>   Mitigated: <time>   Resolved: <time>
Impact: sites, users, records affected; data lost or re-entered; RPO/RTO actually achieved
Timeline: <time> <event/decision> ... (from the scribe's notes and logs)
Root cause: technical and process causes (what allowed it, not who)
What went well / what went badly
Actions: <action> <owner> <due> <tracking id>   (code fix, test, alert, document change, training)
Evidence kept: request ids, audit event ids, job ids, backup object keys
Owner sign-off: <name, date>
```

## 13. Restore from backup (production)

Backup layers, their retention and the quarterly drill are in `docs/deployment-railway.md`
sections 9 and 10; roles and variables in sections 4 and 11. Restores are S1 incidents led
by the operations contact with a witness. Choose the layer:

| Need | Layer | Expected time |
|---|---|---|
| Undo recent row-level damage (minutes to 4 weeks ago) at an exact time | PITR to a new Postgres service (13.1) | 1–2 h |
| Roll the whole database back to a snapshot (hours to 3 months ago) | Railway volume backup on the same service (13.2) | 1 h |
| Railway project, volume or access lost; need a copy elsewhere | offsite encrypted dump (13.3) | 2–4 h |
| Bucket objects lost | bucket restore within 52 h, else offsite file copy (13.4) | 1–3 h |

Before any restore: (1) open the incident; (2) set `MAINTENANCE_MODE=1` on `web` and
redeploy so nothing is written; (3) scale `worker` to 0 replicas (jobs must not run against a
database that is about to change); (4) take a manual dump of the current state
(`node dist/backup.js --manual --label pre-restore`) so nothing is lost by the restore itself;
(5) write the target time or snapshot in the incident entry.

### 13.1 PITR

1. Determine the target timestamp from audit events (`occurred_at` of the first bad action
   minus one second) and logs; agree it with the owner.
2. Railway → Postgres service → Backups/PITR → restore to timestamp. Railway creates a new
   service `Postgres-restored-<date>`; the source keeps running untouched.
3. Through `railway connect <restored service>`: `SELECT count(*)` on `stock_movements`,
   `audit_events`, `batches`, `users`; inspect the damaged records; run the reconciliation
   query (`docs/data-model.md` 5.6) expecting zero rows; `node dist/migrate.js --check`.
4. Decide with the owner: **cut over** (steps 5–7) or **copy rows back** (an audited script
   reviewed by L3 that inserts the missing rows into the source database as reversal plus
   replacement, never as silent updates).
5. Cut over: point `DATABASE_URL`, `DATABASE_MIGRATION_URL` and `DATABASE_BACKUP_URL` on
   `web`, `worker`, `backup` to the restored service's private host (roles and passwords
   are inside the restored cluster); record the variable change in appendix A.
6. Redeploy `web`; `/api/ready` must be 200; unset `MAINTENANCE_MODE`; scale `worker` to 1;
   smoke: sign in, open a lot, a batch, the audit log, download a document.
7. Enable PITR and volume backup schedules on the restored service (a PITR fork is not
   archiving by itself), disable the TCP proxy, keep the old service for 7 days, then delete.
8. Re-enter lost work: list audit events in the old database between the target time and
   the incident; business owners re-enter through the app; idempotency keys stop clients
   from double-posting when they retry queued commands.

### 13.2 Volume backup

1. Steps "before any restore"; choose the snapshot in the Backups tab; Restore stages a new
   volume; Deploy applies it (brief downtime; backups newer than the chosen one are removed,
   so the pre-restore manual dump from the preparation step is the only copy of the newer
   state).
2. Verify as in 13.1 step 3; bring `web` and `worker` back as in 13.1 step 6.
3. Re-enter lost work as in 13.1 step 8 using the pre-restore dump restored into a scratch
   database on staging for reference.

### 13.3 Offsite encrypted dump

1. Provision Postgres 16 (Railway service or elsewhere); run `pnpm db:bootstrap-roles` (a
   logical dump does not contain roles); disable the TCP proxy afterwards.
2. From the offsite bucket download the chosen `db-<timestamp>.dump.age` and verify
   `sha256sum` against `backup_runs` (or the object metadata if the database is gone).
3. Decrypt with the offline private key: `age -d -i backup-key.txt db.dump.age > db.dump`
   (two key holders: owner and operations contact).
4. `pg_restore --no-owner --role=bc_migrate --exit-on-error --jobs=4 --dbname=<url> db.dump`,
   then `node dist/migrate.js --check` and apply newer migrations if the release moved on.
5. Grants: run the grants script from the bootstrap (`bc_app`, `bc_readonly`, `bc_backup`),
   verify with `\dp` that ledger and audit tables are insert-only for `bc_app`.
6. Variables, redeploy and smoke as in 13.1 steps 5–6; the worker recreates the `pgboss`
   schema on first start; jobs in flight at dump time are re-enqueued by their owners
   (A-DEP-20).
7. Re-enter up to 24 hours of work (the dump RPO); the owner is informed of the exact gap.
8. Enable volume backups, PITR and the `backup` cron on the new service; verify the next
   dump succeeds.

### 13.4 Bucket objects

Deleted bucket: restore from the project's Activity feed within 52 hours
(`docs/deployment-railway.md` 11). Otherwise run `node dist/backup.js --files restore
--since <date>` to copy objects back from the offsite bucket; `file_attachments.checksum_sha256`
verifies each object; missing objects are listed and their records flagged "file missing".

### 13.5 After every restore

Record in the incident register and the restore record (appendix A): layer used, backup
identity, timings (measured RTO), data gap (measured RPO), verification results, who did
and witnessed it, re-entered work. Run `inventory.reconcile` on demand. Review the backup
alerts: a failed `platform.backup_dump` is fixed the same day (bucket credentials, key,
disk), and the next scheduled run is watched.

## 14. Migration failure recovery

Procedure and rules: `docs/deployment-railway.md` section 5. Detection: the Railway deploy
fails (webhook to chat), the deploy log contains the migrator's output.

| Error class | Recovery |
|---|---|
| SQL error in a transactional file | nothing applied from that file; fix forward with a corrected **new** migration (the failed file is removed in the same PR if it was never applied anywhere; it is never edited once applied on any environment) |
| Constraint violated by existing data | write a data-fix migration (expand) first, then the structural change; test on a production-shaped staging database (restore drill copy) |
| Lock timeout / long-running `ALTER` | re-run in the maintenance window (A-DEP-14) or split into batches with `-- transactional: false` |
| Pre-deploy timeout (900 s) | split the migration; backfills move to a worker job |
| Destructive migration refused | follow `docs/deployment-railway.md` 5.3 (manual dump, volume snapshot, `MIGRATION_ALLOW_DESTRUCTIVE=1` for one deploy, then remove) |
| Advisory lock stuck (`bc-migrate` session idle) | `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'bc-migrate' AND state = 'idle';` through `railway connect`, witnessed; redeploy |
| Migration applied, new code fails healthcheck | previous code keeps running on the new schema; fix forward; roll back code only if the expand rule was honoured (`docs/deployment-railway.md` 11) |
| Migration applied and data is wrong | section 13 (PITR to just before the deploy, or manual pre-migration dump) |

Manual SQL on production is break-glass only: reviewed script, two people, `bc_migrate`
session through the tunnel, output saved, appendix A entry, and an audit event written by
the script itself where it changes business data (reversal plus replacement, never updates).

## 15. Secrets rotation

Policy, variable groups and the 180-day cadence (A-SEC-22) are in `docs/security.md` section
6; the variable table is `docs/deployment-railway.md` section 4. Rotation is done on staging
first, then production, by the operations contact with a witness, and logged in appendix A
(names and dates only, never values). Emergency rotation after exposure follows
`docs/security.md` 8.3 ("Secret exposure") first, then this table.

| Secret | Method | User impact | Window |
|---|---|---|---|
| `SESSION_SECRET`, `CSRF_SECRET` | move current value to `*_PREVIOUS`, set a new value, redeploy `web`/`worker`; after 24 h clear `*_PREVIOUS` | none during the dual-key window; emergency rotation without the window signs everyone out | 24 h |
| `FILE_URL_SECRET` | replace, redeploy | links older than 5 minutes are invalid anyway | immediate |
| `DATA_ENCRYPTION_KEY` | set new `k<n+1>:…` as current and old as `_PREVIOUS`; run job `platform.reencrypt` until all rows carry the new key id; clear `_PREVIOUS` | none | hours |
| `AUTH_PEPPER` (if enabled) | enabling or rotating requires re-hash on next login; keep the old pepper as `_PREVIOUS` until all active users have signed in; owner decides when to force resets for the rest | some users forced to reset | weeks |
| Database passwords (`bc_app`, `bc_migrate`, `bc_backup`) | `ALTER ROLE … PASSWORD` via the tunnel; update the variable; redeploy the service(s); confirm `/api/ready` | seconds of connection errors during redeploy | immediate |
| Railway bucket credentials | rotate from the bucket's Credentials tab if supported (verify with V-19 in `docs/deployment-railway.md` 15); variable references update automatically; redeploy | none | immediate |
| Offsite bucket keys | create new key at the provider, update variables on `backup`, run a manual dump, delete the old key | none | immediate |
| `SMTP_URL`, `ERROR_REPORTING_DSN`, `ALERT_WEBHOOK_URL` | replace at provider and in variables; send a test | none | immediate |
| `PAYMONGO_*` (Phase 8) | provider rotation; webhook secret with overlap per provider instructions | none | provider |
| Backup `age` key pair | generate a new pair; set the new public key on `backup`; keep the old private key offline until every dump encrypted with it has passed retention (13 months); drill with the new key | none | 13 months overlap |
| GitHub `RAILWAY_TOKEN` (staging CI) | create a new project token, update the GitHub secret, revoke the old | none | immediate |
| Railway and GitHub accounts | enforce 2FA; review members quarterly (section 18) | | |

Procedure: (1) announce in the ops channel; (2) staging rotation and smoke; (3) production
rotation with witness; (4) verify readiness, sign-in, a document download, a backup run as
applicable; (5) appendix A entry with next due date.

## 16. Support escalation and on-call (assumptions)

| Tier | Who | Handles | Hours (A-OPS-01) | Response target (A-OPS-02) |
|---|---|---|---|---|
| L1 | site key user / `site_manager` | how-to, printer and scanner first checks (section 11), conflict review, access requests | shift hours | immediate |
| L2 | `system_admin` | accounts, roles, jobs, imports, numbering, settings, diagnostics triage, incidents S2–S4 | Mon–Sat 07:00–19:00 Asia/Manila | S2 1 h, S3 next business day |
| L3 | engineering maintainers | code defects, migrations, restores with the operations contact, S1 | business hours; S1 best effort within 2 h outside hours | S1 15 min acknowledge in hours |
| Platform | Railway support (plan-dependent), provider support | platform outages | per provider | – |

Rules: one support channel (shared mailbox or chat channel, A-OPS-12) with a ticket id per
request; restricted data (payroll, personal data) is never sent over chat; every request
includes time, user, site, screen, `requestId` from the error banner, and a screenshot; the
support channel is checked at the start of every shift. No 24/7 on-call is assumed; if
night-shift production needs it, the owner decides the arrangement (open question 3).

## 17. Using the admin diagnostics page

Diagnostics (`platform.diagnostics.view`: owner and system administrator) shows health
booleans, counts, versions and names only; it never renders variable values or connection
strings (`docs/security.md` 2.11), and its data comes from `docs/deployment-railway.md`
sections 6 and 8.

| Card | Shows | Use |
|---|---|---|
| Health | `web`/`worker` ready, release, uptime, worker heartbeat age, migrations current | first look in any incident; a stale heartbeat means the worker is down |
| Database | size and growth, connections used, largest tables, PITR/backup schedule status (names) | capacity alerts; before destructive migrations |
| Jobs | queued/running/failed/dead by kind; retry and cancel (`platform.job.admin`) | section 6 |
| Imports | failed and under-review ImportJobs | section 7 |
| Sync (Phase 7) | pending commands, oldest age, open conflicts by site | section 8 |
| Reconciliation | last run, difference count, link to rows | section 9 |
| Backups | last dump time and age, offsite copy ok, last restore drill, next due | sections 13 and 18 |
| Alerts | active and recently resolved alerts with thresholds | severity and routing |
| Errors | counts last 24 h by module, top request ids (link to the error reporter) | triage |
| Integrations | configured / setup required per adapter (email, storage, PDF renderer, error reporting, payments) | never values |
| Variables | allow-listed variable **names** present or missing per service | after variable changes |

Five-step triage: (1) Health card, (2) Alerts card, (3) Jobs and Errors for the time of the
report, (4) copy the `requestId` into the Railway log search and the audit log, (5) decide
severity and open the incident entry.

## 18. Periodic checklists

| Cadence | Who | Items |
|---|---|---|
| Daily (5 min) | `system_admin` | diagnostics Health, Alerts, Jobs dead-letter count = 0, Backups age < 26 h, Imports under review |
| Weekly | `system_admin`, owner | read the access-and-exceptions report (`docs/security.md` section 5); clear failed jobs and old conflicts; review reprint counts; deploy log complete |
| Monthly | operations contact | backup verification: pick one random dump, download from offsite, verify SHA-256, decrypt, `pg_restore --list`; review database growth vs volume; cost review (`docs/deployment-railway.md` 13) |
| Quarterly (first week of Jan/Apr/Jul/Oct, A-OPS-11) | operations contact, owner, `system_admin` | **restore drill** per `docs/deployment-railway.md` 10 with the evidence row; **access review**: every `user_site_assignments` row confirmed by the site manager and owner, restricted-permission holders listed and justified, TOTP enrolled for all privileged users, accounts without sign-in for 90 days locked and for 180 days deactivated (A-OPS-04), Railway and GitHub members reviewed; **backup verification** of one monthly and one daily dump; secrets rotation due dates checked (section 15); alert thresholds and recipients confirmed; device register reviewed; retention policies and legal holds reviewed with QA and finance; this runbook and the deployment document re-read against the dashboard |
| Annual | owner | independent security test (`docs/security.md` 8.2); full disaster-recovery rehearsal from the offsite dump into a fresh project (section 13.3) with measured RPO/RTO; incident register review; training refresh |

## 19. Appendix A: operational logs (templates)

Logs live in this repository as `docs/ops-log/*.md` (one file per log, names and dates only,
never secret values) and are updated in the same PR as the change they record (A-OPS-15).

| Log | Columns |
|---|---|
| Deployment log | date/time, environment, commit, migrations applied, promoted by, reviewer, result, rollback (y/n), notes |
| Production variable change log (`docs/security.md` section 6) | date, environment, service, variable name, change type (add/rotate/remove), by, witness, reason, ticket |
| Rotation log (A-SEC-22) | secret name, rotated on, by, witness, method, next due |
| Restore drill record (`docs/deployment-railway.md` 10) | date, operator, witness, backup object key, SHA-256 ok, dump age, decrypt ok, restore duration, migrate check, row counts match, reconciliation zero, smoke ok, measured RTO, findings, owner sign-off |
| Incident register | id, opened, severity, title, lead, affected sites, mitigated, resolved, postmortem link, actions open/closed |
| Break-glass log | date, environment, who, witness, reason, script reference, output saved at |

## 20. Assumptions (need owner confirmation)

| Id | Assumption (default chosen) | Configurable | Confirm with |
|---|---|---|---|
| A-OPS-01 | Operations contact may be an external person; L2 support hours Mon–Sat 07:00–19:00 Asia/Manila; no 24/7 on-call | staffing | owner |
| A-OPS-02 | Response targets: S1 acknowledge 15 min in hours (best effort 2 h outside), S2 1 h, S3 next business day, S4 backlog | `settings.alerts.*` and policy | owner |
| A-OPS-03 | MFA reset requires identity verification in person or by video with the site manager present | policy | owner, security |
| A-OPS-04 | Accounts with no sign-in for 90 days are locked at the quarterly review and deactivated at 180 days unless the owner exempts them | `settings.identity.dormant_*` | owner, HR |
| A-OPS-05 | Offboarding the same working day as HR notice; before end of last shift for floor staff | policy | HR |
| A-OPS-06 | Any reconciliation difference is S2; the owner is informed above PHP 20,000 at standard cost or for any released finished-goods lot | `settings.alerts.reconciliation_owner_threshold` | owner, finance |
| A-OPS-07 | QA is notified of every BMR reprint | notification rule | QA |
| A-OPS-08 | Sync conflicts resolved within one working day; escalation to the owner after two days | `settings.offline.conflict_sla_hours` | site managers |
| A-OPS-09 | Failed ImportJobs kept 90 days before archival; original files per retention policy | `retention_policies` | HR, owner |
| A-OPS-10 | Postmortem within five working days for S1/S2; owner receives the summary | policy | owner |
| A-OPS-11 | Quarterly checklist in the first week of January, April, July and October; first restore drill before Gate 9 | calendar | owner |
| A-OPS-12 | One support channel with ticket ids; no restricted data over chat | policy | owner, IT contact |
| A-OPS-13 | Printers accept PDF or raster output; no vendor printer language in the MVP | templates | IT contact |
| A-OPS-14 | "Degraded" = any S2 alert active; "down" = `/api/ready` or worker heartbeat failing; shown on the diagnostics Health card | – | – |
| A-OPS-15 | Operational logs are markdown files under `docs/ops-log/` in the repository (names and dates only) | location | owner, security |

## 21. Open questions and items for other documents

1. Owner: name the operations contact, the L2 system administrator(s) and the per-site L1
   key users (section 1).
2. Owner: confirm support hours and whether night-shift production needs after-hours cover
   (A-OPS-01, A-OPS-02).
3. QA: confirm the BMR reprint notification rule and the "uncontrolled copy" wording.
4. Architect / database-architect: add job `inventory.rebuild_balances` (projection rebuild
   from the ledger for a key set, audited) and a permission to enqueue it (suggested
   `inventory.balance.admin`, S) to `docs/data-model.md` and `docs/permissions-matrix.md`;
   add job `platform.reencrypt` for `DATA_ENCRYPTION_KEY` rotation; add tables
   `backup_runs`, `restore_drills`, `metrics_samples`, `worker_heartbeats`,
   `reconciliation_runs` and a `devices`/`device_registrations` register reference (listed
   in `docs/deployment-railway.md` 17).
5. Architect: `docs/data-model.md` refers to sections §9 (numbering) and §11 (sync and
   devices) that do not yet exist; section 4 and section 8 of this runbook depend on them.
6. Security: the audit catalogue lacks `hr.attendance_exception.resolved` and
   `hr.attendance_mapping.saved` used by `docs/process-maps.md` W10 and section 7 here; and
   `platform.break_glass` for manual database sessions (section 14) would make the
   break-glass log verifiable from the audit trail.
7. Product: the diagnostics page (FR-platform-09) is scheduled for Phase 5 while Slice 1
   needs at least the Health, Backups and Variables cards for Gate 1 evidence; propose
   splitting FR-platform-09 into Phase 1 (health, backups, variable names) and Phase 5 (the
   rest).
