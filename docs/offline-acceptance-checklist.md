# Offline acceptance checklist (US-7-07)

Owner: the company (site manager and IT) with the `qa-test-lead` persona. Status: ready to run.
Built in Wave 4 stream W4D (US-7-01 .. US-7-06); behaviour in `docs/offline-sync.md` §11 "As built".

Plain language: this is the list the owner runs on the company's own phones and tablets before
offline work is used on the floor. Each row says what to do, what you should see, and where to
record the result. Nothing here needs a developer. Allow about 90 minutes for one phone and one
tablet. Record each row as Pass / Fail with a screen recording or photo (AC-20).

## 1. Before you start

| # | Item | Done |
|---|---|---|
| P-1 | The app is reachable over **HTTPS** (Railway URL or the company domain). Offline mode and installing the app only work over HTTPS. | ☐ |
| P-2 | Devices: at least one Android phone (Chrome, D1 in `docs/testing.md` §7) and one tablet (D3). An iPhone (Safari, D2) if the company uses them. Write the model and browser version in the results table. | ☐ |
| P-3 | Demo or staging data only (never the production database for this test). Demo accounts use the password `demo1234`. | ☐ |
| P-4 | People: a site manager (approves devices, resolves conflicts), a warehouse operator (counts), a production operator (weighs), a second production operator (checker). Demo: `manager.nfd@`, `warehouse.nfd@`, `operator.nfd@`, `checker.nfd@bryels-care.test`. | ☐ |
| P-5 | A count is released (Warehouse › Stock counts › open the planned count › **Release and freeze**) with the warehouse operator as a counter. | ☐ |
| P-6 | A batch is in process with its line clearance signed (Production › Batches; demo batch `B-26-0004`). | ☐ |
| P-7 | Agree the clock-difference threshold to watch (A-OFF-05, default 10 minutes; Q-TST-04). | ☐ |

## 2. Install and register (US-7-01, US-7-06)

| # | Do | Expect | Result |
|---|---|---|---|
| 1 | On the phone, open the app in Chrome and sign in as the warehouse operator. Use the browser menu **Install app** / **Add to Home screen**. | The Bryel's Care green icon is on the home screen; opening it shows the app without the browser bar. | |
| 2 | Open **Sync & offline** (Home menu, or the cloud chip in the top bar). Enter a device name (e.g. "Counting phone 1"), choose **Shared floor device**, site NFD, **Request registration**. | "Registration requested"; the card shows **Waiting for approval**. | |
| 3 | On a computer, sign in as the site manager, open **Admin › Devices**. Approve the phone with **Stock counts** (and **Weighing** for the tablet). | The phone row shows **Registered** and "Offline: …" with the chosen workflows. | |
| 4 | Back on the phone, open Sync again. Tap **Download offline data** for NFD. | "Offline data for NFD saved on this device"; a blue chip "Data as of <time>". | |
| 5 | Open **Open the offline workspace**. | The workspace shows "Signed in as <name>", the data time, and the Count / Weighing / Queue buttons. | |

## 3. Counting offline (US-7-04, `offline.airplane_mid_workflow`, `offline.tab_closed_pending`, `offline.app_restart`)

| # | Do | Expect | Result |
|---|---|---|---|
| 6 | Turn on **airplane mode**. Close the app completely, then open it from the home-screen icon. | The offline workspace opens (not a browser error page). The status chip says **Offline**. | |
| 7 | Count: choose the location, scan the lot label (or type the lot number and tap Look up), enter the quantity, **Save count on this device**. Repeat for 3 lines. | "Saved on this device…"; the chip says "Offline · 3 pending". Expected quantities are never shown (blind count). | |
| 8 | Scan a label of another site's lot or a random barcode. | A clear message; nothing is queued. | |
| 9 | Force-close the app (swipe it away) and reopen it, still in airplane mode. Open **Queue**. | The 3 lines are still there with **Pending sync**. | |
| 10 | Turn airplane mode off. Wait up to 30 s (or tap **Sync now** on the Sync page). | Chip changes to **Synced**; on a computer the count shows the 3 entries by the operator, once each. | |
| 11 | Repeat row 7 for one line, then switch Wi-Fi off and on quickly several times while it syncs (`offline.partial_connectivity`). | The line is applied exactly once (check the count detail on the computer). | |

## 4. Weighing offline (US-7-04, `offline.dispense_capture_rules`)

| # | Do | Expect | Result |
|---|---|---|---|
| 12 | On the tablet (registered with Weighing), sign in as the production operator, download offline data, go to airplane mode, open the workspace, **Weighing**. | The in-process batch and its open ingredients are listed with targets. | |
| 13 | Choose an ingredient. Scan a lot of a **different material**. | "This is <material>, not <material>." Nothing can be saved. | |
| 14 | Scan the suggested lot; enter a weight **outside** the tolerance. | "Outside tolerance … Re-weigh. An exception needs QA online." Save is refused. | |
| 15 | Enter the target weight, choose the scale, save. | "Saved on this device… the checker signs it then." | |
| 16 | Back online, wait for **Synced**. On a computer open the batch. | The weighing is recorded for the operator, **not yet checked**. Sign as the checker from the checker's own session. | |

## 5. Rules that protect the records (US-7-03, US-7-05)

| # | Do | Expect | Result |
|---|---|---|---|
| 17 | `offline.count_plan_closed`: queue a count line in airplane mode; on the computer, cancel the count; reconnect the phone. | The line shows **Needs review** on the phone; the manager sees it in **Admin › Sync conflicts** with reason **Count closed**. Nothing is posted. | |
| 18 | `offline.permission_revoked_while_offline`: queue a count line offline; meanwhile an administrator removes the person's warehouse role; reconnect. | Refused with "You no longer have permission…"; the Sync page shows **Your permissions changed**; nothing posted. Restore the role afterwards. | |
| 19 | `offline.expired_session`: queue a change offline; meanwhile revoke the person's sessions (Admin › Sessions › Sign out); reconnect. | The app asks to sign in; after signing in, the change appears in conflict review as **Sign-in ended**; nothing posted. | |
| 20 | `offline.auth_snapshot_too_old`: leave the phone offline more than 12 hours (A-OFF-02), then try to save a count. | "Offline sign-in is older than 12 h…" New work is blocked; queued work is kept. | |
| 21 | `offline.conflict_resolved_each_way`: as the manager, open each conflict and resolve one each way: **Discard** (note), **Re-apply** with a corrected quantity, **Escalate to a stock adjustment** (or **deviation** for a weighing). | Each needs a note; re-apply creates a new change that posts; the adjustment is a draft waiting for approval; Admin › Audit log shows `platform.sync_conflict.resolved` for each. The person who queued the change cannot resolve it themselves. | |
| 22 | `offline.time_skew_flagged`: set the phone clock 20 minutes ahead, queue and sync a count line. | Accepted; the posted time is the server's; Admin › Diagnostics › Sync shows the clock difference flagged. Reset the clock. | |

## 6. Shared devices and sign-out (US-7-06, `offline.logout_clears_cache`)

| # | Do | Expect | Result |
|---|---|---|---|
| 23 | In airplane mode queue one count line; reconnect only Wi-Fi to a network without internet (or keep the server unreachable) and choose **Sign out**. | A list of the unsent change with **Keep and stay signed in**, **Download support file**, **Discard and sign out**. Download the file; then keep. | |
| 24 | With the connection back, sign out choosing **Discard and sign out** while one change is unsent. | Sign-in page. Admin › Audit log shows `platform.sync_command.discarded`. | |
| 25 | Sign in on the same device as another person. Open Sync and the offline workspace. | Nothing of the previous person is shown (no queue, no data until downloaded). | |
| 26 | On the computer, **Remove** the device with a reason. Open the app on the device. | The device shows as not registered; its offline data is cleared; it must be registered again. | |
| 27 | `offline.no_sensitive_cache`: on a desktop Chrome, after downloading offline data, open DevTools › Application › IndexedDB › `bryels-care-offline`. | Only materials, locations, lots with quantities, open counts, batches and the queue. No prices, costs, customer, payroll or personal data. | |

## 7. Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Site manager | | | |
| IT | | | |
| QA (rows 13–16, 21) | | | |

Failures are logged in `docs/risk-register.md` or as a backlog defect with the row number, device,
browser version and recording. Automated counterparts: `tests/integration/platform/offline-sync.test.ts`,
`tests/unit/offline/outbox.test.ts`, `tests/e2e/offline-sync.cjs`.
