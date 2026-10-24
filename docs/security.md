# Security

Owner: security-engineer. Reviewers: principal-architect, devops-engineer, qa-test-engineer.
Status: Phase 0 draft for Gate 0. Binding ADRs: ADR-004 (sessions), ADR-005 (RBAC),
ADR-011 (tenancy), ADR-014 (Railway), ADR-018 (offline), ADR-022 (RLS, deferred).
Related: `docs/permissions-matrix.md` (who may do what), `docs/testing.md` (how it is proven),
`docs/deployment-railway.md` (where secrets live), `docs/operations-runbook.md` (incidents),
`docs/offline-sync.md` (replay rules), `docs/data-model.md` (tables).

Plain-language summary for owners: the system protects five things: the boundary between
sites, the truth of stock and batch records, quality evidence, money, and people's personal
and pay data. Each is protected by the same pattern: the server checks every action, writes a
permanent audit line for anything important, and automated tests try to break the rules on
every code change. Defaults below (timeouts, limits) are proposals marked `A-SEC-nn` until the
owner confirms them.

## 1. Objectives and assets at risk

| Asset | Why it matters | Primary threats | Main controls |
|---|---|---|---|
| Site boundaries | A user at one site must not see or change another site's stock, batches, people or documents | IDOR via ids in URLs, bodies, filters, exports; mis-scoped query | AuthContext + scoped repositories, 404 on out-of-scope ids, negative tests per module (`docs/permissions-matrix.md` section 8), RLS as defense in depth later (ADR-022) |
| Stock truth | Decisions, deliveries and costing rely on the ledger | Duplicate postings (retry, offline replay), concurrent double issue, edits of posted rows, issuing held stock | Idempotency keys, row locks, append-only ledgers (ADR-006), eligibility checks, reversal-only corrections |
| Quality evidence | Batch records, test results and dispositions are the basis for release and for any recall | Overwritten results, unauthorized release, lost evidence, tampered PDFs | Append-only corrections, QA-only disposition, stored template version + source revision, controlled reprint, audit |
| Money | Invoices, bills, payments, approvals; future online payments | Approval bypass, forged webhooks, altered amounts after approval, exfiltration of pricing | SoD, approval rules as data, immutable postings, period locks, signature-verified idempotent webhooks, masked pricing |
| Personal and payroll data | Employees' identities, bank details, pay; customers' contacts | Over-broad access, bulk export, logs leaking data, backups unencrypted | Restricted permissions with re-auth and TOTP, field masking, audited exports, encrypted backups, retention policy |
| Future public portal | First internet-facing surface with outside users and payments | Credential stuffing, tenant crossover, abuse, webhook replay | Separate auth boundary and tables, tenant-scoped context, stricter rate limits, Gate 8 security review |
| Availability of operations | Phones on the floor depend on the service and on offline queues | Resource exhaustion from uploads/imports/PDF jobs, job queue flooding | Size limits, worker isolation, rate limits, monitoring (`docs/deployment-railway.md`) |

## 2. Threat model by surface

Format per surface: STRIDE category (S spoofing, T tampering, R repudiation, I information
disclosure, D denial of service, E elevation of privilege), threat, impact, control, phase it
ships, and the automated test that proves it (names resolve in `docs/testing.md`).

### 2.1 Authentication

| STRIDE | Threat | Impact | Control | Phase | Test |
|---|---|---|---|---|---|
| S | Credential stuffing / password spraying | Account takeover | argon2id, length-based policy, breach-list check (optional), per-account and per-IP rate limits, lockout, generic error messages, TOTP for privileged roles | P1 / P1b | `auth.lockout.after_n_failures`, `auth.ratelimit.login_ip`, `auth.error.generic` |
| S | Account enumeration via login, reset, invitation | Targeted attacks | Identical responses and timing for unknown vs wrong password; reset always "if the account exists we sent an email" | P1 | `auth.enumeration.reset`, `auth.enumeration.login_timing` |
| S | Stolen reset or invitation link | Takeover | Single-use, short-lived, hashed-at-rest tokens bound to the account; sessions revoked on reset | P1 | `auth.reset.single_use`, `auth.reset.expiry`, `auth.reset.revokes_sessions` |
| T | Parameter tampering on reset (changing user id) | Takeover of another account | Token identifies the account; no user id accepted from the client | P1 | `auth.reset.token_bound` |
| R | Disputed logins | Cannot investigate | `auth.*` audit events with IP, user agent, outcome | P1 | `audit.auth_events` |
| E | Deactivated or locked user still authenticates | Ex-employee access | Lifecycle state checked on every request, not only at login; all sessions revoked at deactivation | P1 | `auth.lifecycle.deactivated_denied` |
| D | Login endpoint flood | Nobody can sign in | IP rate limit, proxy-aware client IP, lockout counters per account not global | P1 | `auth.ratelimit.login_ip` |

### 2.2 Session

| STRIDE | Threat | Impact | Control | Phase | Test |
|---|---|---|---|---|---|
| S | Session cookie theft via XSS or network | Impersonation | `__Host-` prefixed, `HttpOnly; Secure; SameSite=Lax; Path=/`; HSTS; CSP; session id 256-bit random stored as SHA-256 hash | P1 | `session.cookie.attributes`, `headers.hsts`, `headers.csp` |
| S | Session fixation | Attacker-known session id | New session id issued at login, at privilege change and at re-authentication; pre-login sessions carry no identity | P1 | `session.rotate_on_login` |
| T | Permissions change not applied to live session | Stale authority | `permissions_version` bump invalidates cached context ≤ 60 s; scope refresh on every request after that | P1 | `authz.session.permissions_changed` |
| R | Cannot tell which device did what | Weak audit | Session row carries device label, IP, user agent, created/last seen; audit events carry `session_id` | P1 | `audit.session_in_events` |
| I | Shared floor tablets expose previous user | Cross-user data | Idle timeout, explicit sign-out button on every operator screen, logout clears IndexedDB caches, `Cache-Control: no-store` on app pages | P1 / P7 | `session.idle_expiry`, `offline.logout_clears_cache` |
| E | Revoked session keeps working offline | Bypass of revocation | Server rejects replay from revoked session; client must re-authenticate; online clients refresh their permission set every 8 h or on each sync, and the offline authorization snapshot stays valid for 12 h without a server round trip (`docs/offline-sync.md` A-OFF-02, `settings.offline.auth_snapshot_max_age`) | P7 | `authz.session.revoked`, `offline.replay.revoked_session` |
| D | Session table growth | Slow auth | Expired sessions purged by the daily job `identity.session_purge`; index on `expires_at` | P1 | `jobs.session_purge` |

### 2.3 Internal web app and API

| STRIDE | Threat | Impact | Control | Phase | Test |
|---|---|---|---|---|---|
| S | CSRF on server actions and route handlers | Unwanted postings | SameSite=Lax cookie + Origin/`Sec-Fetch-Site` check on every mutating request + anti-CSRF token for non-JSON form posts (section 4.2) | P1 | `csrf.origin_mismatch_rejected`, `csrf.form_token_required` |
| T | Mass assignment / unexpected fields | Hidden field changes (`site_id`, `status`, prices) | Zod schemas with `.strict()`; state changes only through state-machine commands; ids from the path, never trusted from the body when a path id exists | P1 | `validation.strict_schema`, `statemachine.no_free_status` |
| T | Numeric precision abuse (floats, scientific notation, negative quantities) | Wrong stock/money | Zod string-decimal schema → `decimal.js`; range and scale per field; `numeric` in Postgres (ADR-010) | P1 | `validation.decimal_only` |
| I | IDOR across sites and across entities | Data leakage | Scoped repositories; 404 for out-of-scope; DTO allow-lists; masked sensitive fields | P1 | `authz.cross_site.*`, `authz.sensitive_fields.masked` |
| I | Verbose errors, stack traces, SQL in responses | Recon | Error envelope `{code, message, requestId}`; stack only in server logs | P1 | `errors.no_stack_in_response` |
| I | Search and autocomplete leak other sites' names | Recon | Search services are scoped like lists | P1 | `authz.cross_site.search` |
| E | Role escalation via custom role edit or self-assignment | Full access | `identity.role.admin`/`site_assignment.admin` restricted; cannot grant yourself; cannot grant R permissions without re-auth; audit | P1 | `authz.role_escalation.*`, `identity.no_self_grant` |
| D | Expensive list queries without limits | Outage | Mandatory pagination (max 200 rows), query timeouts (`statement_timeout` 15 s web, 10 min worker), per-user API rate limit | P1 | `api.pagination_enforced` |
| R | Actions without attribution | Weak audit | Every mutating service call needs an AuthContext; jobs run as `system:<job>` with the originating user recorded | P1 | `audit.required_fields` |

### 2.4 Scan endpoints and label payloads

| STRIDE | Threat | Impact | Control | Phase | Test |
|---|---|---|---|---|---|
| T | Malicious QR content (URLs, scripts, SQL) | Injection, phishing of operators | Payload grammar `^BC:(LOT\|BOX\|LOC\|MAT\|SKU\|EQP\|DOC):[A-Z0-9][A-Z0-9._-]{0,63}$` (section 4.9; resolution per `docs/data-model.md` §9.5); anything else is "Unrecognised code"; payload is treated as an opaque key for a scoped lookup (`EQP` → equipment register with calibration status; `DOC` → source record of the generated document, after authentication only, section 2.7); never rendered as HTML or opened as a link | P2 | `scan.payload_grammar`, `scan.rejects_url` (both cover all seven types) |
| I | Label encodes internal data (prices, customer, location map) | Leakage from a photo of a label | Payload carries only the typed identifier; human-readable label text limited to the fields in `docs/reports-and-templates.md`; no cost, no customer price | P2 | `label.payload_minimal` |
| S | Scanning a code from another site's label | Cross-site read | Lookup is scoped; unknown or out-of-scope code → "not found at your site" | P2 | `authz.cross_site.scan` |
| T | Duplicate scan submission (double tap, retry) | Double movement | Idempotency key per scan action; server returns the first result | P2 | `authz.idempotency.duplicate_key` |
| D | Scan endpoint flood from a device | Slow floor | Per-session rate limit 120/min on scan lookups (A-SEC-14) | P2 | `scan.ratelimit` |

### 2.5 File uploads (BMR scans, photos, supplier certificates, attachments)

| STRIDE | Threat | Impact | Control | Phase | Test |
|---|---|---|---|---|---|
| T | Executable or polyglot file disguised as image/PDF | Stored XSS, malware spread | Allow-list by magic bytes (`file-type`): jpeg, png, webp, heic→converted, pdf, csv, xlsx; extension must match sniffed type; images re-encoded; PDFs served as `attachment` with `nosniff`; never served from the app origin | P2 | `upload.rejects_mismatch`, `upload.reencodes_image` |
| T | Oversized uploads / zip bombs | Storage and worker exhaustion | Size caps (images 10 MB, PDFs 25 MB, imports 20 MB, A-SEC-15); streaming to bucket; no archive extraction | P2 | `upload.size_cap` |
| I | Photo EXIF reveals GPS/device | Personal data leak | Strip metadata on re-encode (A-SEC-16) | P2 | `upload.exif_stripped` |
| I | Direct bucket URL guessing | Document leakage | Opaque object keys `org/<uuid>/<uuid>`, private bucket, access only through signed URLs (section 4.8) | P2 | `files.no_direct_access` |
| E | Upload to a record outside scope | Cross-site write | Attachment command resolves the parent record through the scoped repository first | P2 | `authz.cross_site.body` (attachment case) |
| T | Malware in supplier certificates | Endpoint infection | Optional ClamAV scan in the worker before the file becomes downloadable (A-SEC-17, deferred to Phase 9 evaluation); until then, files open as downloads, never inline | P9 | `upload.av_quarantine` |

### 2.6 Import processing (CSV/XLSX attendance, master data, prices)

| STRIDE | Threat | Impact | Control | Phase | Test |
|---|---|---|---|---|---|
| T | Formula cells, macros, external links in XLSX | Code execution on reviewer machines | Parse with a library that ignores formulas and macros (values only); never re-serve the original file inline; `.xlsm` rejected | P5 | `import.rejects_macro`, `import.values_only` |
| T | CSV injection round trip (value starting with `=`) | Executes when exported later | Values stored verbatim, neutralized on every export (section 4.7) | P5 | `export.formula_neutralized` |
| T | Wrong employee mapping, duplicate rows | Payroll errors | Mapping preview, row-level status, duplicates flagged, review and approval before post, original file + checksum retained (ADR-021) | P5 | `import.duplicates_flagged`, `import.requires_approval` |
| I | Import file contains personal data readable by the wrong role | Leak | Attendance imports need `hr.attendance_import.*`; files stored with data class `restricted`; download audited | P5 | `authz.sensitive_fields.masked` (import case) |
| D | Huge or malformed files block the worker | Jobs starve | Row cap (100,000 rows, A-SEC-18), streaming parser, job timeout, one import job per user at a time | P5 | `import.row_cap` |
| R | Who imported what, with which mapping | Disputes | ImportJob stores uploader, mapping version, checksum; audit `platform.import_job.posted` | P5 | `audit.import_events` |

### 2.7 Document download links (PDF BMR, DR, labels, exports)

| STRIDE | Threat | Impact | Control | Phase | Test |
|---|---|---|---|---|---|
| I | Shared or leaked link opens a document | Leakage of batch/customer data | Signed URL, 5-minute TTL (A-SEC-19), bound to document id and requesting user id (portal: portal user id); issued only after the permission check; `Content-Disposition: attachment` | P2 | `documents.signed_url_expires`, `documents.signed_url_user_bound` |
| I | QR on printed BMR points to a public URL | Leakage | QR encodes `BC:DOC:<document-number>`; resolving it requires login and permission | P3 | `documents.qr_requires_auth` |
| T | Altered PDF presented as original | Fraud | Stored file hash and template version recorded; reprint has a reason and a visible "Reprint n" marker; hash shown in the document footer | P3 | `documents.reprint_audit`, `documents.hash_recorded` |
| R | Who downloaded or reprinted | Disputes | Audit `documents.generated_document.downloaded`, `documents.generated_document.reprinted` | P2 | `audit.document_events` |
| D | Mass generation of PDFs | Worker exhaustion | Generation runs in the worker with a per-user queue limit (10 pending, A-SEC-20) and Chromium memory cap | P3 | `jobs.pdf_queue_limit` |

### 2.8 Background jobs

| STRIDE | Threat | Impact | Control | Phase | Test |
|---|---|---|---|---|---|
| E | Job runs with more authority than the user who triggered it | Scope bypass | Job payload carries the originating `userId` and `siteId`; the job rebuilds an AuthContext from the current assignments at run time (so a revoked user's scheduled report stops) | P2 | `jobs.context_rebuilt`, `jobs.revoked_user_report_skipped` |
| T | Job payload tampering via the database | Wrong postings | Only `bc_app` can write the job tables; payload validated with Zod before execution; idempotent job keys | P2 | `jobs.payload_validated` |
| D | Poison job retried forever | Queue blocked | Retry limit 5 with backoff, dead-letter state, alert (`docs/deployment-railway.md`) | P2 | `jobs.dead_letter` |
| I | Scheduled report emailed to someone who lost access | Leak | Recipient permissions re-checked at generation; dropped recipients listed in the audit event | P5 | `reports.recipient_recheck` |
| R | Job actions not attributable | Audit gaps | Actor `system:<job>` plus `on_behalf_of` user id in audit events | P2 | `audit.job_actor` |

### 2.9 Offline sync replay (Phase 7; API groundwork Phase 2)

| STRIDE | Threat | Impact | Control | Phase | Test |
|---|---|---|---|---|---|
| T | Replayed command referencing stale stock state | Negative stock, wrong lot | Server re-validates every command against current state, scope and permissions; conflicts go to the review queue, never auto-applied | P7 | `offline.replay.revalidated`, `offline.conflict_queued` |
| T | Duplicate replay after partial failure | Double posting | Client UUIDv7 ids + idempotency keys; server returns stored result | P2 | `authz.idempotency.duplicate_key` |
| S | Replay from a stolen device | Unauthorized postings | Session must still be valid; device logout cleanup; online-only list (QA release, finance posting, payroll, permissions) can never be queued | P7 | `offline.replay.revoked_session`, `offline.online_only_rejected` |
| T | Device clock skew backdates records | Wrong timestamps | Client time stored as `sync_commands.client_created_at`; the server sets `posted_at` on the posted row; `clock_skew_seconds` is recorded and `is_clock_skew_flagged` is set when skew exceeds the A-OFF-05 threshold (default 10 min, `docs/offline-sync.md`); flagged, not fatal | P7 | `offline.time_skew_flagged` |
| I | Cached data on a lost phone | Leak | Cache limited to approved reference data for the user's sites; cleared on logout; no secrets in the PWA; encryption where the platform offers it (`docs/offline-sync.md`) | P7 | `offline.logout_clears_cache` |

### 2.10 Customer portal and payment webhooks (Phase 8)

| STRIDE | Threat | Impact | Control | Phase | Test |
|---|---|---|---|---|---|
| S | Credential stuffing on public login | Customer account takeover | Separate `portal_users`; stricter lockout (5 attempts), TOTP available, breach-list check on by default for portal | P8 | `portal.auth.lockout` |
| I | Tenant crossover by id | Another customer's orders/prices | `PortalAuthContext` with `customer_id` filter on every query; 404 on foreign ids; DTO allow-lists | P8 | `authz.portal.tenant_isolation` |
| S | Forged payment webhook | Order marked paid for free | Verify provider signature (HMAC, constant-time compare), timestamp tolerance 5 min, replay store by provider event id, process in worker, order paid only after server-side confirmation; never from the browser redirect | P8 | `webhook.signature_invalid_rejected`, `webhook.replay_ignored`, `webhook.redirect_not_trusted` |
| T | Amount mismatch between order and payment | Underpayment | Compare webhook amount/currency to the order; mismatch → `payment_provider_events` row stored with `processing_result = amount_mismatch`, no PaymentRecord created, exception queue item for `finance` (`docs/modules/finance.md` §7); a PaymentRecord created from a matching webhook stays `recorded` until reconciled; never auto-paid | P8 | `webhook.amount_mismatch_flagged` |
| I | Card data stored | Compliance breach | Provider-hosted payment page; no card fields in our forms; only provider references stored | P8 | `payments.no_card_fields` |
| D | Public API abuse | Outage | Portal rate limits, bot protection at the edge if available, order size caps | P8 | `portal.ratelimit` |
| R | Refund disputes | Loss | `finance.refund.approve` with reason; provider refund id stored; reconciliation report | P8 | `payments.refund_audit` |

### 2.11 Admin and diagnostics

| STRIDE | Threat | Impact | Control | Phase | Test |
|---|---|---|---|---|---|
| I | Diagnostics page shows connection strings, keys, env | Secret leak | Diagnostics renders health booleans, queue depths, versions, counts; env values never rendered; an allow-list of variable **names** only | P1 | `diagnostics.no_secrets` |
| E | Admin grants themselves restricted business permissions | Fraud | `system_admin` excluded from quality release, finance posting, payroll (`docs/permissions-matrix.md` section 3); grant of R permissions audited and surfaced in the owner's weekly access report | P1 | `authz.role_escalation.custom_role_sensitivity` |
| T | Changing numbering rules or settings retroactively | Broken traceability | Numbering changes apply to future numbers only; settings are versioned with actor and reason | P1 | `settings.versioned` |
| R | Admin actions not reviewed | Silent abuse | Audit events for all `identity.*` and `platform.*` admin actions; weekly access report to the owner (Phase 5) | P1 | `audit.admin_events` |

## 3. Authentication and session policy (ADR-004)

### 3.1 Password hashing

| Parameter | Value | Note |
|---|---|---|
| Algorithm | argon2id (`@node-rs/argon2`) | |
| Memory | 64 MiB (`m = 65536`) | A-SEC-01; above the OWASP minimum; measured ≤ 150 ms on the Railway plan at implementation, lowered to `m = 19456, t = 2` only if measured login latency exceeds 500 ms |
| Iterations | `t = 3` | |
| Parallelism | `p = 1` | |
| Salt / hash length | 16 bytes / 32 bytes | random salt per password |
| Pepper | optional HMAC-SHA-256 pre-hash with `AUTH_PEPPER` from env | A-SEC-02, off by default; if enabled, rotation requires re-hash on next login |
| Re-hash | on successful login when stored parameters differ from current | |
| Storage | `users.password_hash` PHC string; never selected by any DTO | |

### 3.2 Password policy

| Rule | Default | Note |
|---|---|---|
| Minimum length | 12 characters (A-SEC-03) | length-based; no composition rules (no forced symbols) |
| Maximum length | 128 characters | prevents hashing DoS |
| Deny list | top 100k breached passwords bundled offline; optional HIBP k-anonymity range check (`AUTH_BREACH_CHECK=hibp`) | A-SEC-04, offline list on by default; HIBP off (outbound dependency) |
| Context deny | must not contain the user's email local part, name or "bryel" | |
| Rotation | none; change on suspected compromise only | |
| Reuse | last 5 hashes kept in `password_history` (`docs/data-model.md` §3.1), reuse rejected | A-SEC-05 |
| Strength meter | zxcvbn-style score shown client-side; server enforces only the rules above | |

### 3.3 Lockout and rate limiting (auth endpoints)

| Control | Default | Behaviour |
|---|---|---|
| Per-account failures | 10 failures in 15 min → soft lock 15 min; doubles each repeat up to 24 h (A-SEC-06) | lock state `locked_until`; user notified by email; admin can unlock (`identity.user.admin`) |
| Per-IP login attempts | 20 per minute, 200 per hour (A-SEC-07) | 429 with `Retry-After`; client IP from the Railway proxy header only (configured trusted proxy) |
| Reset/invitation requests | 3 per account per hour; 10 per IP per hour | |
| TOTP attempts | 5 per 5 min per account, then 15 min lock | |
| Responses | identical message "Sign-in failed" with constant-time comparison; dummy hash computed for unknown users | prevents enumeration |

### 3.4 Session cookie and lifetimes

| Attribute | Value |
|---|---|
| Cookie name | `__Host-bc_session` (requires `Secure`, `Path=/`, no `Domain`) |
| Flags | `HttpOnly; Secure; SameSite=Lax; Path=/` |
| Value | 32 random bytes, base64url; database stores `sha256(value)` only |
| Table | `sessions` as defined in `docs/data-model.md` §3.1 (`token_hash` = sha256 of the cookie value, `active_site_id`, `device_registration_id` from Phase 7, `mfa_verified_at`, `reauthenticated_at`, `revoked_at`/`revoked_by`/`revoked_reason`); `permissions_version` is not a session column, it is the AuthContext cache version in `docs/permissions-matrix.md` §1.1 |
| Idle expiry, standard roles | 12 hours sliding, refreshed at most once per 5 minutes (A-SEC-08) |
| Idle expiry, privileged (holder of any R permission) | 1 hour (A-SEC-09) |
| Absolute expiry | 7 days standard, 24 hours privileged (A-SEC-10) |
| Remember device | not offered in Phase 1; evaluated with MFA in Phase 1b |
| Rotation | new token at login, after re-authentication, after MFA verification, when assignments change role sensitivity |
| Portal | `__Host-bc_portal`, idle 30 min, absolute 24 h (Phase 8) |

All lifetimes are `platform.settings` keys (`session.idle_minutes`, `session.idle_minutes_privileged`,
`session.absolute_hours`, `session.absolute_hours_privileged`) editable with
`platform.settings.admin`.

### 3.5 Session listing, revocation, device logout

1. Users see their own sessions (device label, IP, last seen) and can revoke any of them.
2. `identity.session.void` revokes another user's sessions with a reason; `identity.user.admin`
   "sign out everywhere" revokes all. Password change and password reset revoke all other
   sessions. Deactivation revokes all sessions and pending tokens.
3. Revocation is checked on every request (session row read); the 60-second AuthContext
   cache does not cache revocation.
4. Logout on a device: server marks the session revoked; the PWA clears IndexedDB caches and
   the outbox **after** warning if commands are still pending (user chooses sync-first or
   discard with confirmation; discard is audited `platform.sync_command.discarded`), unregisters
   push subscriptions, and removes cached reference data (`docs/offline-sync.md`).
5. A daily job (`identity.session_purge`, `docs/architecture.md` §8) deletes sessions 30 days after expiry/revocation (A-SEC-11); audit events keep
   the `session_id` for correlation.

### 3.6 Re-authentication for privileged actions

Actions on **restricted** permissions (`docs/permissions-matrix.md` section 2) require
`sessions.reauthenticated_at` within the last 10 minutes (A-SEC-12). The server returns
401 `REAUTH_REQUIRED`; the client shows a password (or TOTP, once enrolled) prompt and retries
the same request with the same idempotency key. Re-authentication is also required to change
own email or password, enrol/disable TOTP, view or export payroll and personal data, and
change approval rules.

### 3.7 TOTP multi-factor (Phase 1b)

| Item | Rule |
|---|---|
| Scope | Mandatory for users holding any R permission and for `system_admin`/`owner_director`; optional for everyone else; portal users optional (Phase 8) |
| Algorithm | RFC 6238, SHA-1, 6 digits, 30 s step, ±1 step window; last accepted counter stored to prevent replay |
| Secret storage | Encrypted at rest with `DATA_ENCRYPTION_KEY` (AES-256-GCM, key id stored for rotation) |
| Enrolment | Requires re-authentication; QR + manual key; must verify one code before activation; 10 single-use recovery codes shown once and stored argon2id-hashed |
| Grace | 7 days after a privileged assignment is granted (A-SEC-13), then privileged actions are blocked until enrolled |
| Reset | `identity.mfa.admin` with reason; user notified; audit `identity.mfa.reset` |
| Rate limit | section 3.3 |

### 3.8 Invitation and reset tokens

| Token | Length / storage | Lifetime | Rules |
|---|---|---|---|
| Invitation | 32 random bytes, `sha256` stored in `invitations(user_id, email, role_id, site_id, token_hash, expires_at, accepted_at, revoked_at)` (`docs/data-model.md` §3.1; `created_by` from the standard column set is the inviter; `user_id` points to the `users` row created at invitation with `status = 'invited'`) | 72 hours | single use; bound to the invited email; acceptance sets the password (and TOTP if required), moves the user to `active`, sets `accepted_at` and inserts the `user_site_assignments` row from `role_id`/`site_id` in one transaction; resend revokes the previous token (`revoked_at`) and inserts a new row for the same `user_id` |
| Password reset | same scheme in `password_reset_tokens(user_id, token_hash, expires_at, used_at, requested_ip)` | 30 minutes | single use; newest token invalidates older ones; success revokes all other sessions and emails the user; request always answered the same way |
| Email change | same scheme, sent to the **new** address, confirmation to the old | 30 minutes | re-auth required to start |
| Portal invitation | same scheme in `portal_invitations` | 72 hours | tenant bound (Phase 8) |

As built (W2E): tokens travel in the URL **fragment** (`/invite#token=…`, `/reset-password#token=…`),
which browsers never send to the server, so they cannot appear in proxy, access or Railway HTTP logs
or in a `Referer`; the page reads the fragment, removes it from the address bar, checks the token
through a server action and posts it in the form body with the new password. Tokens are never logged
or audited (`redact()` in `src/lib/auth/tokens.ts` masks `token`, `code`, `password`, `secret`,
`authorization`, `cookie` keys and 20+ character base64url values). The dev/test email adapter
(`EMAIL_PROVIDER=outbox`) is the only place a link is stored, and it is refused in production.

#### 3.10 As built: identity and sessions (Wave 2 W2E)

| Control | Implementation | Deviation from the policy above |
|---|---|---|
| Session lifetimes | `sessions.idle_expires_at` (sliding, refreshed at most every 5 min) and `expires_at` (absolute) set at creation from settings `session.*`; privileged = holder of an R string or owner_director/system_admin; "shared device" tick box at sign-in uses `session.idle_minutes_shared_device` (30 min, A-W2E-01); the shortest applicable limit wins | cookie name stays `bc_session` (the `__Host-` prefix is US-1-10) |
| Revocation | `revoked_at/by/reason`; read on every request; the context is rebuilt per request (no cache) | — |
| Step-up | `sessions.reauthenticated_at` within `identity.reauth_window_minutes`; password plus TOTP when enrolled; the token rotates on re-authentication and after the TOTP step | only identity administration requires it so far |
| TOTP | RFC 6238 in `src/lib/auth/totp.ts` (no dependency), AES-256-GCM with `DATA_ENCRYPTION_KEY` (`keyid:base64`), last used step stored (replay refused), 10 argon2id recovery codes, `mfa_user` bucket 5 tokens refilling over 15 min | rate limit is a token bucket, not a hard 15-minute lock |
| Rate limits | `rate_limit_buckets` token buckets: `login_ip` 20/min, `password_reset_account` 3/h, `password_reset_ip` 10/h, `token_ip` 30/h, `mfa_user`; IP limits apply only when `TRUSTED_PROXY_HEADER` is set | per-account lockout stays the MVP rule (5 failures → locked) until US-1-10 |
| Email | adapter `src/lib/email`: `none` / `outbox` (dev) / `resend` (HTTPS); sending happens after commit; with no provider the admin sees invitation or forced-reset links once (A-W2E-04) | SMTP not implemented (Railway blocks it below Pro) |
| First administrator | `pnpm admin:bootstrap` (`docs/deployment-railway.md` §14a): invited account + one-time link; refuses when anyone is active or locked | — |

### 3.9 Account lifecycle

```mermaid
stateDiagram-v2
  [*] --> invited: identity.user.create + invitation
  invited --> active: invitation accepted
  invited --> deactivated: invitation revoked / expired and not resent
  active --> locked: lockout (auto) or identity.user.admin
  locked --> active: timer expiry or admin unlock
  active --> deactivated: identity.user.admin (offboarding)
  locked --> deactivated: identity.user.admin
  deactivated --> active: identity.user.admin with reason (reactivation)
```

The `users` row exists from invitation: `identity.user.create` inserts it with `status = 'invited'`
and no password, together with the `invitations` row (`invitations.user_id`), in one transaction
(`docs/data-model.md` §3.1, §7 item 5); an invited user cannot sign in until acceptance.

Effects: `locked` and `deactivated` fail every request immediately (not only login);
`deactivated` revokes sessions, tokens, scheduled-report subscriptions and portal links, and
keeps the user row for audit attribution (never deleted). Offboarding checklist lives in
`docs/operations-runbook.md`.

## 4. Application controls

### 4.1 Input validation

- Every command and query has a Zod schema (`.strict()`), shared by route handlers, server
  actions, forms and offline replay (ADR-008). Unknown keys are rejected, not stripped.
- Ids are validated as UUIDv7 strings; document numbers as the configured pattern;
  quantities and money as decimal strings matched by `/^-?\d{1,15}(\.\d{1,6})?$/` and
  converted to `decimal.js`; dates as ISO 8601 with explicit time zone.
- Free text has maximum lengths (notes 4,000; reasons 500; names 200) and is stored as-is;
  encoding happens on output.
- Enumerations come from the state machines and reason-code tables, never free strings.

### 4.2 CSRF

1. Session cookie is `SameSite=Lax`, which blocks cross-site POST with cookies in modern
   browsers.
2. Every mutating request (POST/PUT/PATCH/DELETE route handler and every server action)
   must carry an `Origin` (or `Referer`) whose host equals the configured `APP_ORIGIN`;
   additionally `Sec-Fetch-Site` must be `same-origin` or `none` when present. Mismatch →
   403 `ORIGIN_MISMATCH`. Next.js performs a Host/Origin check for server actions; we
   enforce ours as well so route handlers and actions behave identically.
3. Non-JSON form posts (file uploads, legacy `<form>` submissions, print endpoints) also
   require a per-session anti-CSRF token: `HMAC-SHA-256(CSRF_SECRET, session_id)` rendered as
   a hidden field, compared in constant time.
4. JSON APIs require `Content-Type: application/json`; a form-encoded body to a JSON
   endpoint is rejected (prevents simple-request CSRF).
5. The scan endpoints and the offline replay endpoint are JSON only and therefore covered.

### 4.3 Output encoding

- React escapes by default; `dangerouslySetInnerHTML` is banned by ESLint except in one
  reviewed PDF template renderer that receives already-escaped strings.
- PDF/HTML templates (ADR-016) render through the same component layer; user text is never
  concatenated into template HTML.
- Email templates use a text-first renderer with HTML escaping; links are absolute to
  `APP_ORIGIN` only.
- Spreadsheet and CSV exports follow section 4.7.

### 4.4 Security headers

Set by middleware on every response (values for production; staging adds
`X-Robots-Tag: noindex`):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<per-request>' 'strict-dynamic';
  style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self';
  connect-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'self' blob:;
  object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
  upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains   (preload only after the custom domain is confirmed)
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=()
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Cache-Control: no-store                     (all authenticated HTML and API responses)
```

`style-src 'unsafe-inline'` is accepted because Radix and Recharts set inline styles; it is
revisited in Phase 9. Camera access is needed for scanning. Report-only CSP runs in
staging for two weeks before enforcement; violations are logged. Downloads from the bucket
are served with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

### 4.5 Rate limits (defaults, A-SEC-14)

| Scope | Limit | Response |
|---|---|---|
| Login, reset, invitation | section 3.3 | 429 |
| Authenticated API per session | 600 requests / minute | 429 with `Retry-After` |
| Scan lookups per session | 120 / minute | 429 |
| Exports per user | 20 / hour (S and R exports 5 / hour) | 429 and audit |
| PDF generation per user | 10 pending jobs | 429 |
| Uploads per user | 60 / hour, 500 MB / day | 429 |
| Webhooks (Phase 8) | 300 / minute per provider IP range | 429, provider retries |
| Portal unauthenticated | 30 / minute per IP | 429 |

Implementation: Postgres-backed token buckets in Phase 1 (one table, `rate_limit_buckets`,
`docs/data-model.md` §3.1; `ON CONFLICT` update),
reconsidered if load warrants a cache (ADR-002 keeps Redis out until needed).

### 4.6 Upload validation and storage

1. Accept only: `image/jpeg`, `image/png`, `image/webp`, `image/heic` (converted to JPEG),
   `application/pdf`, `text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
2. Sniff with `file-type`; the declared type, the extension and the sniffed type must agree.
3. Enforce size caps (section 2.5) before buffering; stream to the bucket.
4. Images are re-encoded with `sharp` (strips metadata, normalises orientation); PDFs are
   kept as-is but served as attachments; spreadsheets are parsed to values only.
5. Store in the S3-compatible bucket (ADR-014) under `org/<org-uuid>/<attachment-uuid>`
   with the original name kept in the database only; bucket is private; the application
   never executes or includes uploaded content.
6. `file_attachments` records: `is_sensitive` flag (data class follows the parent record,
   section 7), `virus_scan_status`, sha-256, size, uploader, parent entity and site;
   download goes through section 4.8 (sensitive files require re-authentication).
7. Antivirus scanning: deferred (A-SEC-17); re-evaluated at Gate 9 with the owner.

### 4.7 Spreadsheet formula-injection neutralisation

On every CSV/XLSX export, any string cell whose first character is one of `=`, `+`, `-`, `@`,
tab or carriage return is prefixed with a single quote `'`; in XLSX the cell is additionally
written with the string type (never formula); pipes `|` and `%` are not altered. CSV output
quotes every field and uses `\r\n`. The rule is a shared `neutralizeCell()` helper with unit
tests `export.formula_neutralized` and is applied in the export layer, not per report.

### 4.8 Signed short-lived document URLs

- Downloads of GeneratedDocuments, FileAttachments and export files are served via a
  presigned bucket URL (or, if the bucket cannot sign, an application endpoint
  `/api/v1/files/<id>?sig=…&exp=…` using `HMAC-SHA-256(FILE_URL_SECRET, id|user|exp)`).
- TTL 5 minutes (A-SEC-19); bound to the requesting user (or portal user) id; the
  permission check runs at link issue time **and** at redemption for the application
  endpoint.
- Links are never placed in emails or notifications; notifications link to the record page,
  which issues a fresh signed URL after authentication.
- Audit `documents.generated_document.downloaded` with document id, user, IP.

### 4.9 Scan payload format

`BC:<TYPE>:<CODE>` where `TYPE ∈ {LOT, BOX, LOC, MAT, SKU, EQP, DOC}` and `CODE` matches
`[A-Z0-9][A-Z0-9._-]{0,63}` (64 characters maximum, underscore allowed; ADR-017). The full
grammar is `^BC:(LOT|BOX|LOC|MAT|SKU|EQP|DOC):[A-Z0-9][A-Z0-9._-]{0,63}$`; `docs/data-model.md`
§9.5 is the single resolution rule (organization-scoped lookup, then site-filtered by
`AuthContext`). `EQP` resolves to `equipment.code` (organization-unique) and shows the
calibration status; `DOC` (document QR on printed BMRs and delivery receipts) resolves to
`generated_documents.document_number` only after authentication and the permission check on
the source record. Human-readable label text is limited to the fields in
`docs/reports-and-templates.md`. No URL, no site name, no customer, no price, no person is
ever encoded. Tests `scan.payload_grammar` and `scan.rejects_url` cover all seven types.

### 4.10 Idempotency keys

- Header `Idempotency-Key: <uuid>` is mandatory on every command endpoint that posts or
  creates (stock, production, finance, uploads, sync replay, webhooks use the provider event
  id). Server actions carry the key in the input schema.
- Table `idempotency_keys(organization_id, key, scope, user_id, request_hash, status,
  response_code, response, created_at, completed_at, expires_at)` as defined in
  `docs/data-model.md` §11.4: `scope` is the command type or endpoint (e.g.
  `inventory.movement.post`), `response` is the stored result envelope (jsonb) replayed
  verbatim; unique on `(organization_id, key)`; `expires_at = created_at + 7 days`
  (A-SEC-21).
- Same key + same user + same request hash → stored response replayed; same key with a
  different request hash, or replayed by a different `user_id` → 422
  `IDEMPOTENCY_KEY_REUSED`; concurrent duplicates serialize on the key row
  (`INSERT ... ON CONFLICT DO NOTHING` then `SELECT ... FOR UPDATE`).
- Ledger tables additionally carry the key in a partial unique index as a last line of
  defence (ADR-006).

### 4.11 Webhook verification (Phase 8)

Verify the provider signature header with HMAC over the raw body using `PAYMONGO_WEBHOOK_SECRET`
(constant-time compare), reject timestamps older than 5 minutes, store the provider event id
in `payment_provider_events` with a unique constraint, acknowledge quickly and process in the
worker, and reconcile against orders by provider payment id. Secrets per environment; the
sandbox and production secrets never coexist in one environment.

### 4.12 Dependency and code hygiene

- `pnpm audit --prod` and `pnpm outdated` in CI; high/critical vulnerabilities fail the
  build unless an exception with expiry is recorded in `docs/risk-register.md`.
- Lockfile committed; Renovate (or Dependabot) weekly with grouped minor updates.
- `gitleaks` secret scanning on every push; ESLint security rules (`no-eval`, no dynamic
  `require`, no `dangerouslySetInnerHTML`, boundaries between modules per ADR-013).
- Docker image built from a pinned Node LTS base, non-root user, read-only filesystem
  except `/tmp`; Trivy image scan in CI (warn in Phase 1, fail from Phase 9).

## 5. Audit event catalogue

Table `audit_events` is append-only (the runtime role has INSERT and SELECT only; a trigger
rejects UPDATE/DELETE). Every event has the base fields:

| Field | Content |
|---|---|
| `id` | UUIDv7 |
| `occurred_at` | server time (UTC) |
| `organization_id`, `site_id` | site nullable for organization-level events |
| `actor_id`, `actor_kind` | `actor_kind` ∈ `user` / `system` / `portal_user` / `job`; jobs act as the system user with `on_behalf_of_user_id` set when a job acts for a user |
| `on_behalf_of_user_id` | the user a job or system actor acted for (nullable) |
| `session_id`, `device_registration_id` | the session that performed the action; the registered device for replayed offline commands (Phase 7) |
| `action` | event name below, always `module.entity.event` (`docs/data-model.md` §8.1 is canonical) |
| `permission_code` | the permission string that authorized the action (`action` never doubles as a permission) |
| `entity_type`, `entity_id`, `entity_number` | table name, id, human-readable number when one exists |
| `correlation_id`, `request_id` | `correlation_id` links every event of one business operation (including replayed sync commands); `request_id` is shared with logs |
| `ip`, `user_agent` | user agent truncated to 256 chars |
| `reason_code_id`, `reason` | `reason_codes` reference and free text; mandatory where the table says so |
| `before`, `after` | JSON diff of changed fields, redacted per data class |
| `data_class` | `normal` / `sensitive` / `restricted` (controls who may read the payload) |
| `outcome` | `success` / `denied` / `failed` |

Column names are those of `audit_events` in `docs/data-model.md` §8. Event names follow
`module.entity.event` (three segments, CHECK-enforced; §8.1 of the data model holds the
mapping from earlier two-segment names and is canonical). The typed list lives in
`src/lib/audit.ts`.

Never logged anywhere (audit, application logs, error reports): passwords or hashes, session
tokens or ids in clear, TOTP secrets/codes/recovery codes, reset/invitation tokens, API keys,
bucket credentials, webhook secrets, full card or bank account numbers (last 4 only),
government id numbers in clear (masked to last 3), document file contents, request bodies of
auth endpoints, and personal data that the action does not concern.

| Event | Trigger | Extra required fields | Data class | Phase |
|---|---|---|---|---|
| `identity.session.login_succeeded`, `identity.session.login_failed`, `identity.user.locked`, `identity.user.unlocked` | sign-in flow (lockout and admin lock/unlock share the name; `actor_kind` tells them apart) | method (password/totp), failure reason category | sensitive | P1 |
| `identity.session.logged_out`, `identity.session.revoked`, `identity.session.revoked_all` | user or admin | revoked session count, reason | sensitive | P1 |
| `identity.user.password_changed`, `identity.user.password_reset_requested`, `identity.user.password_reset_completed` | account flows | – | sensitive | P1 |
| `identity.session.reauthenticated` | step-up | purpose (action attempted) | sensitive | P1 |
| `identity.mfa.enrolled`, `identity.mfa.disabled`, `identity.mfa.reset`, `identity.mfa.failed` | MFA flows | admin actor for reset | sensitive | P1b |
| `identity.authorization.denied` (`outcome = 'denied'`) | 403/404-by-scope/409-SoD | permission, site, entity | sensitive | P1 |
| `identity.user.created`, `identity.user.updated`, `identity.user.deactivated`, `identity.user.reactivated`, `identity.invitation.sent`, `identity.invitation.accepted`, `identity.invitation.revoked` | user admin and invitation flow | before/after of changed fields; invitation id, role, site | sensitive | P1 |
| `identity.role.created`, `identity.role.updated` | role admin | permission diff with sensitivity of each added permission | restricted | P1 |
| `identity.site_assignment.granted`, `identity.site_assignment.revoked`, `identity.site_assignment.scope_changed` | assignment admin | user, role, site, sub-scope, effective dates | restricted | P1 |
| `identity.role.owner_break_glass` | owner uses role/assignment admin | – | restricted | P1 |
| `platform.seed.applied` | `pnpm db:seed` (fictional data; refused when `APP_ENV = production`) | seed set name, row counts, `APP_ENV` | sensitive | P1 |
| `platform.database_session.break_glass_opened` | manual production SQL session (`docs/operations-runbook.md` break-glass procedure) | ticket/reason, second person, script hash, database role used | restricted | P1 |
| `masterdata.<entity>.created`, `masterdata.<entity>.updated` (pattern row for every master-data entity: `material`, `sku`, `product`, `supplier`, `customer`, `location`, `warehouse`, `equipment`, `uom`, …) | master data maintenance | before/after of changed fields | normal (partners and prices: sensitive) | P1/P2 |
| `masterdata.formula_revision.submitted`, `masterdata.formula_revision.reviewed` (reviewer's checklist decision, W12-03), `masterdata.formula_revision.approved`, `masterdata.formula_revision.obsoleted` (same pattern for `routing_revision`, `work_instruction_revision`, `label_template`, `document_template_version`, `inspection_plan`) | revision flow | revision number, approvers | sensitive | P3 |
| `masterdata.site.changed`, `masterdata.location.special_designated`, `masterdata.equipment.blocking_rule_changed` | structure admin | before/after | sensitive | P1/P2 |
| `masterdata.supplier.asl_changed` | approved-supplier-list decision: a `supplier_materials` entry approved or suspended under `masterdata.supplier.approve` (W04-11; approver ≠ requester) | supplier, material, before/after `is_approved`, requester, approver | sensitive | P6 |
| `inventory.stock_movement.posted`, `inventory.stock_movement.reversed` | ledger posting | movement type, lot, from/to location, qty base, idempotency key | normal (reversal: sensitive with reason) | P2 |
| `inventory.stock_adjustment.submitted` / `.approved` / `.posted` | adjustment flow | value, reason | sensitive | P2 |
| `inventory.stock_movement.held_stock_issued` | controlled exception (negative balances are rejected by constraint, ADR-006, so no negative-balance event exists) | approver, reason, purpose | restricted | P2 |
| `inventory.stock_count.released`, `inventory.stock_count.variance_approved`, `inventory.stock_count.posted`, `inventory.stock_count.cancelled` | stock count | scope, variance value and %, reason (cancel) | sensitive | P2 |
| `inventory.inventory_lot.created`, `inventory.inventory_lot.attributes_changed`, `inventory.container.split` / `.merged` / `.repacked`, `inventory.container.verified` | lot/container edits and label verification scan | before/after; scanned payload for verification | normal | P2 |
| `inventory.pack.started`, `inventory.pack.verified` | packing and pack verification scan | sales order, boxes, scanned payloads | normal | P4 |
| `inventory.inventory_balance.rebuilt` | projection rebuild job (`inventory.rebuild_balances`, enqueued with `inventory.balance.admin`) | job id, scope, rows rebuilt, differences found | sensitive | P2 |
| `inventory.scan.unrecognised` | scan lookup with an unparseable or unknown payload (lookups are not persisted; `docs/data-model.md` §3.3) | payload reduced to its type prefix and length (raw payload never stored), screen/workflow, device | normal | P2 |
| `procurement.goods_receipt.posted`, `procurement.goods_receipt.reversed`, `procurement.goods_receipt.discrepancy_approved` | receiving | PO, supplier, lots created | normal/sensitive | P2 |
| `procurement.purchase_request.approved`, `procurement.purchase_order.approved`, `procurement.purchase_order.sent`, `procurement.purchase_order.cancelled` | PO flow | amount, rule step | sensitive | P6 |
| `production.work_order.released` / `.cancelled`, `production.batch.created`, `production.batch.revisions_snapshotted`, `production.batch.started` / `.submitted` / `.closed`, `production.batch.rejected` (abandonment, A-DM-24), `production.batch.deleted_draft` | state transitions | from/to state, snapshot revision ids | normal | P3 |
| `production.batch.reopened`, `production.batch.amended` | controlled reopen | reason, fields changed, approvers | restricted | P3 |
| `production.dispense_record.recorded`, `production.dispense_record.checked`, `production.dispense_record.voided` | dispensing | material, lot, target, actual, tolerance result, scale/equipment | normal (void: sensitive) | P3 |
| `production.dispense_record.over_tolerance_approved`, `production.batch_material.substituted`, `production.equipment_use.override_approved` | controlled exceptions | approver, reason, deviation id | restricted | P3 |
| `production.batch_material.consumption_posted`, `production.batch_output.posted`, `production.yield_record.approved`, `production.scrap_rework_record.approved` | batch postings | quantities, variance | sensitive | P3 |
| `production.batch_paper_record.reviewed` | legacy paper BMR review (`docs/data-migration-plan.md`) | legacy number, reviewer, outcome | sensitive | P3 |
| `quality.test_result.recorded` / `.reviewed` / `.corrected` | results | spec limits, value, correction reason (original retained) | sensitive | P3 |
| `quality.inspection.sampled`, `quality.inspection.reviewed` | inspection flow | plan revision, sample ids, reviewer | sensitive | P3 |
| `quality.disposition.approved` | release/reject/rework/conditional | target (lot/batch), from/to status, approvers | restricted | P2 |
| `quality.hold.placed`, `quality.hold.lifted` | holds | scope of hold, reason | restricted (lift) | P2 |
| `quality.deviation.opened` / `.closed`, `quality.capa.closed`, `quality.change_control.approved`, `quality.complaint.closed` | quality system | linked records | sensitive | P3 (deviation) / P4 (complaint) / P6 (CAPA, change control) |
| `quality.recall_case.initiated`, `quality.recall_case.lots_marked`, `quality.recall_case.closed` | recall | lots, containers, customers affected (ids) | restricted | P6 |
| `quality.genealogy.viewed` | forward/reverse trace query (`docs/data-model.md` §10.5) | root entity, direction, depth, row count | sensitive | P3 |
| `sales.price_list.changed` / `.approved`, `sales.customer.credit_terms_changed` | pricing | before/after amounts | sensitive | P4 |
| `sales.sales_order.confirmed` / `.cancelled`, `sales.pick.scanned`, `sales.pick.completed`, `sales.pick_line.manual_entry` (box id typed because the label was unreadable; `pick_lines.manual_entry_reason` required), `sales.shipment.dispatched` / `.reversed`, `sales.shipment.over_shipment_approved`, `sales.delivery_receipt.acknowledged`, `sales.customer_return.posted` | fulfilment | quantities, boxes, DR number, acknowledgement evidence | normal (exceptions restricted) | P4 |
| `hr.employee.created` / `.updated`, `hr.employee.personal_data_viewed`, `hr.employee.personal_data_changed` | HR records | field names changed (values for personal data only in restricted payload) | restricted | P5 |
| `hr.attendance_import.uploaded` / `.approved` / `.posted` / `.reversed`, `hr.attendance_mapping.saved`, `hr.attendance_exception.resolved`, `hr.attendance_event.corrected`, `hr.attendance_event.correction_approved`, `hr.attendance_event.exported`, `hr.attendance_rule_set.changed` / `.approved` | attendance | import id, row counts, mapping profile, exception type and resolution, employee id, before/after times | sensitive | P5 |
| `hr.leave_request.approved`, `hr.overtime_request.approved` | approvals | employee id, period | sensitive | P6 |
| `hr.payroll_rule_set.changed` / `.approved`, `hr.payroll_period.submitted` / `.approved` / `.posted` / `.reopened`, `hr.payroll_line.adjusted`, `hr.payslip.generated`, `hr.payment_export.created` | payroll | period, totals, reviewer sign-off reference, adjustment reason | restricted | P6 |
| `finance.invoice.posted`, `finance.supplier_bill.posted`, `finance.credit_note.posted`, `finance.payment_record.posted` and the matching `finance.<entity>.reversed`; `finance.expense_claim.approved`, `finance.expense_claim.posted`; `finance.accounting_period.locked`, `finance.accounting_period.unlocked`; `finance.tax_configuration.changed`; `finance.costing_run.posted`; `finance.accountant_export.created` | finance | amounts, counterparties (ids), period, reason | restricted | P6 |
| `documents.generated_document.generated`, `documents.generated_document.downloaded`, `documents.generated_document.reprinted`, `documents.generated_document.superseded`, `documents.label_job.printed`, `documents.label_job.reprinted`, `documents.label_job.voided` | document engine and label printing | template version, source revision, hash, reprint/void reason | normal (reprint, void: sensitive) | P2/P3 |
| `documents.file_attachment.uploaded` / `.removed`, `documents.file_attachment.downloaded` | attachments (download audited for files of data class sensitive/restricted, e.g. attendance import files) | parent entity, size, sha-256 | normal (download of restricted files: restricted) | P2 |
| `platform.export.created` | any export of class S/R | module, filters, row count, format, file hash | sensitive/restricted | P1 |
| `platform.setting.changed`, `platform.approval_rule.changed`, `platform.numbering_rule.changed`, `platform.integration.changed`, `platform.notification_rule.changed` | configuration | before/after (secrets never included) | restricted | P1 |
| `platform.setting_change_request.approved` | approval of a setting change for a key flagged `requires_approval` (S1-03; a system_admin submits, an owner_director or a second system_admin approves with `platform.settings.approve`; approver ≠ submitter); the applied change also writes `platform.setting.changed` | setting key, old/new value, submitter, approver | restricted | P1 |
| `platform.help_guide.updated`, `platform.help_guide.published` | a help/quick-guide draft version is saved (`.updated`, by the author) or published (`.published`, by a second holder of `platform.help_guide.admin`, never the author; FR-platform-16) | screen/workflow key, version, linked work instruction revision, author and publisher | normal | P2 |
| `platform.import_job.posted` / `.reversed`, `platform.background_job.retried` / `.cancelled` | jobs and imports | job id, counts | sensitive | P2/P5 |
| `platform.sync_command.replay_accepted` / `.replay_rejected` / `.replay_conflicted`, `platform.sync_command.discarded`, `platform.sync_conflict.resolved` | sync | command id, `client_created_at`, resolution choice | sensitive | P7 |
| `sales.portal_user.invited` / `.suspended`, `sales.sales_order.submitted` (`actor_kind = 'portal_user'`), `finance.payment_provider_event.received` / `.rejected`, `finance.payment_record.recorded`, `finance.refund.approved` | portal and payments | tenant, provider event id | sensitive/restricted | P8 |

Retention of audit events follows the longest retention of the records they reference
(section 7). Audit reads require `platform.audit.view`; payload redaction by `data_class`
is described in `docs/permissions-matrix.md` section 6. A weekly "access and exceptions"
report (Phase 5) summarises role grants, restricted-permission use, controlled exceptions and
S/R exports for the owner.

## 6. Secrets and infrastructure

| Rule | Detail |
|---|---|
| Secrets live only in environment variables | Railway variables per environment (development, staging, production); never in the repository, images, logs, client bundles or the database; `.env.example` lists names only |
| Variable groups (Railway shared variables) | `base` (`APP_ENV`, `APP_ORIGIN`, `TRUSTED_PROXY_HEADER` for the client IP used by rate limits, `MAINTENANCE_MODE`), `db-app` (`DATABASE_URL`, runtime role `bc_app`), `db-migrate` (`DATABASE_MIGRATION_URL`, `bc_migrate`, present only on `web` for the pre-deploy migration; `MIGRATION_WINDOW_OPEN`, set to `true` only for the cutover window so the opening-balance loader may run against production, `docs/data-migration-plan.md` A-MIG-08, and removed afterwards), `db-backup` (`DATABASE_BACKUP_URL`, `bc_backup`; `DATABASE_READONLY_URL` for `bc_readonly` where analytics needs it), `auth` (`SESSION_SECRET`/`SESSION_SECRET_PREVIOUS`, `CSRF_SECRET`/`CSRF_SECRET_PREVIOUS`, `FILE_URL_SECRET`, `DATA_ENCRYPTION_KEY`/`DATA_ENCRYPTION_KEY_PREVIOUS` for the dual-key rotation window, optional `AUTH_PEPPER`), `storage` (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`), `mail` (`EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY`; HTTPS email API, Railway blocks outbound SMTP below Pro), `observability` (`ERROR_REPORTING_DSN`), `payments` (Phase 8: `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`), `backup` (`BACKUP_ENCRYPTION_PUBLIC_KEY`, `BACKUP_PREFIX`, `BACKUP_RETENTION_DAILY`, `BACKUP_RETENTION_MONTHLY`, `BACKUP_OFFSITE_ENDPOINT`, `BACKUP_OFFSITE_BUCKET`, `BACKUP_OFFSITE_REGION`, `BACKUP_OFFSITE_ACCESS_KEY_ID`, `BACKUP_OFFSITE_SECRET_ACCESS_KEY`); `web`, `worker` and `backup` services reference the groups they need, nothing more; `docs/deployment-railway.md` section 4 is the authoritative variable list |
| Client exposure | Only `NEXT_PUBLIC_*` variables reach the browser; CI greps the client bundle for secret names |
| Database roles (least privilege) | `bc_migrate`: owner of schema, runs migrations only at deploy; `bc_app`: SELECT/INSERT/UPDATE on application tables, INSERT/SELECT only on ledger and audit tables, no DELETE on ledgers/audit (enforced by grants and triggers), no DDL; `bc_readonly`: SELECT for analytics views and ad-hoc owner queries (no SELECT on sessions, MFA secrets, idempotency keys or sensitive employee columns); `bc_backup`: SELECT on all tables and sequences, used only by the `backup` service for `pg_dump` (`DATABASE_BACKUP_URL`); `bc_rls` role switching evaluated with ADR-022 |
| Key material | `DATA_ENCRYPTION_KEY` (32 bytes, base64) encrypts TOTP secrets and any field marked encrypted in `docs/data-model.md`; each ciphertext stores a key id so rotation is a background re-encrypt job |
| Rotation | Database passwords and bucket keys every 180 days or on suspected exposure; `SESSION_SECRET`/`CSRF_SECRET` rotation supported with a dual-key window of 24 h; `DATA_ENCRYPTION_KEY` via key id; webhook secrets on provider rotation; all rotations recorded in `docs/operations-runbook.md` log (A-SEC-22) |
| Access to production variables | Owner plus the named operations contact; developers use staging; every change to a production variable noted in the runbook change log |
| Transport | TLS terminated by Railway; HSTS; internal service-to-database traffic on Railway private networking |
| Backups | Railway Postgres backups plus nightly logical dump encrypted client-side with `age` to `BACKUP_ENCRYPTION_PUBLIC_KEY` before upload to a separate private bucket prefix; the private key is held offline by the owner and the operations contact (two copies); restore rehearsal before Gate 9 proves the key works (`docs/deployment-railway.md`) |
| Dependency scanning | section 4.12 |
| Logging | Structured JSON with `request_id`, user id, site id; redaction filter (section 3.8); logs retained 30 days (A-SEC-23); error reporting scrubs request bodies and cookies |
| Development data | Seeded fictional data only; production dumps are never restored to developer machines; anonymised extracts for debugging require owner approval |

## 7. Data retention and access policy

All periods are defaults requiring confirmation by the owner and the company's legal,
accounting and HR advisers (A-SEC-24). The system implements them as `retention_policies`
rows (data class, `retention_months`, `basis`, `minimum_months`, `action` in `archive` /
`anonymise` / `delete` / `keep`, reviewer confirmation) and `legal_holds` rows that block
every retention action on what they reference (`docs/data-model.md` §12.1), so confirmed
values are configuration; the sweep job only reports for unconfirmed classes. Nothing is
deleted while a legal hold, open complaint, recall or audit references the record. The Philippine Data Privacy Act and cosmetics record
expectations must be validated by qualified reviewers; the defaults below are engineering
placeholders, not legal advice.

| Data class | Examples | Default retention | After retention | Access |
|---|---|---|---|---|
| Quality and batch records | Batch, BMR PDFs, dispense/step records, test results, dispositions, deviations, CAPA, genealogy | 5 years after batch expiry date, minimum 7 years (A-SEC-25) | archive to cold storage, never delete without QA sign-off | QA, production per matrix; immutable |
| Stock ledger | StockMovement, counts, containers | 7 years | archive | per matrix; immutable |
| Financial | invoices, bills, payments, credit notes, costing, period locks, accountant exports | 10 years (A-SEC-26) | archive | finance, owner, auditor |
| Sales and customer | customers, orders, shipments, DRs, complaints | 7 years after last activity | anonymise contact persons; keep documents | sales, finance, owner |
| Employee master and personal data | Employee, personal fields, documents | employment + 5 years (A-SEC-27) | anonymise personal fields; keep employee number for ledgers | hr_payroll, owner |
| Attendance | imports (original files), events, corrections | 3 years (A-SEC-28) | delete original files, keep summaries | hr_payroll, site_manager (own site) |
| Payroll | periods, lines, payslips, payment exports | 10 years (A-SEC-29) | archive | hr_payroll, finance, owner |
| Audit events | all | longest retention of referenced records; minimum 7 years | archive | per matrix |
| Authentication and security logs | login attempts, session rows, rate-limit counters (`rate_limit_buckets`), `password_history` beyond the newest 5 | sessions 30 days after expiry; auth audit 7 years; counters 24 h idle; password history beyond the newest 5 at once | delete | system_admin, owner, auditor |
| Application logs | structured logs, error reports | 30 days | delete | operations |
| Uploaded files | photos, scans, certificates | follow parent record | delete from bucket when parent is deleted/anonymised | parent record access |
| Exports and generated reports | export files in the bucket | 30 days (A-SEC-30) | delete | requesting user |
| Generated labels (class `labels_generated`, `docs/data-model.md` §12.2) | label PDFs (`generated_documents` of kind `label`) and their `label_jobs` rows | files 90 days; the `generated_documents` and `label_jobs` rows follow the labelled lot or box (A-RPT-20) | delete file, keep row with checksum; a reprint renders anew from current data | label print/reprint per matrix |
| Backups | daily dumps | 35 daily + 12 monthly (A-SEC-31) | delete | owner, operations |
| Portal users and sessions | Phase 8 | account lifetime + 2 years | delete | sales_cs admin |

Data subject requests (access, correction, deletion) are handled through
`docs/operations-runbook.md`; deletion is anonymisation that preserves ledgers and audit.

## 8. Security review checklist and incident hooks

### 8.1 At every gate (G1 to G8)

1. Permission catalogue in code equals `docs/permissions-matrix.md` (`authz-coverage` check).
2. Every new entity has `authz.cross_site.*`, `authz.role_escalation.*`, `authz.sod.*` and
   idempotency tests; CI green.
3. New endpoints: Zod `.strict()`, Origin check, pagination, idempotency key where mutating.
4. New sensitive fields are in the masking table and tested.
5. New audit events are in the catalogue with data class.
6. No new secret in code or logs (`gitleaks`, log review on staging).
7. Headers unchanged or change reviewed; CSP report-only violations triaged.
8. Dependency audit clean or exception recorded with expiry.
9. Threat model table for the phase's new surface updated (sections 2.x).
10. Phase-specific: G2 scan grammar and label payload review; G3 document QR and reprint
    audit; G4 pricing masking on pick/pack/DR documents; G5 import and export neutralisation,
    scheduled-report recipient re-check; G6 restricted permissions with re-auth and TOTP, SoD
    on finance/payroll proven, approval rules seeded and reviewed by the accountant; G7 offline
    replay revocation and online-only enforcement; G8 portal tenant isolation, webhook
    signature/replay tests, sandbox payment run.

### 8.2 Before production (G9)

1. External or independent penetration test of the internal app (and portal if live), with
   findings fixed or accepted by the owner in `docs/risk-register.md`.
2. Production variable inventory reviewed; rotation dates recorded; backup key restore
   rehearsed and recorded.
3. Database role grants verified against section 6 (`\dp` output attached to the gate
   report); ledger and audit triggers verified by a failing UPDATE/DELETE test.
4. TOTP enforced for all privileged users; no shared accounts; every floor tablet has its
   own device label; offboarding procedure rehearsed.
5. Retention policies loaded with owner-confirmed values; legal hold tested.
6. Monitoring alerts for failed logins spike, lockouts, `identity.authorization.denied` rate, restricted
   permission use, failed webhooks, job dead letters (`docs/deployment-railway.md`).
7. Incident process (8.3) agreed with the owner and the operations contact.
8. RLS decision (ADR-022) recorded: adopted or explicitly deferred with reason.

### 8.3 Incident process hooks

The security incident procedure is part of `docs/operations-runbook.md` (incident section).
Security-specific hooks that the runbook must include:

| Trigger | First actions | Evidence to preserve |
|---|---|---|
| Suspected account compromise | revoke all sessions of the user (`identity.user.admin`), lock account, force reset, review `identity.authorization.denied` and restricted actions by that user in the last 30 days | audit events, session rows, logs by `request_id` |
| Suspected site boundary leak | disable the affected endpoint behind a feature switch, run the cross-site test suite against production data shape in staging, list affected records from audit | audit, logs, the failing query |
| Secret exposure | rotate the secret (section 6), revoke sessions if `SESSION_SECRET`, re-encrypt if `DATA_ENCRYPTION_KEY`, review bucket access logs | git history, variable change log |
| Malicious or corrupted import/upload | void the import, quarantine the file (set `file_attachments.virus_scan_status = 'blocked'`, which refuses download), scan other uploads from the same user | ImportJob, file hashes |
| Webhook fraud attempt (Phase 8) | keep the order unpaid, block the source, reconcile with the provider dashboard | provider event ids, signatures |
| Lost or stolen device | revoke that session, discard its outbox server-side, remove push subscription, note in the device register | session row, last sync time |
| Data subject request | runbook procedure; anonymise, never delete ledgers | request record |

Severity, owner notification within 1 hour for restricted-data incidents, and the
post-incident review template are defined in the runbook; this document only fixes the
security triggers and evidence requirements.

## 9. Assumptions and open questions

| Id | Assumption (default) | Needs confirmation from |
|---|---|---|
| A-SEC-01 | argon2id `m = 64 MiB, t = 3, p = 1`, lowered only if measured login latency > 500 ms | devops (measurement) |
| A-SEC-02 | Password pepper off by default | principal-architect |
| A-SEC-03 | Minimum password length 12, no composition rules | owner |
| A-SEC-04 | Offline breached-password list on; HIBP online check off | owner |
| A-SEC-05 | Last 5 password hashes kept to prevent reuse | owner |
| A-SEC-06 | Lockout: 10 failures / 15 min → 15 min lock, doubling to 24 h | owner |
| A-SEC-07 | Login IP limits 20/min and 200/h | devops |
| A-SEC-08 | Standard idle timeout 12 h sliding | owner (shift length) |
| A-SEC-09 | Privileged idle timeout 1 h | owner |
| A-SEC-10 | Absolute session 7 days standard, 24 h privileged | owner |
| A-SEC-11 | Session rows purged 30 days after expiry | principal-architect |
| A-SEC-12 | Re-authentication window 10 minutes for restricted actions | owner |
| A-SEC-13 | TOTP enrolment grace 7 days for newly privileged users | owner |
| A-SEC-14 | Rate-limit defaults in section 4.5 | devops |
| A-SEC-15 | Upload caps: images 10 MB, PDFs 25 MB, imports 20 MB | owner, IT contact |
| A-SEC-16 | EXIF metadata stripped from photos | owner (no need for GPS evidence) |
| A-SEC-17 | Antivirus scanning deferred to Gate 9 evaluation | owner |
| A-SEC-18 | Import row cap 100,000 | HR (file sizes) |
| A-SEC-19 | Signed URL TTL 5 minutes | owner |
| A-SEC-20 | 10 pending PDF jobs per user | devops |
| A-SEC-21 | Idempotency keys retained 7 days | principal-architect |
| A-SEC-22 | Credential rotation every 180 days | owner, operations contact |
| A-SEC-23 | Application logs retained 30 days | owner |
| A-SEC-24 | All retention periods are placeholders until legal/accounting/HR confirmation | owner, advisers |
| A-SEC-25 | Quality records: 5 years after expiry, minimum 7 years | QA/regulatory reviewer |
| A-SEC-26 | Financial records 10 years | accountant |
| A-SEC-27 | Employee data: employment + 5 years | HR, legal |
| A-SEC-28 | Attendance raw files 3 years | HR |
| A-SEC-29 | Payroll records 10 years | payroll reviewer, accountant |
| A-SEC-30 | Export files deleted after 30 days | owner |
| A-SEC-31 | Backups: 35 daily + 12 monthly | owner, devops |

Open questions for the owner:

1. Who is the named operations contact who shares production secret access and the backup
   decryption key with the owner?
2. Are floor devices shared between operators? (Determines whether operator idle timeout
   should be shorter than 12 h and whether a quick-switch PIN is needed in Phase 1b.)
3. Does the company have a data-privacy officer or external counsel who will confirm the
   retention table and personal-data handling?
4. Is an independent penetration test before go-live (Gate 9) in budget, or should the team
   run an internal one with documented scope?
5. Which email provider will send invitations and resets (affects SPF/DKIM setup and
   phishing resistance)?
6. Should the owner receive the weekly access-and-exceptions report by email or only in the
   action centre?
