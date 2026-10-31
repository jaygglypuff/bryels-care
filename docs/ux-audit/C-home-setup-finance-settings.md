# UX audit C: Home, Help, Operations, Setup, Finance, Reports, Settings & people, and the app frame

Auditor: independent UI/UX audit, read-only, on the live demo (https://bryels-care-production.up.railway.app). Date: 2026-10-31.
Method: Playwright (Chromium) at 390x844 (phone, touch), 820x1180 (iPad, touch), 1440x900 and 1920x1080 (/floor). For each screen I measured the title, the "This screen is for…" line, the "What to do next" box, visible form fields (folded `<details>` not counted), sideways scroll, tap targets under 44 px and codes in the text, and I looked at the key screenshots myself. Nothing was saved, approved or posted. In the recipe wizard I picked a product and typed a batch size (both stay in the browser) to reach screens 3 to 5.
Screenshots: `/tmp/claude-0/-home-user-bryels-care/103807bc-c37f-572c-a3d5-4a6ebca2aac4/scratchpad/ux-audit/C/` (`<screen>-<role>-<viewport>.png` full page; `vp-*` = first screen only; `shell-<role>-<vp>-home|drawer.png`; `wizard-<n>-owner-<vp>.png`). Raw metrics: `res-390-*.jsonl`, `res-1440-*.jsonl`, `C/menus-*.json`, `C/navcompare.txt` (one level up from C/).

## How sure these findings are

- **Environment problem to check first (not proven to be an app bug).** In this sandbox, headless Chromium got **HTTP 404 for every JavaScript file of a dynamic route** (for example `/_next/static/chunks/app/(app)/masterdata/suppliers/%5Bid%5D/page-….js`). So every record page (`/…/[id]`) showed "This page could not be loaded". The same URL returns 200 to curl and to Playwright's own HTTP client. That points to this sandbox's network path rather than the app. I worked around it by fetching those files through Node. **Before trusting any record page on real phones, open one on a real phone (outside this sandbox).** If it fails there too, it is the most serious defect on the site.
- **Sessions ended in the middle of the run.** All demo sessions were signed out at the same moment, probably because another auditor reset the demo or reused the accounts. My script signs in again when that happens.
- "Pass/fail" is my judgement against the 10 criteria in the brief. Small-target counts are measured and include inline text links. Criterion 8 (empty and error states) could only be judged where the demo data happened to be empty.

## Summary

- **Screens audited: 130** (one screen + role pair each, at 390; every one also captured at 1440). That is 115 unique routes, plus the 5 recipe-wizard screens and `/floor` at 1920. Two routes were not reachable because the demo has no records for them: `/admin/imports/[id]` (no import jobs) and `/reports/runs/[runId]` (no runs linked).
- **Pass all 10: 31. Fail at least one: 99.**
- Failures by criterion: 1 intro: 3 · 2 one next step: 32 · 3 at most 5 fields: 19 · 4 never type a code: 1 · 5 grade-5 words: 28 · 6 names before codes: 35 · 7 phone fit and 44 px: 71 · 8 empty/error states: 1 · 9 consistency: 11 · 10 old screen reachable: 5.
- Desktop (1440): no sideways scroll or overflow on any screen. Phone (390): **no sideways scroll on any screen.** The phone failures are about tap-target size and covered content, not layout breaks.

### Top 10 problems for a first-time owner or manager (ranked by impact)

1. **The same job has two or three doors with different names.** "To approve" (top bar), the "To approve" tab and "Problems & alerts → To decide" all show the same 17 items, with different buttons ("Approve" vs "Decide batch" / "Review order"). "Messages" sits both in the top bar and in the tab row, and both are visible together at 820 and 1440. "Quality check" (Operations tab, /quality/check, title "Batches waiting for QA check"), "Quality checks" (/quality/inspections, title "Quality checks (tests)") and "Quality checks for items" (/masterdata/inspection-plans, title "Quality checks") are three different things with nearly the same name. Two supplier lists: "Suppliers" (/masterdata/suppliers) and "Suppliers we may buy from" (/procurement/suppliers). Three report entries: "Business overview", "Reports" and "Lists to download or print".
2. **Old screens are still in the owner's menu and look current.** Management → Planning tools → "Production orders, full detail" opens /production/work-orders. Its title is "Production orders", the same as the new screen, and its intro says "Older production order screen". Also there: "Production board, full detail", "All batches and their records", "Make a batch without an order" (the screen says the opposite: "Make a batch from an approved production order") and "Get materials by scanning" (title "Stage materials"). "Recipes (advanced)" and "Steps (advanced)" sit next to the wizard, and the wizard shows an "Advanced editing instead" link on every screen.
3. **The owner's menu is too big.** The owner sees 120 menu items (manager 109, auditor 107, QA 86) in 5 destinations and 17 sub-menus. Management alone has 8 sub-menus. The Management tagline promises "HR", but there is no HR.
4. **Codes come first in the places an owner reads most.** Home "Recent activity" reads "Ana Villanueva used generated document DOC-26-0000004", "… generated generated document …" (the word is doubled), "The system expired lot LM-2610-0008". Messages read "DR DRM-2610-018 not acknowledged after 4 days". "Problems & alerts" cards read "Batch BM-2610-0026 waits for a QA decision" and "Change of setting platform.rate_limits". The Operations Center batch table starts with the batch code and mixes two formats (B-26-0003 / BM-2610-0026). Reports show KPI-10, KPI-SAL-01, ADR-020 and BOM.
5. **On phones, many taps are too small (71 of 130 screens).** Top bar buttons are 40x40 (logo 36). The tab row is 40 px tall. The drawer close button is 36 px. "What is this?" is 32 px. Filter chips on Problems & alerts are 29 px. Messages buttons are 34 px. Most checkboxes are 16 to 20 px. On the phone the tab row cuts off "Problems & alerts" ("Proble…") at the right edge.
6. **Record pages often have no clear next step.** 32 record pages fail criterion 2: most Setup detail pages (supplier, material, location, site, warehouse, equipment, inspection plan, reason) and finance payment/credit/expense detail have no "What to do next" box. Some have the box but it is wrong: the invoice shows the same green "Save to the books" twice; the expense claim box has no button and no "Waiting for <name>"; the sellable-item page's next step is "Back to the product". To approve shows 17 green Approve buttons.
7. **Edit forms show far more than 5 fields.** Steps version: 106 inputs. Copy a job (role clone): 399 permission checkboxes plus a password box, although PAGE_REVIEW says "name only". New label: 25. Reason detail: 17 checkboxes with words like "QA disposition", "Reversal", "Controlled exception" and "Audited action". Site detail: 11 inputs and 4 green Save buttons. Supplier bill: 8.
8. **The recipe wizard lets you send an empty recipe for approval.** Screens 3 (Ingredients) and 4 (Steps) get a green tick even when they are empty. Screen 5 then offers "Send for approval" for a recipe with "No ingredients yet / No steps yet". On screen 1, all three demo products can be picked, even though each already has a recipe (ACS-01, AHL-01, GBS-01). The "Has a recipe · open it" guard did not show. The wizard also has no "This screen is for…" line.
9. **Phones have no scan button in the top bar.** The "Scan or search" link is hidden below 640 px. Owner, manager, finance and sales phones have no Scan tab either, so scanning is 3 taps away (Menu → Inventory → Scan). The brief asks for camera scan entry on mobile. The sync status chip in the drawer is an empty pill with only a cloud icon and no words.
10. **Menu words and screen titles differ on 29 items.** For example: Stock → "Raw materials", Adjustments → "Fix stock", Availability → "Can we deliver?", FEFO & reservations → "Which one to use first / set aside" (the menu still says "FEFO"), Expense approvals → "Expense claims", My expense claims → "Expense claims", Statements → "Customer statements", Today's count → "Today", Receive materials → "Receive a delivery", People → "People who use the app", Roles → "Roles (what each job may do)", Trace a lot (quick link) → "Where it came from and where it went". Full list in the menu map.


## Per-screen table (390 unless noted; criteria 1–10 as in the brief: 1 intro · 2 one next step on record pages · 3 at most 5 visible fields · 4 never type a code · 5 grade-5 words · 6 names before codes · 7 phone fit and 44 px · 8 empty/error states · 9 consistency · 10 old screen; ✓ pass, ✗ fail, – not applicable or not reachable)

| # | Route | Role | Screen title | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Notes (✗ reasons) | Screenshot (390 / 1440) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `/dashboard` | owner | Good evening, Ana | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | 2: No single "What to do next"; Needs your attention list instead; 5: Recent activity: "evaluated", "generated generated document", "resolved action item"; 6: Recent activity leads with SO-/PO-/DOC-/LM- codes; 7: Site toggle 40px, Chart/Table 34px | dashboard-owner-390.png / dashboard-owner-1440.png |
| 2 | `/dashboard` | manager.nfd | Good evening, Dino | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | 2: No single "What to do next"; Needs your attention list instead; 5: Recent activity: "evaluated", "generated generated document", "resolved action item"; 6: Recent activity leads with SO-/PO-/DOC-/LM- codes; 7: Site toggle 40px, Chart/Table 34px | dashboard-manager.nfd-390.png / dashboard-manager.nfd-1440.png |
| 3 | `/dashboard` | operator.nfd | Good day, Rhea | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | 2: No single "What to do next"; Needs your attention list instead; 5: Recent activity: "evaluated", "generated generated document", "resolved action item"; 6: Recent activity leads with SO-/PO-/DOC-/LM- codes; 7: Site toggle 40px, Chart/Table 34px | dashboard-operator.nfd-390.png / dashboard-operator.nfd-1440.png |
| 4 | `/dashboard` | warehouse.nfd | Good day, Lito | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | 2: No single "What to do next"; Needs your attention list instead; 5: Recent activity: "evaluated", "generated generated document", "resolved action item"; 6: Recent activity leads with SO-/PO-/DOC-/LM- codes; 7: Site toggle 40px, Chart/Table 34px | dashboard-warehouse.nfd-390.png / dashboard-warehouse.nfd-1440.png |
| 5 | `/dashboard` | qa.nfd | Good evening, Nina | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | 2: No single "What to do next"; Needs your attention list instead; 5: Recent activity: "evaluated", "generated generated document", "resolved action item"; 6: Recent activity leads with SO-/PO-/DOC-/LM- codes; 7: Site toggle 40px, Chart/Table 34px | dashboard-qa.nfd-390.png / dashboard-qa.nfd-1440.png |
| 6 | `/dashboard` | finance | Good evening, Rosa | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | 2: No single "What to do next"; Needs your attention list instead; 5: Recent activity: "evaluated", "generated generated document", "resolved action item"; 6: Recent activity leads with SO-/PO-/DOC-/LM- codes; 7: Site toggle 40px, Chart/Table 34px | dashboard-finance-390.png / dashboard-finance-1440.png |
| 7 | `/dashboard` | sales | Good evening, Mara | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | 2: No single "What to do next"; Needs your attention list instead; 5: Recent activity: "evaluated", "generated generated document", "resolved action item"; 6: Recent activity leads with SO-/PO-/DOC-/LM- codes; 7: Site toggle 40px, Chart/Table 34px | dashboard-sales-390.png / dashboard-sales-1440.png |
| 8 | `/account` | owner | My account | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: "Sign out" buttons 33px (13 small targets) | account-owner-390.png / account-owner-1440.png |
| 9 | `/account` | operator.nfd | My account | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: "Sign out" buttons 33px (13 small targets) | account-operator.nfd-390.png / account-operator.nfd-1440.png |
| 10 | `/action-centre` | owner | Problems & alerts | ✓ | – | ✗ | ✓ | ✗ | ✗ | ✗ | – | ✗ | ✓ | 3: 17 visible note fields (one per card); 5: "Change of setting platform.rate_limits", "Acknowledgement note"; 6: Card titles are "Batch BM-2610-0026 waits…", "Order SO-…"; 7: Filter chips 29px tall; 52 small targets; 9: "To decide" tab duplicates /approvals (same 17 items, different buttons) | action_centre-owner-390.png / action_centre-owner-1440.png |
| 11 | `/action-centre` | manager.nfd | Problems & alerts | ✓ | – | ✗ | ✓ | ✗ | ✗ | ✗ | – | ✗ | ✓ | 3: 17 visible note fields (one per card); 5: "Change of setting platform.rate_limits", "Acknowledgement note"; 6: Card titles are "Batch BM-2610-0026 waits…", "Order SO-…"; 7: Filter chips 29px tall; 52 small targets; 9: "To decide" tab duplicates /approvals (same 17 items, different buttons) | action_centre-manager.nfd-390.png / action_centre-manager.nfd-1440.png |
| 12 | `/approvals` | owner | To approve | ✓ | ✗ | – | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | 2: Next-step box OK, but every card also has its own green Approve (17 green buttons); 6: Codes shown under titles (PO-26-00002, SUP-0006 > MAT-0060 in title) | approvals-owner-390.png / approvals-owner-1440.png |
| 13 | `/approvals` | finance | To approve | ✓ | ✗ | – | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | 2: Next-step box OK, but every card also has its own green Approve (17 green buttons); 6: Codes shown under titles (PO-26-00002, SUP-0006 > MAT-0060 in title) | approvals-finance-390.png / approvals-finance-1440.png |
| 14 | `/dashboard/details/batches` | owner | Batches this week | ✓ | – | – | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | 6: Batch codes BM-/B- prominent | dashboard_details_batches-owner-390.png / dashboard_details_batches-owner-1440.png |
| 15 | `/dashboard/details/stock` | owner | Stock to look at | ✓ | – | – | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | 6: LM- lot codes prominent | dashboard_details_stock-owner-390.png / dashboard_details_stock-owner-1440.png |
| 16 | `/notifications` | manager.nfd | Messages | ✓ | – | – | ✓ | ✗ | ✗ | ✗ | – | ✗ | ✓ | 5: "DR … not acknowledged", "disposition", "FEFO"; 6: Titles start with codes: "DR DRM-2610-018 not acknowledged"; 7: Show history / Mark all read / Open / I'm on it 34px; 92 small targets; 9: Intro sits under the buttons, unlike siblings | notifications-manager.nfd-390.png / notifications-manager.nfd-1440.png |
| 17 | `/notifications` | operator.nfd | Messages | ✓ | – | – | ✓ | ✗ | ✗ | ✗ | – | ✗ | ✓ | 5: "DR … not acknowledged", "disposition", "FEFO"; 6: Titles start with codes: "DR DRM-2610-018 not acknowledged"; 7: Show history / Mark all read / Open / I'm on it 34px; 92 small targets; 9: Intro sits under the buttons, unlike siblings | notifications-operator.nfd-390.png / notifications-operator.nfd-1440.png |
| 18 | `/sync` | operator.nfd | Working without signal | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: "Download offline data" small | sync-operator.nfd-390.png / sync-operator.nfd-1440.png |
| 19 | `/sync/conflicts` | owner | Phone changes to check | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: Open/Resolved/All chips 33px | sync_conflicts-owner-390.png / sync_conflicts-owner-1440.png |
| 20 | `/sync/conflicts/01a18d48-7e46-778f-8e2f-42939a3de962` | owner | Stock move · L-2610-00001 | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | 3: 9 visible fields; 5: "Re-apply", "deviation", "permission"; 6: Title "Stock move · L-2610-00001" (code in title); 7: 1 targets <44px | sync_conflicts_id-owner-390.png / sync_conflicts_id-owner-1440.png |
| 21 | `/help` | owner | Help | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | 5: Words: quarantine, deviation, CAPA in role guides | help-owner-390.png / help-owner-1440.png |
| 22 | `/help` | operator.nfd | Help | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | 5: Words: quarantine, deviation, CAPA in role guides | help-operator.nfd-390.png / help-operator.nfd-1440.png |
| 23 | `/operations` | owner | Operations Center | ✓ | – | – | ✓ | ✓ | ✗ | ✗ | – | ✓ | ✓ | 6: "Batches being made" table: batch code first column; two code formats B-26-0003 vs BM-2610-0026; 7: Site toggle 40px, warning links 25px | operations-owner-390.png / operations-owner-1440.png |
| 24 | `/operations` | manager.nfd | Operations Center | ✓ | – | – | ✓ | ✓ | ✗ | ✗ | – | ✓ | ✓ | 6: "Batches being made" table: batch code first column; two code formats B-26-0003 vs BM-2610-0026; 7: Site toggle 40px, warning links 25px | operations-manager.nfd-390.png / operations-manager.nfd-1440.png |
| 25 | `/floor` | owner | Bryel's Care · North Fields Plant | ✓ | – | – | ✓ | ✓ | ✗ | – | – | ✓ | ✓ | 6: Batch codes shown; "Anyone" as assignee | floor-owner-390.png / floor-owner-1440.png |
| 26 | `/admin/approval-rules` | admin | Who says OK to what | ✓ | – | ✓ | ✓ | ✓ | ✗ | ✗ | – | ✓ | ✓ | 6: Rule ids PM-15, PRD-37 visible; 7: "Confirm" 21px tall | admin_approval_rules-admin-390.png / admin_approval_rules-admin-1440.png |
| 27 | `/admin/audit` | admin | History of changes | ✓ | – | ✓ | ✗ | ✓ | ✗ | ✗ | – | ✓ | ✓ | 4: Search needs a record number; 6: Rows lead with record numbers; 7: 100 small targets ("What changed" toggles) | admin_audit-admin-390.png / admin_audit-admin-1440.png |
| 28 | `/admin/demo` | admin | Reset demo data | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin_demo-admin-390.png / admin_demo-admin-1440.png |
| 29 | `/admin/devices` | admin | Phones and tablets | ✓ | – | ✗ | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | 3: 6 visible; 5: "workflows"; 7: 20px checkboxes, Approve device 19px tall | admin_devices-admin-390.png / admin_devices-admin-1440.png |
| 30 | `/admin/diagnostics` | admin | Health of the system | ✓ | – | – | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | 5: Shows ADR-055/ADR-026, "permission", raw errors (IT page, but owner can open it); 7: Status chips 29px; 59 small targets | admin_diagnostics-admin-390.png / admin_diagnostics-admin-1440.png |
| 31 | `/admin/imports/legacy-documents` | admin | Old paper documents | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin_imports_legacy_documents-admin-390.png / admin_imports_legacy_documents-admin-1440.png |
| 32 | `/admin/imports` | admin | Load data from a spreadsheet | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: "?" 36px | admin_imports-admin-390.png / admin_imports-admin-1440.png |
| 33 | `/admin/notification-rules` | admin | Who gets which message | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin_notification_rules-admin-390.png / admin_notification_rules-admin-1440.png |
| 34 | `/admin/numbering` | admin | How record numbers look | ✓ | – | ✓ | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | 6: Example numbers lead (GR-26-00001…) | admin_numbering-admin-390.png / admin_numbering-admin-1440.png |
| 35 | `/admin` | admin | People who use the app | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin-admin-390.png / admin-admin-1440.png |
| 36 | `/admin/retention` | admin | Keeping and deleting old records | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | 5: "entity", "idempotency", "disposition"; SEC- codes; 7: "Change or confirm" 29 small targets | admin_retention-admin-390.png / admin_retention-admin-1440.png |
| 37 | `/admin/roles` | admin | Roles (what each job may do) | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin_roles-admin-390.png / admin_roles-admin-1440.png |
| 38 | `/admin/security` | admin | Sign-in safety | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin_security-admin-390.png / admin_security-admin-1440.png |
| 39 | `/admin/sessions` | admin | Who is signed in | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin_sessions-admin-390.png / admin_sessions-admin-1440.png |
| 40 | `/admin/settings` | admin | Settings | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: "Take back" 40px | admin_settings-admin-390.png / admin_settings-admin-1440.png |
| 41 | `/admin/templates` | admin | Labels and printouts | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin_templates-admin-390.png / admin_templates-admin-1440.png |
| 42 | `/admin/templates/labels/new` | admin | New label | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 3: 25 visible inputs (printed-fields checkboxes); 7: 20px checkboxes | admin_templates_labels_new-admin-390.png / admin_templates_labels_new-admin-1440.png |
| 43 | `/admin/templates/new` | admin | New page layout | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin_templates_new-admin-390.png / admin_templates_new-admin-1440.png |
| 44 | `/admin/templates/stations` | admin | Label printers | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin_templates_stations-admin-390.png / admin_templates_stations-admin-1440.png |
| 45 | `/admin/users` | admin | People who use the app | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin_users-admin-390.png / admin_users-admin-1440.png |
| 46 | `/admin/users/invite` | admin | Add a person | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: Cancel 19px | admin_users_invite-admin-390.png / admin_users_invite-admin-1440.png |
| 47 | `/admin/roles/01a18d48-6920-744a-a687-68520504f190` | admin | Auditor (can only look) | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 2: No Next-step box; 7: 1 targets <44px | admin_roles_id-admin-390.png / admin_roles_id-admin-1440.png |
| 48 | `/admin/roles/01a18d48-6920-744a-a687-68520504f190/clone` | admin | New job, copied from Auditor (can only look) | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | 2: No Next-step box; 3: 399 visible permission checkboxes + password; review says "name only"; 5: "50 thing(s) left out" list; allocation/disposition/routing; 7: 16px checkboxes x396 | admin_roles_id_clone-admin-390.png / admin_roles_id_clone-admin-1440.png |
| 49 | `/admin/templates/01a18d48-7433-73cd-99d6-dbfaa588721e` | admin | BMR hybrid paper page (blank, handwritten ste | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | 2: No Next-step box | admin_templates_id-admin-390.png / admin_templates_id-admin-1440.png |
| 50 | `/admin/templates/labels/01a18d48-78a5-7062-ad38-405eb473c1a6` | admin | Box / carton 100 × 50 mm | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 2: No Next-step box; 3: 25 visible inputs; 7: 20px checkboxes | admin_templates_labels_id-admin-390.png / admin_templates_labels_id-admin-1440.png |
| 51 | `/admin/users/01a18d48-695f-7aed-aa79-511a89036775` | admin | Ana Villanueva | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | 2: No Next-step box; 6: SIGN-IN / TWO-STEP tokens shown | admin_users_id-admin-390.png / admin_users_id-admin-1440.png |
| 52 | `/documents/01a18d6b-d74d-7979-a2be-a0e87c06cc2f` | admin | Delivery receipt DOC-26-0000003 | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | 2: No Next-step box; 5: "SHA-256", "DR-STD" template code; 6: Title "Delivery receipt DOC-26-0000003"; 7: 2 targets <44px | documents_id-admin-390.png / documents_id-admin-1440.png |
| 53 | `/management` | owner | Management | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✗ | ✓ | 5: Destination says "HR, finance…" but there is no HR; 9: Lists "Purchasing" inside "Purchasing" | management-owner-390.png / management-owner-1440.png |
| 54 | `/management` | manager.nfd | Management | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✗ | ✓ | 5: Destination says "HR, finance…" but there is no HR; 9: Lists "Purchasing" inside "Purchasing" | management-manager.nfd-390.png / management-manager.nfd-1440.png |
| 55 | `/admin/settings` | owner | Settings | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 2 targets <44px | admin_settings_owner-owner-390.png / admin_settings_owner-owner-1440.png |
| 56 | `/admin/users` | owner | People who use the app | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | admin_users_owner-owner-390.png / admin_users_owner-owner-1440.png |
| 57 | `/analytics` | owner | Reports | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 2 targets <44px | analytics-owner-390.png / analytics-owner-1440.png |
| 58 | `/analytics/overview` | owner | Business overview | ✓ | – | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | 5: KPI-10, ADR-020, BOM, disposition in card footnotes; 6: KPI codes visible; 7: Period chips 36px | analytics_overview-owner-390.png / analytics_overview-owner-1440.png |
| 59 | `/analytics/definitions` | owner | What each number means | ✓ | – | – | ✓ | ✗ | ✗ | ✓ | – | ✓ | ✓ | 5: "posting", "quarantine", "FEFO", "KPI"; 6: KPI-SAL-01 codes alongside names | analytics_definitions-owner-390.png / analytics_definitions-owner-1440.png |
| 60 | `/analytics/operations` | owner | Making products | ✓ | – | – | ✓ | ✓ | ✗ | ✗ | – | ✓ | ✓ | 6: KPI-OPS-02 visible; 7: Period chips 36px | analytics_operations-owner-390.png / analytics_operations-owner-1440.png |
| 61 | `/reports` | owner | Lists to download or print | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: "?" help 36px | reports-owner-390.png / reports-owner-1440.png |
| 62 | `/reports/schedules` | owner | Lists sent by email | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | reports_schedules-owner-390.png / reports_schedules-owner-1440.png |
| 63 | `/reports/schedules/new` | owner |  | ✗ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1: Only an empty state: "Choose a list first" | reports_schedules_new-owner-390.png / reports_schedules_new-owner-1440.png |
| 64 | `/reports/RPT-INV-STOCK` | owner | What stock we have, and where | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | reports_rpt_inv_stock-owner-390.png / reports_rpt_inv_stock-owner-1440.png |
| 65 | `/analytics/kpi/KPI-SAL-01` | owner | Orders confirmed | ✓ | – | – | ✓ | ✓ | ✗ | ✗ | – | ✓ | ✓ | 6: Drill list = SO-26-000xx links only (18px tall); 7: 33 link rows 18px | analytics_kpi_code-owner-390.png / analytics_kpi_code-owner-1440.png |
| 66 | `/reports/schedules/01a18d48-7942-7ed1-8cf0-bc5ce1280ad0` | owner | Weekly QA decisions (demo) | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 2: No Next-step box; 3: 22 visible inputs (recipient checkboxes); 7: 20px checkboxes | reports_schedules_id-owner-390.png / reports_schedules_id-owner-1440.png |
| 67 | `/finance` | finance | Money | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | finance-finance-390.png / finance-finance-1440.png |
| 68 | `/finance/bills` | finance | Supplier bills | ✓ | – | – | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | 6: Their bill numbers shown prominently (SVC-DEMO-0907) | finance_bills-finance-390.png / finance_bills-finance-1440.png |
| 69 | `/finance/bills/new` | finance | Enter a supplier bill | ✓ | – | ✗ | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | 3: 8 visible fields; 6: Delivery picker shows GR- numbers | finance_bills_new-finance-390.png / finance_bills_new-finance-1440.png |
| 70 | `/finance/credit-notes` | finance | Credits (money back) | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | finance_credit_notes-finance-390.png / finance_credit_notes-finance-1440.png |
| 71 | `/finance/expenses` | finance | Expense claims | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | finance_expenses-finance-390.png / finance_expenses-finance-1440.png |
| 72 | `/finance/expenses/new` | finance | Claim money I spent | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | finance_expenses_new-finance-390.png / finance_expenses_new-finance-1440.png |
| 73 | `/finance/invoices` | finance | Invoices | ✓ | – | – | ✓ | ✗ | ✗ | ✓ | – | ✓ | ✓ | 5: "delivery(ies)"; 6: Unbilled deliveries listed by DRM- code | finance_invoices-finance-390.png / finance_invoices-finance-1440.png |
| 74 | `/finance/payments` | finance | Payments | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | finance_payments-finance-390.png / finance_payments-finance-1440.png |
| 75 | `/finance/payments/new` | finance | Record a payment | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 3: 6 visible (who, how much, when, how + 2 allocation radios); 7: 20px radio buttons | finance_payments_new-finance-390.png / finance_payments_new-finance-1440.png |
| 76 | `/finance/periods` | finance | Close the month | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | finance_periods-finance-390.png / finance_periods-finance-1440.png |
| 77 | `/finance/statements` | finance | Customer statements | ✓ | – | ✓ | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | 6: CUS- codes visible | finance_statements-finance-390.png / finance_statements-finance-1440.png |
| 78 | `/finance/tax` | finance | Tax rates | ✓ | – | ✓ | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | 6: FICT-IN/OUT codes shown | finance_tax-finance-390.png / finance_tax-finance-1440.png |
| 79 | `/finance/bills/01a18d48-cdba-7315-a7aa-0d8aff214493` | finance | Cebu Chemicals | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | finance_bills_id-finance-390.png / finance_bills_id-finance-1440.png |
| 80 | `/finance/credit-notes/01a18d48-cd1b-7321-91a3-b57917c7863b` | finance | Luntian Wellness Stores | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | 2: No Next-step box | finance_credit_notes_id-finance-390.png / finance_credit_notes_id-finance-1440.png |
| 81 | `/finance/credit-notes/new?invoiceId=01a18d48-cd48-72b7-b745-` | finance | Money back for Sari Glow Online | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | 2: No Next-step box | finance_credit_notes_new-finance-390.png / finance_credit_notes_new-finance-1440.png |
| 82 | `/finance/expenses/01a18d48-cddb-7b12-82de-a1da2010286f` | finance | Rhea Mendoza | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | 2: Next-step box has no button and no "Waiting for <name>" | finance_expenses_id-finance-390.png / finance_expenses_id-finance-1440.png |
| 83 | `/finance/invoices/01a18d48-cd48-72b7-b745-4160d133d12c` | finance | Sari Glow Online | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | – | ✗ | ✓ | 2: Same green "Save to the books" twice (Next step box + "Do it now" card); 9: Intro sits under the ⋯ More button | finance_invoices_id-finance-390.png / finance_invoices_id-finance-1440.png |
| 84 | `/finance/payments/01a18d48-cc8a-7f26-b8d8-c28bdf793c5c` | finance | Sari Glow Online | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 2: No Next-step box; 7: 1 targets <44px | finance_payments_id-finance-390.png / finance_payments_id-finance-1440.png |
| 85 | `/finance/statements/01a18d48-7594-7373-8005-86188bf69cfb` | finance | Sari Glow Online | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | finance_statements_id-finance-390.png / finance_statements_id-finance-1440.png |
| 86 | `/finance` | owner | Money | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | finance_owner-owner-390.png / finance_owner-owner-1440.png |
| 87 | `/finance/expenses/new` | operator.nfd | Claim money I spent | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | finance_expenses_new_operator-operator.nfd-390.png / finance_expenses_new_operator-operator.nfd-1440.png |
| 88 | `/masterdata/equipment` | owner | Equipment | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | masterdata_equipment-owner-390.png / masterdata_equipment-owner-1440.png |
| 89 | `/masterdata/equipment/01a18d48-7d32-79dd-a33f-2bfeb26d6b3c` | owner | Soap bar cutter (wire) | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 2: No Next-step box; 3: 10 visible inputs (log a check + change status forms open); 7: 1 targets <44px | masterdata_equipment_id-owner-390.png / masterdata_equipment_id-owner-1440.png |
| 90 | `/masterdata/equipment/new` | owner | Register equipment | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | masterdata_equipment_new-owner-390.png / masterdata_equipment_new-owner-1440.png |
| 91 | `/masterdata/formulas` | owner | Recipes (advanced) | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✗ | 7: 1 targets <44px; 10: "Recipes (advanced)" kept in menu next to the wizard; /masterdata/recipes redirects here | masterdata_formulas-owner-390.png / masterdata_formulas-owner-1440.png |
| 92 | `/masterdata/formulas/01a18d48-69fb-7de0-919c-93ced0500de6` | owner | Recipe for Acapulco Soap 135 g | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 1 targets <44px | masterdata_formulas_id-owner-390.png / masterdata_formulas_id-owner-1440.png |
| 93 | `/masterdata/formulas/new` | owner | New recipe (advanced) | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✗ | 10: Old advanced form still reachable (/masterdata/formulas/new, ⋯ More on Recipes (advanced)) | masterdata_formulas_new-owner-390.png / masterdata_formulas_new-owner-1440.png |
| 94 | `/masterdata/inspection-plans` | owner | Quality checks | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✗ | ✓ | 7: 1 targets <44px; 9: Same name collision as above | masterdata_inspection_plans-owner-390.png / masterdata_inspection_plans-owner-1440.png |
| 95 | `/masterdata/inspection-plans/01a18d48-6f74-7416-955b-dc655e9` | owner | Acapulco Soap finished product (PLACEHOLDER) | ✓ | ✗ | – | ✓ | ✗ | ✓ | ✗ | – | ✗ | ✓ | 2: No Next-step box; 5: Title "(PLACEHOLDER)" visible to owner; 7: 1 targets <44px; 9: Menu "Quality checks for items" vs title "Quality checks" vs Operations "Quality check"/"Quality checks (tests)" | masterdata_inspection_plans_id-owner-390.png / masterdata_inspection_plans_id-owner-1440.png |
| 96 | `/masterdata/inspection-plans/new` | owner | Quality checks for an item | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | masterdata_inspection_plans_new-owner-390.png / masterdata_inspection_plans_new-owner-1440.png |
| 97 | `/masterdata/lines` | owner | Making areas / lines | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 1 targets <44px | masterdata_lines-owner-390.png / masterdata_lines-owner-1440.png |
| 98 | `/masterdata/lines/01a18d48-731e-7786-b3ea-63d6ca86a881` | owner | Lotion line | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | 2: No Next-step box; 2 green buttons | masterdata_lines_id-owner-390.png / masterdata_lines_id-owner-1440.png |
| 99 | `/masterdata/locations` | owner | Locations | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 3: 8 visible (4 filters + add form); 7: 16px checkbox, Edit 34px | masterdata_locations-owner-390.png / masterdata_locations-owner-1440.png |
| 100 | `/masterdata/locations/01a18d48-6879-70c0-a5e6-aab38ef49b40` | owner | Oils rack A-01 | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | 2: No Next-step box | masterdata_locations_id-owner-390.png / masterdata_locations_id-owner-1440.png |
| 101 | `/masterdata/materials` | owner | Materials | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✗ | ✓ | 7: Name links 23px tall; 9: Intro under buttons; 2-3 green buttons (New material, Search) | masterdata_materials-owner-390.png / masterdata_materials-owner-1440.png |
| 102 | `/masterdata/materials/01a18d48-69b3-7dc5-b75c-5e2edefde3b4` | owner | 33.33% Lye Solution | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 2: No Next-step box; 3: 7 visible; 7: 20px radios | masterdata_materials_id-owner-390.png / masterdata_materials_id-owner-1440.png |
| 103 | `/masterdata/materials/new` | owner | New material | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 3: 10 visible inputs (3 questions as radios + supplier, pack, unit) — 5 questions, OK in spirit; 7: 20px radios | masterdata_materials_new-owner-390.png / masterdata_materials_new-owner-1440.png |
| 104 | `/masterdata/products` | owner | Products | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | masterdata_products-owner-390.png / masterdata_products-owner-1440.png |
| 105 | `/masterdata/products/01a18d48-69ba-7290-96f1-65f87ad80816` | owner | Acapulco Soap 135 g | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | masterdata_products_id-owner-390.png / masterdata_products_id-owner-1440.png |
| 106 | `/masterdata/reason-codes` | owner | Reasons | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | 5: "disposition", "deviation" in where-offered list; 7: 2 targets <44px | masterdata_reason_codes-owner-390.png / masterdata_reason_codes-owner-1440.png |
| 107 | `/masterdata/reason-codes/01a18d48-72e6-7b51-bbfb-e3c4bffac60` | owner | No purchase order in the system (purchasing n | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | 2: No Next-step box; 3: 20 visible (17 checkboxes); 5: "QA disposition", "Reversal", "Controlled exception", "Audited action"; 6: Raw snake_case code "no_purchase_order" under title; 7: 16px checkboxes | masterdata_reason_codes_id-owner-390.png / masterdata_reason_codes_id-owner-1440.png |
| 108 | `/masterdata/routings` | owner | Steps (advanced) | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✗ | 7: 1 targets <44px; 10: "Steps (advanced)" kept in menu | masterdata_routings-owner-390.png / masterdata_routings-owner-1440.png |
| 109 | `/masterdata/routings/01a18d48-6a0e-7fc1-a97b-2c06c9e330af` | owner | Steps for Acapulco Soap 135 g | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 1 targets <44px | masterdata_routings_id-owner-390.png / masterdata_routings_id-owner-1440.png |
| 110 | `/masterdata/routings/new` | owner | New steps (advanced) | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✗ | 10: Old advanced form still reachable | masterdata_routings_new-owner-390.png / masterdata_routings_new-owner-1440.png |
| 111 | `/masterdata/sites` | owner | Sites | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 1 targets <44px | masterdata_sites-owner-390.png / masterdata_sites-owner-1440.png |
| 112 | `/masterdata/sites/01a18d48-683f-7e2f-9976-6a39ba843d64` | owner | North Fields Plant | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 2: No Next-step box; 3: 11 visible inputs, 4 green Save buttons; 7: Links 20px | masterdata_sites_id-owner-390.png / masterdata_sites_id-owner-1440.png |
| 113 | `/masterdata/suppliers` | owner | Suppliers | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 1 targets <44px | masterdata_suppliers-owner-390.png / masterdata_suppliers-owner-1440.png |
| 114 | `/masterdata/suppliers/01a18d48-7006-7604-8be2-2ccda6da02f6` | owner | Bukidnon Aloe Farms | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 2: No Next-step box (draft supplier: next step to get QA approval is not shown); 7: 1 targets <44px | masterdata_suppliers_id-owner-390.png / masterdata_suppliers_id-owner-1440.png |
| 115 | `/masterdata/suppliers/new` | owner | New supplier | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | masterdata_suppliers_new-owner-390.png / masterdata_suppliers_new-owner-1440.png |
| 116 | `/masterdata/warehouses` | owner | Warehouses | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 1 targets <44px | masterdata_warehouses-owner-390.png / masterdata_warehouses-owner-1440.png |
| 117 | `/masterdata/warehouses/01a18d48-685e-7059-97cb-984d17e35d59` | owner | Main warehouse | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 2: No Next-step box; 3: 7 visible, 4 green Change buttons; 7: Place links 19px | masterdata_warehouses_id-owner-390.png / masterdata_warehouses_id-owner-1440.png |
| 118 | `/masterdata/work-instructions` | owner | How-to sheets | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 1 targets <44px | masterdata_work_instructions-owner-390.png / masterdata_work_instructions-owner-1440.png |
| 119 | `/masterdata/work-instructions/01a18d48-69c3-7527-8d0d-8bff03` | owner | Soap mixing, pouring and cutting (demo) | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 1 targets <44px | masterdata_work_instructions_id-owner-390.png / masterdata_work_instructions_id-owner-1440.png |
| 120 | `/masterdata/work-instructions/new` | owner | New how-to sheet | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |  | masterdata_work_instructions_new-owner-390.png / masterdata_work_instructions_new-owner-1440.png |
| 121 | `/masterdata/lists` | owner | Choice lists | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: "?" 36px, tab 37px wide | masterdata_lists-owner-390.png / masterdata_lists-owner-1440.png |
| 122 | `/masterdata/uom` | owner | Units | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: Edit links 19px tall | masterdata_uom-owner-390.png / masterdata_uom-owner-1440.png |
| 123 | `/masterdata/recipes` | owner | Recipes (advanced) | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 1 targets <44px | masterdata_recipes-owner-390.png / masterdata_recipes-owner-1440.png |
| 124 | `/masterdata/recipes/new` | owner | 1. Which product? | ✗ | – | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | 1: No "This screen is for…" line (wizard heading only); 7: "← All recipes" 19px, "Advanced editing instead" link small; 8: Screens 3 and 4 get a ✓ when empty; screen 5 offers "Send for approval" with no ingredients and no steps; 10: "Advanced editing instead" link to old screens on every wizard screen | masterdata_recipes_new-owner-390.png / masterdata_recipes_new-owner-1440.png |
| 125 | `/masterdata/formulas/01a18d48-69fb-7de0-919c-93ced0500de6/re` | owner | Version 1 of the recipe for Acapulco Soap 135 | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 7: 1 targets <44px | masterdata_formulas_rev-owner-390.png / masterdata_formulas_rev-owner-1440.png |
| 126 | `/masterdata/routings/01a18d48-6a0e-7fc1-a97b-2c06c9e330af/re` | owner | Version 2 of the steps for Acapulco Soap 135  | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 3: 106 visible inputs (every step editable inline); 7: 20px checkboxes | masterdata_routings_rev-owner-390.png / masterdata_routings_rev-owner-1440.png |
| 127 | `/masterdata/products/01a18d48-69ba-7290-96f1-65f87ad80816/sk` | owner | Acapulco Soap 135 g | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | 2: Next step is "Back to the product" (not a next step) | masterdata_products_sku-owner-390.png / masterdata_products_sku-owner-1440.png |
| 128 | `/analytics/trends` | owner | Compare over time | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | 3: 40 visible; 7: 142 small targets (checkbox grid) | analytics_trends-owner-390.png / analytics_trends-owner-1440.png |
| 129 | `/analytics/sales` | owner | Sales numbers | ✓ | – | – | ✓ | ✓ | ✗ | ✗ | – | ✓ | ✓ | 6: KPI-SAL-01, KPI-10, SO numbers; 7: Period chips 36px | analytics_sales-owner-390.png / analytics_sales-owner-1440.png |
| 130 | `/masterdata/recipes/01a18d48-69fb-7de0-919c-93ced0500de6?new` | owner | Recipe: Acapulco Soap 135 g | ✗ | ✗ | – | ✓ | ✗ | ✓ | ✗ | – | ✗ | ✓ | 1: No intro line; 2: No Next-step box; 5: disposition, quarantine; 7: 1 targets <44px; 9: Not listed in PAGE_REVIEW.md at all | masterdata_recipes_id-owner-390.png / masterdata_recipes_id-owner-1440.png |


Extra screens audited outside the table:
- Recipe wizard screens 1–5 at 390 and 1440 (`wizard-1..5-owner-390/1440.png`, `wizard-2-validation-*`). Screen 1: 1 search field + product list ✓. Screen 2: 3 fields; the validation message is plain ("Type how many pieces one batch makes, as a whole number, like 70.") ✓. Screen 3: empty list with "Add the ingredients." banner ✓. Screen 4: big step blocks, 64 px ✓. Screen 5: summary + 3 fields + "Save as draft" / "Send for approval" ✗ (allowed with no ingredients or steps). The sticky Back/Next bar sits above the tab bar and covers about 80 px of content on phones (content scrolls under it; acceptable). No sideways scroll.
- `/floor` at 1920 as floor.nfd (`vp-floor-floor.nfd-1920.png`): ✓ clear TV layout.
- 820 iPad frame for every role (`shell-<role>-820-*.png`) and `vp-dashboard-owner-820.png`.
- Not reachable in the demo: `/admin/imports/[id]` (no import jobs), `/reports/runs/[runId]` (no run links).

## Menu map per role

### Frame (shell) findings for all roles

| Element | 390 phone | 820 iPad | 1440 desktop | Problem |
|---|---|---|---|---|
| Top bar | Menu (44) · logo (36) · To approve (42x40) · Messages bell (40x40) · avatar (40x40) | adds "Scan or search", a sync cloud icon (no label), "To approve" and "Messages" with words | 5 destination pills with icons (the one-line descriptions only appear at 2xl/1536+), site selector, scan icon, "Synced", To approve, bell, avatar | Phone: no Scan at all; 40 px targets. At 820 and 1440, "To approve" and "Messages" show twice on screen (top bar + Home tab row), see `vp-dashboard-owner-820.png` |
| Destination tab row | One swipeable row, 40 px tall; sections behind "More" (which opens the drawer) | same | Pills (~30 px) + dropdown per section | Phone cuts off "Problems & alerts" at the right edge; "More" opens the whole drawer rather than that section |
| Bottom tab bar | Office: Home · Operations · Inventory · Sales · Menu. Operator: Home · My work · Today's count · Scan · Menu. Warehouse: Home · Receive · Scan · Inventory · Menu. QA: Home · Quality check (badge 11) · Operations · Scan · Menu. Finance: Home · Operations · Sales · Menu (4 tabs, no Inventory) | same | hidden | Office roles have no Scan tab. The finance user's "Operations" tab opens a hub with only Receiving/Packing sections |
| Drawer | 5 destinations, each with a one-line description, sections folded, user at the bottom | same | n/a | Close button 36 px. Sync chip is an empty pill with only a cloud icon. Management says "HR, finance, reports and settings" but there is no HR. Section summaries 44 px |
| Help "?" | Only on `/admin/imports`, `/reports`, `/masterdata/lists` (36x36) | same | same | No help "?" in the frame or on most screens; Help sits 2 levels down (Menu › Home › Help & my account › Help & guides) |
| Account menu | avatar 40 px → name, role, site, "My account and devices", Reset demo data, Sign out | | | "Sign out" 33 px tall |

### Item counts per role (drawer)

| Role | Items | Destinations | Notes |
|---|---|---|---|
| owner | 120 | 5 | 17 sub-menus; old Planning tools (6) included |
| manager.nfd | 109 | 5 | |
| auditor | 107 | 5 | |
| qa.nfd | 86 | 5 | |
| admin (system admin) | 84 | 5 | Purchasing section with a single item; no recipe wizard (has "Recipes (advanced)") |
| sales | 52 | 5 | sees Planning tools (old screens) |
| finance | 42 | 4 | no Inventory destination; Operations has only the hub + 3 items |
| warehouse.nfd | 29 | 3 | Operations destination has no main tab; lands on "Deliveries coming" |
| operator.nfd | 10 | 3 | clean; matches the brief's operator model |
| floor.nfd | 0 | – | goes straight to /floor (correct) |

Full lists per role (item → route → screen title, with flags) follow. Section names come from `nav.ts`. "label ≠ title" means the menu word differs from the screen's title.

### admin

- Lands on: `/dashboard`
- Top bar 1440: Bryel's Care home, Scan or search, Sync status: Synced. Open sync, To approve, 1 waiting, Messages, 1 unread, Account, To approve, 1 open
- Top bar 390 (measured size): Open menu →  [44x44], Bryel's Care home → /dashboard [36x36], To approve, 1 waiting → /approvals [42x40], Messages, 1 unread → /notifications [40x40], Account →  [40x40]
- Bottom tab bar (390 and 820): Home · Operations · Inventory · Sales · Menu
- Home tab row (phone, 40 px tall): Overview · To approve 1 · Messages · Problems & alerts · More
- Drawer/menu items: **84**

| Destination › section | Menu item | Route | Screen title | Flag |
|---|---|---|---|---|
| Home | Overview | `/dashboard` | Good evening, <name> |  |
| Home | To approve | `/approvals` | To approve | DUP: top-bar "To approve" + this tab + Problems & alerts "To decide" |
| Home | Messages | `/notifications` | Messages | DUP: top-bar bell + this tab |
| Home | Problems & alerts | `/action-centre` | Problems & alerts | "To decide" tab repeats To approve |
| Home › Help & my account | Help & guides | `/help` | Help | label ≠ title |
| Home › Help & my account | My account | `/account` | My account |  |
| Home › Help & my account | Working without signal | `/sync` | Working without signal |  |
| Operations | Operations Center | `/operations` | Operations Center |  |
| Operations | Production orders | `/production/orders` | Production orders |  |
| Operations | Today's count | `/production/today` | Today | label ≠ title |
| Operations | Rejects | `/production/defects` | Rejects |  |
| Operations | Quality check | `/quality/check` | Batches waiting for QA check | NAME CLASH (Quality check/checks/checks for items); label ≠ title |
| Operations | Floor screen (TV) | `/floor` | Bryel's Care · North Fields Plant | label ≠ title |
| Operations › Receiving | Deliveries received | `/inventory/receipts` | Deliveries received |  |
| Operations › Quality | QA queue | `/quality` | QA queue |  |
| Operations › Quality | Stopped by QA | `/quality/holds` | Stopped by QA |  |
| Operations › Quality | Where it came from and went | `/quality/trace` | Where it came from and where it went | label ≠ title |
| Operations › Quality | Who received it | `/quality/recall` | Who received it (recall check) | label ≠ title |
| Operations › Packing & dispatch | Boxing | `/warehouse/packs` | (not opened) |  |
| Operations › Packing & dispatch | To get from shelf | `/sales/picking` | (not opened) |  |
| Operations › Packing & dispatch | Send out | `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries | `/sales/shipments` | Deliveries | "Deliveries" vs "Deliveries coming/received" |
| Operations › Maintenance | Maintenance | `/maintenance` | Maintenance | "Maintenance" inside "Maintenance" |
| Operations › Maintenance | Regular maintenance | `/maintenance/plans` | Regular maintenance |  |
| Operations › Maintenance | Repair jobs | `/maintenance/work-orders` | Repair jobs |  |
| Operations › Maintenance | Spare parts | `/maintenance/spare-parts` | Spare parts |  |
| Inventory | Stock | `/inventory` | Raw materials | label ≠ title |
| Inventory | Scan or look up | `/inventory/scan` | Scan or search | label ≠ title |
| Inventory | Warehouse sections | `/warehouse` | (not opened) |  |
| Inventory › More stock lists | Shelves | `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks | `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Availability | `/inventory/availability` | Can we deliver? | label ≠ title |
| Inventory › More stock lists | Expiring soon | `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | FEFO & reservations | `/inventory/lots/reservations` | Which one to use first / set aside | jargon "FEFO" in menu; label ≠ title |
| Inventory › More stock lists | Stock changes | `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts | `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Adjustments | `/inventory/adjustments` | Fix stock | label ≠ title |
| Inventory › Counts & labels | Labels to print | `/labels` | Labels to print |  |
| Sales & Customers | Customer orders | `/sales` | Customer orders |  |
| Sales & Customers | Customers | `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board | `/sales/board` | Orders as a board |  |
| Management | Management home | `/management` | Management | label ≠ title |
| Management › Reports & analytics | Business overview | `/analytics/overview` | Business overview | overlaps "Reports" |
| Management › Reports & analytics | Reports | `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time | `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print | `/reports` | Lists to download or print |  |
| Management › Reports & analytics | Lists sent by email | `/reports/schedules` | Lists sent by email |  |
| Management › Purchasing | Suppliers we may buy from | `/procurement/suppliers` | Suppliers we may buy from | 2nd supplier list |
| Management › Production setup | Recipes (advanced) | `/masterdata/formulas` | Recipes (advanced) | advanced, beside wizard |
| Management › Production setup | Steps (advanced) | `/masterdata/routings` | Steps (advanced) | advanced, beside wizard |
| Management › Production setup | How-to sheets | `/masterdata/work-instructions` | How-to sheets |  |
| Management › Production setup | Quality checks for items | `/masterdata/inspection-plans` | Quality checks | NAME CLASH; label ≠ title |
| Management › Production setup | Equipment | `/masterdata/equipment` | Equipment |  |
| Management › Master data | Materials | `/masterdata/materials` | Materials |  |
| Management › Master data | Products | `/masterdata/products` | Products |  |
| Management › Master data | Suppliers | `/masterdata/suppliers` | Suppliers | 2nd supplier list |
| Management › Master data | Locations | `/masterdata/locations` | Locations |  |
| Management › Master data | Sites | `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses | `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines | `/masterdata/lines` | Making areas / lines |  |
| Management › Master data | Units | `/masterdata/uom` | Units |  |
| Management › Master data | Choice lists | `/masterdata/lists` | Choice lists |  |
| Management › Master data | Reasons | `/masterdata/reason-codes` | Reasons |  |
| Management › People & access | People | `/admin/users` | People who use the app | label ≠ title |
| Management › People & access | Roles | `/admin/roles` | Roles (what each job may do) | label ≠ title |
| Management › People & access | Who is signed in | `/admin/sessions` | Who is signed in |  |
| Management › People & access | Sign-in safety | `/admin/security` | Sign-in safety |  |
| Management › IT settings | History of changes | `/admin/audit` | History of changes |  |
| Management › IT settings | Settings | `/admin/settings` | Settings |  |
| Management › IT settings | Who says OK to what | `/admin/approval-rules` | Who says OK to what |  |
| Management › IT settings | How record numbers look | `/admin/numbering` | How record numbers look |  |
| Management › IT settings | Labels and printouts | `/admin/templates` | Labels and printouts |  |
| Management › IT settings | Who gets which message | `/admin/notification-rules` | Who gets which message |  |
| Management › IT settings | Load data from a spreadsheet | `/admin/imports` | Load data from a spreadsheet |  |
| Management › IT settings | Old paper documents | `/admin/imports/legacy-documents` | Old paper documents |  |
| Management › IT settings | Phones and tablets | `/admin/devices` | Phones and tablets |  |
| Management › IT settings | Phone changes to check | `/sync/conflicts` | Phone changes to check |  |
| Management › IT settings | Keeping and deleting old records | `/admin/retention` | Keeping and deleting old records |  |
| Management › IT settings | Health of the system | `/admin/diagnostics` | Health of the system |  |
| Management › IT settings | What each number means | `/analytics/definitions` | What each number means |  |
| Management › Planning tools | Production plan (weeks ahead) | `/production/plan` | Production plan | label ≠ title |
| Management › Planning tools | All batches and their records | `/production` | Batches | OLD (Planning tools); label ≠ title |
| Management › Planning tools | Production orders, full detail | `/production/work-orders` | Production orders | OLD screen ("Older production order screen"), same title as Production orders; label ≠ title |
| Management › Planning tools | Production board, full detail | `/production/board` | Production board | OLD (Planning tools); label ≠ title |

### auditor

- Lands on: `/dashboard`
- Top bar 1440: Bryel's Care home, Scan or search, Sync status: Synced. Open sync, Messages, 0 unread, Account
- Top bar 390 (measured size): Open menu →  [44x44], Bryel's Care home → /dashboard [36x36], Messages, 0 unread → /notifications [40x40], Account →  [40x40]
- Bottom tab bar (390 and 820): Home · Operations · Inventory · Sales · Menu
- Home tab row (phone, 40 px tall): Overview · Messages · Problems & alerts · More
- Drawer/menu items: **107**

| Destination › section | Menu item | Route | Screen title | Flag |
|---|---|---|---|---|
| Home | Overview | `/dashboard` | Good evening, <name> |  |
| Home | Messages | `/notifications` | Messages | DUP: top-bar bell + this tab |
| Home | Problems & alerts | `/action-centre` | Problems & alerts | "To decide" tab repeats To approve |
| Home › Help & my account | Help & guides | `/help` | Help | label ≠ title |
| Home › Help & my account | My account | `/account` | My account |  |
| Home › Help & my account | Working without signal | `/sync` | Working without signal |  |
| Operations | Operations Center | `/operations` | Operations Center |  |
| Operations | Production orders | `/production/orders` | Production orders |  |
| Operations | Today's count | `/production/today` | Today | label ≠ title |
| Operations | Rejects | `/production/defects` | Rejects |  |
| Operations | Quality check | `/quality/check` | Batches waiting for QA check | NAME CLASH (Quality check/checks/checks for items); label ≠ title |
| Operations | Floor screen (TV) | `/floor` | Bryel's Care · North Fields Plant | label ≠ title |
| Operations › Receiving | Deliveries coming | `/procurement/expected` | Deliveries coming |  |
| Operations › Receiving | Deliveries received | `/inventory/receipts` | Deliveries received |  |
| Operations › Quality | QA queue | `/quality` | QA queue |  |
| Operations › Quality | Quality checks | `/quality/inspections` | Quality checks (tests) | NAME CLASH; label ≠ title |
| Operations › Quality | Problem reports | `/quality/deviations` | Problem reports |  |
| Operations › Quality | Stopped by QA | `/quality/holds` | Stopped by QA |  |
| Operations › Quality | Where it came from and went | `/quality/trace` | Where it came from and where it went | label ≠ title |
| Operations › Quality | Customer complaints | `/quality/complaints` | Customer complaints |  |
| Operations › Quality | Who received it | `/quality/recall` | Who received it (recall check) | label ≠ title |
| Operations › Quality | Product recalls | `/quality/recalls` | Product recalls |  |
| Operations › Quality | Fix-and-prevent plans | `/quality/capa` | Fix-and-prevent plans |  |
| Operations › Quality | Change requests | `/quality/changes` | Change requests |  |
| Operations › Packing & dispatch | Boxing | `/warehouse/packs` | (not opened) |  |
| Operations › Packing & dispatch | To get from shelf | `/sales/picking` | (not opened) |  |
| Operations › Packing & dispatch | Send out | `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries | `/sales/shipments` | Deliveries | "Deliveries" vs "Deliveries coming/received" |
| Operations › Maintenance | Maintenance | `/maintenance` | Maintenance | "Maintenance" inside "Maintenance" |
| Operations › Maintenance | Regular maintenance | `/maintenance/plans` | Regular maintenance |  |
| Operations › Maintenance | Repair jobs | `/maintenance/work-orders` | Repair jobs |  |
| Operations › Maintenance | Spare parts | `/maintenance/spare-parts` | Spare parts |  |
| Inventory | Stock | `/inventory` | Raw materials | label ≠ title |
| Inventory | Scan or look up | `/inventory/scan` | Scan or search | label ≠ title |
| Inventory | Warehouse sections | `/warehouse` | (not opened) |  |
| Inventory › More stock lists | Shelves | `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks | `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Availability | `/inventory/availability` | Can we deliver? | label ≠ title |
| Inventory › More stock lists | Expiring soon | `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | FEFO & reservations | `/inventory/lots/reservations` | Which one to use first / set aside | jargon "FEFO" in menu; label ≠ title |
| Inventory › More stock lists | Stock changes | `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts | `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Adjustments | `/inventory/adjustments` | Fix stock | label ≠ title |
| Inventory › Counts & labels | Labels to print | `/labels` | Labels to print |  |
| Sales & Customers | Customer orders | `/sales` | Customer orders |  |
| Sales & Customers | Customers | `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board | `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Price offers | `/sales/quotations` | (not opened) |  |
| Sales & Customers › Quotes, prices & returns | Prices | `/sales/price-lists` | (not opened) |  |
| Sales & Customers › Quotes, prices & returns | Customer returns | `/sales/returns` | (not opened) |  |
| Sales & Customers › Billing & payments | Invoices | `/finance/invoices` | Invoices |  |
| Sales & Customers › Billing & payments | Payments | `/finance/payments` | Payments |  |
| Sales & Customers › Billing & payments | Statements | `/finance/statements` | Customer statements | label ≠ title |
| Sales & Customers › Billing & payments | Credits (money back) | `/finance/credit-notes` | Credits (money back) |  |
| Management | Management home | `/management` | Management | label ≠ title |
| Management › Reports & analytics | Business overview | `/analytics/overview` | Business overview | overlaps "Reports" |
| Management › Reports & analytics | Reports | `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time | `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print | `/reports` | Lists to download or print |  |
| Management › Reports & analytics | Lists sent by email | `/reports/schedules` | Lists sent by email |  |
| Management › Purchasing | Purchasing | `/procurement` | Purchasing | "Purchasing" inside "Purchasing" |
| Management › Purchasing | Requests to buy | `/procurement/requests` | Requests to buy |  |
| Management › Purchasing | Purchase orders | `/procurement/orders` | Purchase orders |  |
| Management › Purchasing | Send back to supplier | `/procurement/returns` | Send back to supplier |  |
| Management › Purchasing | Suppliers we may buy from | `/procurement/suppliers` | Suppliers we may buy from | 2nd supplier list |
| Management › Purchasing | Running low | `/procurement/reorder` | Running low |  |
| Management › Purchasing | How suppliers do | `/procurement/performance` | How suppliers do |  |
| Management › Purchasing | Sales guess | `/procurement/forecast` | Sales guess |  |
| Management › Finance | Money | `/finance` | Money |  |
| Management › Finance | Supplier bills | `/finance/bills` | Supplier bills |  |
| Management › Finance | Close the month | `/finance/periods` | Close the month |  |
| Management › Finance | Tax rates | `/finance/tax` | Tax rates |  |
| Management › Production setup | Recipes (advanced) | `/masterdata/formulas` | Recipes (advanced) | advanced, beside wizard |
| Management › Production setup | Steps (advanced) | `/masterdata/routings` | Steps (advanced) | advanced, beside wizard |
| Management › Production setup | How-to sheets | `/masterdata/work-instructions` | How-to sheets |  |
| Management › Production setup | Quality checks for items | `/masterdata/inspection-plans` | Quality checks | NAME CLASH; label ≠ title |
| Management › Production setup | Equipment | `/masterdata/equipment` | Equipment |  |
| Management › Master data | Materials | `/masterdata/materials` | Materials |  |
| Management › Master data | Products | `/masterdata/products` | Products |  |
| Management › Master data | Suppliers | `/masterdata/suppliers` | Suppliers | 2nd supplier list |
| Management › Master data | Locations | `/masterdata/locations` | Locations |  |
| Management › Master data | Sites | `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses | `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines | `/masterdata/lines` | Making areas / lines |  |
| Management › Master data | Units | `/masterdata/uom` | Units |  |
| Management › Master data | Choice lists | `/masterdata/lists` | Choice lists |  |
| Management › Master data | Reasons | `/masterdata/reason-codes` | Reasons |  |
| Management › People & access | People | `/admin/users` | People who use the app | label ≠ title |
| Management › People & access | Roles | `/admin/roles` | Roles (what each job may do) | label ≠ title |
| Management › People & access | Who is signed in | `/admin/sessions` | Who is signed in |  |
| Management › IT settings | History of changes | `/admin/audit` | History of changes |  |
| Management › IT settings | Settings | `/admin/settings` | Settings |  |
| Management › IT settings | Who says OK to what | `/admin/approval-rules` | Who says OK to what |  |
| Management › IT settings | How record numbers look | `/admin/numbering` | How record numbers look |  |
| Management › IT settings | Labels and printouts | `/admin/templates` | Labels and printouts |  |
| Management › IT settings | Who gets which message | `/admin/notification-rules` | Who gets which message |  |
| Management › IT settings | Load data from a spreadsheet | `/admin/imports` | Load data from a spreadsheet |  |
| Management › IT settings | Old paper documents | `/admin/imports/legacy-documents` | Old paper documents |  |
| Management › IT settings | Phones and tablets | `/admin/devices` | Phones and tablets |  |
| Management › IT settings | Phone changes to check | `/sync/conflicts` | Phone changes to check |  |
| Management › IT settings | Keeping and deleting old records | `/admin/retention` | Keeping and deleting old records |  |
| Management › IT settings | Health of the system | `/admin/diagnostics` | Health of the system |  |
| Management › IT settings | What each number means | `/analytics/definitions` | What each number means |  |
| Management › Planning tools | Production plan (weeks ahead) | `/production/plan` | Production plan | label ≠ title |
| Management › Planning tools | All batches and their records | `/production` | Batches | OLD (Planning tools); label ≠ title |
| Management › Planning tools | Production orders, full detail | `/production/work-orders` | Production orders | OLD screen ("Older production order screen"), same title as Production orders; label ≠ title |
| Management › Planning tools | Production board, full detail | `/production/board` | Production board | OLD (Planning tools); label ≠ title |

### finance

- Lands on: `/dashboard`
- Top bar 1440: Bryel's Care home, Scan or search, Sync status: Synced. Open sync, To approve, 3 waiting, Messages, 0 unread, Account, To approve, 3 open
- Top bar 390 (measured size): Open menu →  [44x44], Bryel's Care home → /dashboard [36x36], To approve, 3 waiting → /approvals [42x40], Messages, 0 unread → /notifications [40x40], Account →  [40x40]
- Bottom tab bar (390 and 820): Home · Operations · Sales · Menu
- Home tab row (phone, 40 px tall): Overview · To approve 3 · Messages · Problems & alerts · More
- Drawer/menu items: **42**

| Destination › section | Menu item | Route | Screen title | Flag |
|---|---|---|---|---|
| Home | Overview | `/dashboard` | Good evening, <name> |  |
| Home | To approve | `/approvals` | To approve | DUP: top-bar "To approve" + this tab + Problems & alerts "To decide" |
| Home | Messages | `/notifications` | Messages | DUP: top-bar bell + this tab |
| Home | Problems & alerts | `/action-centre` | Problems & alerts | "To decide" tab repeats To approve |
| Home › Help & my account | Help & guides | `/help` | Help | label ≠ title |
| Home › Help & my account | My account | `/account` | My account |  |
| Home › Help & my account | Working without signal | `/sync` | Working without signal |  |
| Home › Help & my account | My expense claims | `/finance/expenses` | Expense claims | same screen as "Expense approvals"; label ≠ title |
| Operations | Operations Center | `/operations` | Operations Center |  |
| Operations › Receiving | Deliveries coming | `/procurement/expected` | Deliveries coming |  |
| Operations › Packing & dispatch | Send out | `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries | `/sales/shipments` | Deliveries | "Deliveries" vs "Deliveries coming/received" |
| Sales & Customers | Customer orders | `/sales` | Customer orders |  |
| Sales & Customers | Customers | `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board | `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Price offers | `/sales/quotations` | (not opened) |  |
| Sales & Customers › Quotes, prices & returns | Prices | `/sales/price-lists` | (not opened) |  |
| Sales & Customers › Billing & payments | Invoices | `/finance/invoices` | Invoices |  |
| Sales & Customers › Billing & payments | Payments | `/finance/payments` | Payments |  |
| Sales & Customers › Billing & payments | Statements | `/finance/statements` | Customer statements | label ≠ title |
| Sales & Customers › Billing & payments | Credits (money back) | `/finance/credit-notes` | Credits (money back) |  |
| Management | Management home | `/management` | Management | label ≠ title |
| Management › Reports & analytics | Business overview | `/analytics/overview` | Business overview | overlaps "Reports" |
| Management › Reports & analytics | Reports | `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time | `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print | `/reports` | Lists to download or print |  |
| Management › Reports & analytics | Lists sent by email | `/reports/schedules` | Lists sent by email |  |
| Management › Purchasing | Purchasing | `/procurement` | Purchasing | "Purchasing" inside "Purchasing" |
| Management › Purchasing | Requests to buy | `/procurement/requests` | Requests to buy |  |
| Management › Purchasing | Purchase orders | `/procurement/orders` | Purchase orders |  |
| Management › Purchasing | Send back to supplier | `/procurement/returns` | Send back to supplier |  |
| Management › Purchasing | Suppliers we may buy from | `/procurement/suppliers` | Suppliers we may buy from | 2nd supplier list |
| Management › Purchasing | How suppliers do | `/procurement/performance` | How suppliers do |  |
| Management › Purchasing | Sales guess | `/procurement/forecast` | Sales guess |  |
| Management › Finance | Money | `/finance` | Money |  |
| Management › Finance | Supplier bills | `/finance/bills` | Supplier bills |  |
| Management › Finance | Expense approvals | `/finance/expenses?status=to_approve` | Expense claims | same screen as "My expense claims"; also in To approve; label ≠ title |
| Management › Finance | Close the month | `/finance/periods` | Close the month |  |
| Management › Finance | Tax rates | `/finance/tax` | Tax rates |  |
| Management › Master data | Products | `/masterdata/products` | Products |  |
| Management › Master data | Suppliers | `/masterdata/suppliers` | Suppliers | 2nd supplier list |
| Management › IT settings | What each number means | `/analytics/definitions` | What each number means |  |

### floor.nfd

- Lands on: `/floor`
- Top bar 1440: 
- Top bar 390 (measured size): 
- Bottom tab bar (390 and 820): 
- Home tab row (phone, 40 px tall): 
- No menu at all: the TV account opens /floor with no app frame (correct, ADR-084).

### manager.nfd

- Lands on: `/dashboard`
- Top bar 1440: Bryel's Care home, Scan or search, Sync status: Synced. Open sync, To approve, 8 waiting, Messages, 30 unread, Account, To approve, 8 open
- Top bar 390 (measured size): Open menu →  [44x44], Bryel's Care home → /dashboard [36x36], To approve, 8 waiting → /approvals [42x40], Messages, 30 unread → /notifications [40x40], Account →  [40x40]
- Bottom tab bar (390 and 820): Home · Operations · Inventory · Sales · Menu
- Home tab row (phone, 40 px tall): Overview · To approve 8 · Messages · Problems & alerts · More
- Drawer/menu items: **109**

| Destination › section | Menu item | Route | Screen title | Flag |
|---|---|---|---|---|
| Home | Overview | `/dashboard` | Good evening, <name> |  |
| Home | To approve | `/approvals` | To approve | DUP: top-bar "To approve" + this tab + Problems & alerts "To decide" |
| Home | Messages | `/notifications` | Messages | DUP: top-bar bell + this tab |
| Home | Problems & alerts | `/action-centre` | Problems & alerts | "To decide" tab repeats To approve |
| Home › Help & my account | Help & guides | `/help` | Help | label ≠ title |
| Home › Help & my account | My account | `/account` | My account |  |
| Home › Help & my account | Working without signal | `/sync` | Working without signal |  |
| Operations | Operations Center | `/operations` | Operations Center |  |
| Operations | Production orders | `/production/orders` | Production orders |  |
| Operations | Today's count | `/production/today` | Today | label ≠ title |
| Operations | Rejects | `/production/defects` | Rejects |  |
| Operations | Quality check | `/quality/check` | Batches waiting for QA check | NAME CLASH (Quality check/checks/checks for items); label ≠ title |
| Operations | Floor screen (TV) | `/floor` | Bryel's Care · North Fields Plant | label ≠ title |
| Operations › Receiving | Deliveries coming | `/procurement/expected` | Deliveries coming |  |
| Operations › Receiving | Receive materials | `/inventory/receive` | Receive a delivery | label ≠ title |
| Operations › Receiving | Deliveries received | `/inventory/receipts` | Deliveries received |  |
| Operations › Receiving | Put away | `/inventory/receive/put-away` | Put away |  |
| Operations › Quality | QA queue | `/quality` | QA queue |  |
| Operations › Quality | Quality checks | `/quality/inspections` | Quality checks (tests) | NAME CLASH; label ≠ title |
| Operations › Quality | Problem reports | `/quality/deviations` | Problem reports |  |
| Operations › Quality | Stopped by QA | `/quality/holds` | Stopped by QA |  |
| Operations › Quality | Where it came from and went | `/quality/trace` | Where it came from and where it went | label ≠ title |
| Operations › Quality | Customer complaints | `/quality/complaints` | Customer complaints |  |
| Operations › Quality | Who received it | `/quality/recall` | Who received it (recall check) | label ≠ title |
| Operations › Quality | Product recalls | `/quality/recalls` | Product recalls |  |
| Operations › Quality | Fix-and-prevent plans | `/quality/capa` | Fix-and-prevent plans |  |
| Operations › Quality | Change requests | `/quality/changes` | Change requests |  |
| Operations › Packing & dispatch | Boxing | `/warehouse/packs` | (not opened) |  |
| Operations › Packing & dispatch | Repack for a customer | `/warehouse/repack` | (not opened) |  |
| Operations › Packing & dispatch | Check labels in an area | `/quality/label-verification` | Check the labels in an area | label ≠ title |
| Operations › Packing & dispatch | To get from shelf | `/sales/picking` | (not opened) |  |
| Operations › Packing & dispatch | Send out | `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries | `/sales/shipments` | Deliveries | "Deliveries" vs "Deliveries coming/received" |
| Operations › Maintenance | Maintenance | `/maintenance` | Maintenance | "Maintenance" inside "Maintenance" |
| Operations › Maintenance | Regular maintenance | `/maintenance/plans` | Regular maintenance |  |
| Operations › Maintenance | Repair jobs | `/maintenance/work-orders` | Repair jobs |  |
| Operations › Maintenance | Spare parts | `/maintenance/spare-parts` | Spare parts |  |
| Inventory | Stock | `/inventory` | Raw materials | label ≠ title |
| Inventory | Scan or look up | `/inventory/scan` | Scan or search | label ≠ title |
| Inventory | Move stock | `/inventory/move` | Move stock |  |
| Inventory | Warehouse sections | `/warehouse` | (not opened) |  |
| Inventory › More stock lists | Shelves | `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks | `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Availability | `/inventory/availability` | Can we deliver? | label ≠ title |
| Inventory › More stock lists | Expiring soon | `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | FEFO & reservations | `/inventory/lots/reservations` | Which one to use first / set aside | jargon "FEFO" in menu; label ≠ title |
| Inventory › More stock lists | Stock changes | `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts | `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Adjustments | `/inventory/adjustments` | Fix stock | label ≠ title |
| Inventory › Counts & labels | Labels to print | `/labels` | Labels to print |  |
| Sales & Customers | Customer orders | `/sales` | Customer orders |  |
| Sales & Customers | Customers | `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board | `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Price offers | `/sales/quotations` | (not opened) |  |
| Sales & Customers › Quotes, prices & returns | Customer returns | `/sales/returns` | (not opened) |  |
| Sales & Customers › Billing & payments | Invoices | `/finance/invoices` | Invoices |  |
| Sales & Customers › Billing & payments | Statements | `/finance/statements` | Customer statements | label ≠ title |
| Management | Management home | `/management` | Management | label ≠ title |
| Management › Reports & analytics | Business overview | `/analytics/overview` | Business overview | overlaps "Reports" |
| Management › Reports & analytics | Reports | `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time | `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print | `/reports` | Lists to download or print |  |
| Management › Reports & analytics | Lists sent by email | `/reports/schedules` | Lists sent by email |  |
| Management › Purchasing | Purchasing | `/procurement` | Purchasing | "Purchasing" inside "Purchasing" |
| Management › Purchasing | Requests to buy | `/procurement/requests` | Requests to buy |  |
| Management › Purchasing | Purchase orders | `/procurement/orders` | Purchase orders |  |
| Management › Purchasing | Send back to supplier | `/procurement/returns` | Send back to supplier |  |
| Management › Purchasing | Suppliers we may buy from | `/procurement/suppliers` | Suppliers we may buy from | 2nd supplier list |
| Management › Purchasing | Running low | `/procurement/reorder` | Running low |  |
| Management › Purchasing | How suppliers do | `/procurement/performance` | How suppliers do |  |
| Management › Purchasing | Sales guess | `/procurement/forecast` | Sales guess |  |
| Management › Finance | Money | `/finance` | Money |  |
| Management › Finance | Supplier bills | `/finance/bills` | Supplier bills |  |
| Management › Finance | Expense approvals | `/finance/expenses?status=to_approve` | Expense claims | same screen as "My expense claims"; also in To approve; label ≠ title |
| Management › Production setup | New recipe (step by step) | `/masterdata/recipes/new` | 1. Which product? | label ≠ title |
| Management › Production setup | Recipes (advanced) | `/masterdata/formulas` | Recipes (advanced) | advanced, beside wizard |
| Management › Production setup | Steps (advanced) | `/masterdata/routings` | Steps (advanced) | advanced, beside wizard |
| Management › Production setup | How-to sheets | `/masterdata/work-instructions` | How-to sheets |  |
| Management › Production setup | Quality checks for items | `/masterdata/inspection-plans` | Quality checks | NAME CLASH; label ≠ title |
| Management › Production setup | Equipment | `/masterdata/equipment` | Equipment |  |
| Management › Master data | Materials | `/masterdata/materials` | Materials |  |
| Management › Master data | Products | `/masterdata/products` | Products |  |
| Management › Master data | Suppliers | `/masterdata/suppliers` | Suppliers | 2nd supplier list |
| Management › Master data | Locations | `/masterdata/locations` | Locations |  |
| Management › Master data | Sites | `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses | `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines | `/masterdata/lines` | Making areas / lines |  |
| Management › Master data | Units | `/masterdata/uom` | Units |  |
| Management › Master data | Choice lists | `/masterdata/lists` | Choice lists |  |
| Management › Master data | Reasons | `/masterdata/reason-codes` | Reasons |  |
| Management › People & access | People | `/admin/users` | People who use the app | label ≠ title |
| Management › People & access | Roles | `/admin/roles` | Roles (what each job may do) | label ≠ title |
| Management › IT settings | History of changes | `/admin/audit` | History of changes |  |
| Management › IT settings | Who says OK to what | `/admin/approval-rules` | Who says OK to what |  |
| Management › IT settings | How record numbers look | `/admin/numbering` | How record numbers look |  |
| Management › IT settings | Labels and printouts | `/admin/templates` | Labels and printouts |  |
| Management › IT settings | Who gets which message | `/admin/notification-rules` | Who gets which message |  |
| Management › IT settings | Load data from a spreadsheet | `/admin/imports` | Load data from a spreadsheet |  |
| Management › IT settings | Old paper documents | `/admin/imports/legacy-documents` | Old paper documents |  |
| Management › IT settings | Phones and tablets | `/admin/devices` | Phones and tablets |  |
| Management › IT settings | Phone changes to check | `/sync/conflicts` | Phone changes to check |  |
| Management › IT settings | Health of the system | `/admin/diagnostics` | Health of the system |  |
| Management › IT settings | What each number means | `/analytics/definitions` | What each number means |  |
| Management › Planning tools | Production plan (weeks ahead) | `/production/plan` | Production plan | label ≠ title |
| Management › Planning tools | All batches and their records | `/production` | Batches | OLD (Planning tools); label ≠ title |
| Management › Planning tools | Production orders, full detail | `/production/work-orders` | Production orders | OLD screen ("Older production order screen"), same title as Production orders; label ≠ title |
| Management › Planning tools | Production board, full detail | `/production/board` | Production board | OLD (Planning tools); label ≠ title |
| Management › Planning tools | Get materials by scanning | `/production/staging` | Stage materials | OLD (Planning tools); label ≠ title |
| Management › Planning tools | Make a batch without an order | `/production/new` | New batch | OLD; label contradicts intro; label ≠ title |

### operator.nfd

- Lands on: `/dashboard`
- Top bar 1440: Bryel's Care home, Scan or search, Sync status: Synced. Open sync, Messages, 0 unread, Account
- Top bar 390 (measured size): Open menu →  [44x44], Bryel's Care home → /dashboard [36x36], Messages, 0 unread → /notifications [40x40], Account →  [40x40]
- Bottom tab bar (390 and 820): Home · My work · Today's count · Scan · Menu
- Home tab row (phone, 40 px tall): Overview · Messages · More
- Drawer/menu items: **10**

| Destination › section | Menu item | Route | Screen title | Flag |
|---|---|---|---|---|
| Home | Overview | `/dashboard` | Good evening, <name> |  |
| Home | Messages | `/notifications` | Messages | DUP: top-bar bell + this tab |
| Home › Help & my account | Help & guides | `/help` | Help | label ≠ title |
| Home › Help & my account | My account | `/account` | My account |  |
| Home › Help & my account | Working without signal | `/sync` | Working without signal |  |
| Home › Help & my account | My expense claims | `/finance/expenses` | Expense claims | same screen as "Expense approvals"; label ≠ title |
| Operations | My work | `/production/orders` | Production orders | label ≠ title |
| Operations | Today's count | `/production/today` | Today | label ≠ title |
| Inventory | Stock | `/inventory` | Raw materials | label ≠ title |
| Inventory | Scan or look up | `/inventory/scan` | Scan or search | label ≠ title |

### owner

- Lands on: `/dashboard`
- Top bar 1440: Bryel's Care home, Scan or search, Sync status: Synced. Open sync, To approve, 17 waiting, Messages, 2 unread, Account, To approve, 17 open
- Top bar 390 (measured size): Open menu →  [44x44], Bryel's Care home → /dashboard [36x36], To approve, 17 waiting → /approvals [42x40], Messages, 2 unread → /notifications [40x40], Account →  [40x40]
- Bottom tab bar (390 and 820): Home · Operations · Inventory · Sales · Menu
- Home tab row (phone, 40 px tall): Overview · To approve 17 · Messages · Problems & alerts · More
- Drawer/menu items: **120**

| Destination › section | Menu item | Route | Screen title | Flag |
|---|---|---|---|---|
| Home | Overview | `/dashboard` | Good evening, <name> |  |
| Home | To approve | `/approvals` | To approve | DUP: top-bar "To approve" + this tab + Problems & alerts "To decide" |
| Home | Messages | `/notifications` | Messages | DUP: top-bar bell + this tab |
| Home | Problems & alerts | `/action-centre` | Problems & alerts | "To decide" tab repeats To approve |
| Home › Help & my account | Help & guides | `/help` | Help | label ≠ title |
| Home › Help & my account | My account | `/account` | My account |  |
| Home › Help & my account | Working without signal | `/sync` | Working without signal |  |
| Home › Help & my account | My expense claims | `/finance/expenses` | Expense claims | same screen as "Expense approvals"; label ≠ title |
| Operations | Operations Center | `/operations` | Operations Center |  |
| Operations | Production orders | `/production/orders` | Production orders |  |
| Operations | Today's count | `/production/today` | Today | label ≠ title |
| Operations | Rejects | `/production/defects` | Rejects |  |
| Operations | Quality check | `/quality/check` | Batches waiting for QA check | NAME CLASH (Quality check/checks/checks for items); label ≠ title |
| Operations | Floor screen (TV) | `/floor` | Bryel's Care · North Fields Plant | label ≠ title |
| Operations › Receiving | Deliveries coming | `/procurement/expected` | Deliveries coming |  |
| Operations › Receiving | Receive materials | `/inventory/receive` | Receive a delivery | label ≠ title |
| Operations › Receiving | Deliveries received | `/inventory/receipts` | Deliveries received |  |
| Operations › Receiving | Put away | `/inventory/receive/put-away` | Put away |  |
| Operations › Quality | QA queue | `/quality` | QA queue |  |
| Operations › Quality | Quality checks | `/quality/inspections` | Quality checks (tests) | NAME CLASH; label ≠ title |
| Operations › Quality | Problem reports | `/quality/deviations` | Problem reports |  |
| Operations › Quality | Stopped by QA | `/quality/holds` | Stopped by QA |  |
| Operations › Quality | Decide many lots at once | `/quality/bulk` | Decide many lots at once |  |
| Operations › Quality | Where it came from and went | `/quality/trace` | Where it came from and where it went | label ≠ title |
| Operations › Quality | Customer complaints | `/quality/complaints` | Customer complaints |  |
| Operations › Quality | Who received it | `/quality/recall` | Who received it (recall check) | label ≠ title |
| Operations › Quality | Product recalls | `/quality/recalls` | Product recalls |  |
| Operations › Quality | Fix-and-prevent plans | `/quality/capa` | Fix-and-prevent plans |  |
| Operations › Quality | Change requests | `/quality/changes` | Change requests |  |
| Operations › Packing & dispatch | Boxing | `/warehouse/packs` | (not opened) |  |
| Operations › Packing & dispatch | Repack for a customer | `/warehouse/repack` | (not opened) |  |
| Operations › Packing & dispatch | Check labels in an area | `/quality/label-verification` | Check the labels in an area | label ≠ title |
| Operations › Packing & dispatch | To get from shelf | `/sales/picking` | (not opened) |  |
| Operations › Packing & dispatch | Send out | `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries | `/sales/shipments` | Deliveries | "Deliveries" vs "Deliveries coming/received" |
| Operations › Maintenance | Maintenance | `/maintenance` | Maintenance | "Maintenance" inside "Maintenance" |
| Operations › Maintenance | Regular maintenance | `/maintenance/plans` | Regular maintenance |  |
| Operations › Maintenance | Repair jobs | `/maintenance/work-orders` | Repair jobs |  |
| Operations › Maintenance | Spare parts | `/maintenance/spare-parts` | Spare parts |  |
| Inventory | Stock | `/inventory` | Raw materials | label ≠ title |
| Inventory | Scan or look up | `/inventory/scan` | Scan or search | label ≠ title |
| Inventory | Move stock | `/inventory/move` | Move stock |  |
| Inventory | Warehouse sections | `/warehouse` | (not opened) |  |
| Inventory › More stock lists | Shelves | `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks | `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Availability | `/inventory/availability` | Can we deliver? | label ≠ title |
| Inventory › More stock lists | Expiring soon | `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | FEFO & reservations | `/inventory/lots/reservations` | Which one to use first / set aside | jargon "FEFO" in menu; label ≠ title |
| Inventory › More stock lists | Stock changes | `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts | `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Adjustments | `/inventory/adjustments` | Fix stock | label ≠ title |
| Inventory › Counts & labels | Labels to print | `/labels` | Labels to print |  |
| Sales & Customers | Customer orders | `/sales` | Customer orders |  |
| Sales & Customers | Customers | `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board | `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Price offers | `/sales/quotations` | (not opened) |  |
| Sales & Customers › Quotes, prices & returns | Prices | `/sales/price-lists` | (not opened) |  |
| Sales & Customers › Quotes, prices & returns | Customer returns | `/sales/returns` | (not opened) |  |
| Sales & Customers › Billing & payments | Invoices | `/finance/invoices` | Invoices |  |
| Sales & Customers › Billing & payments | Payments | `/finance/payments` | Payments |  |
| Sales & Customers › Billing & payments | Statements | `/finance/statements` | Customer statements | label ≠ title |
| Sales & Customers › Billing & payments | Credits (money back) | `/finance/credit-notes` | Credits (money back) |  |
| Management | Management home | `/management` | Management | label ≠ title |
| Management › Reports & analytics | Business overview | `/analytics/overview` | Business overview | overlaps "Reports" |
| Management › Reports & analytics | Reports | `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time | `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print | `/reports` | Lists to download or print |  |
| Management › Reports & analytics | Lists sent by email | `/reports/schedules` | Lists sent by email |  |
| Management › Purchasing | Purchasing | `/procurement` | Purchasing | "Purchasing" inside "Purchasing" |
| Management › Purchasing | Requests to buy | `/procurement/requests` | Requests to buy |  |
| Management › Purchasing | Purchase orders | `/procurement/orders` | Purchase orders |  |
| Management › Purchasing | Send back to supplier | `/procurement/returns` | Send back to supplier |  |
| Management › Purchasing | Suppliers we may buy from | `/procurement/suppliers` | Suppliers we may buy from | 2nd supplier list |
| Management › Purchasing | Running low | `/procurement/reorder` | Running low |  |
| Management › Purchasing | How suppliers do | `/procurement/performance` | How suppliers do |  |
| Management › Purchasing | Sales guess | `/procurement/forecast` | Sales guess |  |
| Management › Finance | Money | `/finance` | Money |  |
| Management › Finance | Supplier bills | `/finance/bills` | Supplier bills |  |
| Management › Finance | Expense approvals | `/finance/expenses?status=to_approve` | Expense claims | same screen as "My expense claims"; also in To approve; label ≠ title |
| Management › Finance | Close the month | `/finance/periods` | Close the month |  |
| Management › Finance | Tax rates | `/finance/tax` | Tax rates |  |
| Management › Production setup | New recipe (step by step) | `/masterdata/recipes/new` | 1. Which product? | label ≠ title |
| Management › Production setup | Recipes (advanced) | `/masterdata/formulas` | Recipes (advanced) | advanced, beside wizard |
| Management › Production setup | Steps (advanced) | `/masterdata/routings` | Steps (advanced) | advanced, beside wizard |
| Management › Production setup | How-to sheets | `/masterdata/work-instructions` | How-to sheets |  |
| Management › Production setup | Quality checks for items | `/masterdata/inspection-plans` | Quality checks | NAME CLASH; label ≠ title |
| Management › Production setup | Equipment | `/masterdata/equipment` | Equipment |  |
| Management › Master data | Materials | `/masterdata/materials` | Materials |  |
| Management › Master data | Products | `/masterdata/products` | Products |  |
| Management › Master data | Suppliers | `/masterdata/suppliers` | Suppliers | 2nd supplier list |
| Management › Master data | Locations | `/masterdata/locations` | Locations |  |
| Management › Master data | Sites | `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses | `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines | `/masterdata/lines` | Making areas / lines |  |
| Management › Master data | Units | `/masterdata/uom` | Units |  |
| Management › Master data | Choice lists | `/masterdata/lists` | Choice lists |  |
| Management › Master data | Reasons | `/masterdata/reason-codes` | Reasons |  |
| Management › People & access | People | `/admin/users` | People who use the app | label ≠ title |
| Management › People & access | Roles | `/admin/roles` | Roles (what each job may do) | label ≠ title |
| Management › People & access | Who is signed in | `/admin/sessions` | Who is signed in |  |
| Management › People & access | Sign-in safety | `/admin/security` | Sign-in safety |  |
| Management › IT settings | History of changes | `/admin/audit` | History of changes |  |
| Management › IT settings | Settings | `/admin/settings` | Settings |  |
| Management › IT settings | Who says OK to what | `/admin/approval-rules` | Who says OK to what |  |
| Management › IT settings | How record numbers look | `/admin/numbering` | How record numbers look |  |
| Management › IT settings | Labels and printouts | `/admin/templates` | Labels and printouts |  |
| Management › IT settings | Who gets which message | `/admin/notification-rules` | Who gets which message |  |
| Management › IT settings | Load data from a spreadsheet | `/admin/imports` | Load data from a spreadsheet |  |
| Management › IT settings | Old paper documents | `/admin/imports/legacy-documents` | Old paper documents |  |
| Management › IT settings | Phones and tablets | `/admin/devices` | Phones and tablets |  |
| Management › IT settings | Phone changes to check | `/sync/conflicts` | Phone changes to check |  |
| Management › IT settings | Keeping and deleting old records | `/admin/retention` | Keeping and deleting old records |  |
| Management › IT settings | Health of the system | `/admin/diagnostics` | Health of the system |  |
| Management › IT settings | What each number means | `/analytics/definitions` | What each number means |  |
| Management › Planning tools | Production plan (weeks ahead) | `/production/plan` | Production plan | label ≠ title |
| Management › Planning tools | All batches and their records | `/production` | Batches | OLD (Planning tools); label ≠ title |
| Management › Planning tools | Production orders, full detail | `/production/work-orders` | Production orders | OLD screen ("Older production order screen"), same title as Production orders; label ≠ title |
| Management › Planning tools | Production board, full detail | `/production/board` | Production board | OLD (Planning tools); label ≠ title |
| Management › Planning tools | Get materials by scanning | `/production/staging` | Stage materials | OLD (Planning tools); label ≠ title |
| Management › Planning tools | Make a batch without an order | `/production/new` | New batch | OLD; label contradicts intro; label ≠ title |

### qa.nfd

- Lands on: `/dashboard`
- Top bar 1440: Bryel's Care home, Scan or search, Sync status: Synced. Open sync, To approve, 4 waiting, Messages, 13 unread, Account, To approve, 4 open
- Top bar 390 (measured size): Open menu →  [44x44], Bryel's Care home → /dashboard [36x36], To approve, 4 waiting → /approvals [42x40], Messages, 13 unread → /notifications [40x40], Account →  [40x40]
- Bottom tab bar (390 and 820): Home · 11 Quality check · Operations · Scan · Menu
- Home tab row (phone, 40 px tall): Overview · To approve 4 · Messages · Problems & alerts · More
- Drawer/menu items: **86**

| Destination › section | Menu item | Route | Screen title | Flag |
|---|---|---|---|---|
| Home | Overview | `/dashboard` | Good evening, <name> |  |
| Home | To approve | `/approvals` | To approve | DUP: top-bar "To approve" + this tab + Problems & alerts "To decide" |
| Home | Messages | `/notifications` | Messages | DUP: top-bar bell + this tab |
| Home | Problems & alerts | `/action-centre` | Problems & alerts | "To decide" tab repeats To approve |
| Home › Help & my account | Help & guides | `/help` | Help | label ≠ title |
| Home › Help & my account | My account | `/account` | My account |  |
| Home › Help & my account | Working without signal | `/sync` | Working without signal |  |
| Home › Help & my account | My expense claims | `/finance/expenses` | Expense claims | same screen as "Expense approvals"; label ≠ title |
| Operations | Operations Center | `/operations` | Operations Center |  |
| Operations | Production orders | `/production/orders` | Production orders |  |
| Operations | Today's count | `/production/today` | Today | label ≠ title |
| Operations | Rejects | `/production/defects` | Rejects |  |
| Operations | Quality check | `/quality/check` | Batches waiting for QA check | NAME CLASH (Quality check/checks/checks for items); label ≠ title |
| Operations | Floor screen (TV) | `/floor` | Bryel's Care · North Fields Plant | label ≠ title |
| Operations › Receiving | Deliveries coming | `/procurement/expected` | Deliveries coming |  |
| Operations › Receiving | Deliveries received | `/inventory/receipts` | Deliveries received |  |
| Operations › Quality | QA queue | `/quality` | QA queue |  |
| Operations › Quality | Quality checks | `/quality/inspections` | Quality checks (tests) | NAME CLASH; label ≠ title |
| Operations › Quality | Problem reports | `/quality/deviations` | Problem reports |  |
| Operations › Quality | Stopped by QA | `/quality/holds` | Stopped by QA |  |
| Operations › Quality | Decide many lots at once | `/quality/bulk` | Decide many lots at once |  |
| Operations › Quality | Where it came from and went | `/quality/trace` | Where it came from and where it went | label ≠ title |
| Operations › Quality | Customer complaints | `/quality/complaints` | Customer complaints |  |
| Operations › Quality | Who received it | `/quality/recall` | Who received it (recall check) | label ≠ title |
| Operations › Quality | Product recalls | `/quality/recalls` | Product recalls |  |
| Operations › Quality | Fix-and-prevent plans | `/quality/capa` | Fix-and-prevent plans |  |
| Operations › Quality | Change requests | `/quality/changes` | Change requests |  |
| Operations › Packing & dispatch | Boxing | `/warehouse/packs` | (not opened) |  |
| Operations › Packing & dispatch | To get from shelf | `/sales/picking` | (not opened) |  |
| Operations › Packing & dispatch | Send out | `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries | `/sales/shipments` | Deliveries | "Deliveries" vs "Deliveries coming/received" |
| Operations › Maintenance | Maintenance | `/maintenance` | Maintenance | "Maintenance" inside "Maintenance" |
| Operations › Maintenance | Regular maintenance | `/maintenance/plans` | Regular maintenance |  |
| Operations › Maintenance | Repair jobs | `/maintenance/work-orders` | Repair jobs |  |
| Operations › Maintenance | Spare parts | `/maintenance/spare-parts` | Spare parts |  |
| Inventory | Stock | `/inventory` | Raw materials | label ≠ title |
| Inventory | Scan or look up | `/inventory/scan` | Scan or search | label ≠ title |
| Inventory | Warehouse sections | `/warehouse` | (not opened) |  |
| Inventory › More stock lists | Shelves | `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks | `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Availability | `/inventory/availability` | Can we deliver? | label ≠ title |
| Inventory › More stock lists | Expiring soon | `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | FEFO & reservations | `/inventory/lots/reservations` | Which one to use first / set aside | jargon "FEFO" in menu; label ≠ title |
| Inventory › More stock lists | Stock changes | `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts | `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Adjustments | `/inventory/adjustments` | Fix stock | label ≠ title |
| Inventory › Counts & labels | Labels to print | `/labels` | Labels to print |  |
| Sales & Customers | Customer orders | `/sales` | Customer orders |  |
| Sales & Customers | Customers | `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board | `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Customer returns | `/sales/returns` | (not opened) |  |
| Management | Management home | `/management` | Management | label ≠ title |
| Management › Reports & analytics | Business overview | `/analytics/overview` | Business overview | overlaps "Reports" |
| Management › Reports & analytics | Reports | `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time | `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print | `/reports` | Lists to download or print |  |
| Management › Reports & analytics | Lists sent by email | `/reports/schedules` | Lists sent by email |  |
| Management › Purchasing | Purchasing | `/procurement` | Purchasing | "Purchasing" inside "Purchasing" |
| Management › Purchasing | Requests to buy | `/procurement/requests` | Requests to buy |  |
| Management › Purchasing | Purchase orders | `/procurement/orders` | Purchase orders |  |
| Management › Purchasing | Send back to supplier | `/procurement/returns` | Send back to supplier |  |
| Management › Purchasing | Suppliers we may buy from | `/procurement/suppliers` | Suppliers we may buy from | 2nd supplier list |
| Management › Purchasing | How suppliers do | `/procurement/performance` | How suppliers do |  |
| Management › Production setup | Recipes (advanced) | `/masterdata/formulas` | Recipes (advanced) | advanced, beside wizard |
| Management › Production setup | Steps (advanced) | `/masterdata/routings` | Steps (advanced) | advanced, beside wizard |
| Management › Production setup | How-to sheets | `/masterdata/work-instructions` | How-to sheets |  |
| Management › Production setup | Quality checks for items | `/masterdata/inspection-plans` | Quality checks | NAME CLASH; label ≠ title |
| Management › Production setup | Equipment | `/masterdata/equipment` | Equipment |  |
| Management › Master data | Materials | `/masterdata/materials` | Materials |  |
| Management › Master data | Products | `/masterdata/products` | Products |  |
| Management › Master data | Suppliers | `/masterdata/suppliers` | Suppliers | 2nd supplier list |
| Management › Master data | Locations | `/masterdata/locations` | Locations |  |
| Management › Master data | Sites | `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses | `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines | `/masterdata/lines` | Making areas / lines |  |
| Management › Master data | Units | `/masterdata/uom` | Units |  |
| Management › Master data | Choice lists | `/masterdata/lists` | Choice lists |  |
| Management › Master data | Reasons | `/masterdata/reason-codes` | Reasons |  |
| Management › IT settings | Labels and printouts | `/admin/templates` | Labels and printouts |  |
| Management › IT settings | Old paper documents | `/admin/imports/legacy-documents` | Old paper documents |  |
| Management › IT settings | Keeping and deleting old records | `/admin/retention` | Keeping and deleting old records |  |
| Management › IT settings | What each number means | `/analytics/definitions` | What each number means |  |
| Management › Planning tools | Production plan (weeks ahead) | `/production/plan` | Production plan | label ≠ title |
| Management › Planning tools | All batches and their records | `/production` | Batches | OLD (Planning tools); label ≠ title |
| Management › Planning tools | Production orders, full detail | `/production/work-orders` | Production orders | OLD screen ("Older production order screen"), same title as Production orders; label ≠ title |
| Management › Planning tools | Production board, full detail | `/production/board` | Production board | OLD (Planning tools); label ≠ title |

### sales

- Lands on: `/dashboard`
- Top bar 1440: Bryel's Care home, Scan or search, Sync status: Synced. Open sync, Messages, 25 unread, Account
- Top bar 390 (measured size): Open menu →  [44x44], Bryel's Care home → /dashboard [36x36], Messages, 25 unread → /notifications [40x40], Account →  [40x40]
- Bottom tab bar (390 and 820): Home · Operations · Inventory · Sales · Menu
- Home tab row (phone, 40 px tall): Overview · Messages · Problems & alerts · More
- Drawer/menu items: **52**

| Destination › section | Menu item | Route | Screen title | Flag |
|---|---|---|---|---|
| Home | Overview | `/dashboard` | Good evening, <name> |  |
| Home | Messages | `/notifications` | Messages | DUP: top-bar bell + this tab |
| Home | Problems & alerts | `/action-centre` | Problems & alerts | "To decide" tab repeats To approve |
| Home › Help & my account | Help & guides | `/help` | Help | label ≠ title |
| Home › Help & my account | My account | `/account` | My account |  |
| Home › Help & my account | Working without signal | `/sync` | Working without signal |  |
| Home › Help & my account | My expense claims | `/finance/expenses` | Expense claims | same screen as "Expense approvals"; label ≠ title |
| Operations | Operations Center | `/operations` | Operations Center |  |
| Operations | Production orders | `/production/orders` | Production orders |  |
| Operations › Quality | Customer complaints | `/quality/complaints` | Customer complaints |  |
| Operations › Quality | Product recalls | `/quality/recalls` | Product recalls |  |
| Operations › Packing & dispatch | Boxing | `/warehouse/packs` | (not opened) |  |
| Operations › Packing & dispatch | To get from shelf | `/sales/picking` | (not opened) |  |
| Operations › Packing & dispatch | Send out | `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries | `/sales/shipments` | Deliveries | "Deliveries" vs "Deliveries coming/received" |
| Inventory | Stock | `/inventory` | Raw materials | label ≠ title |
| Inventory | Scan or look up | `/inventory/scan` | Scan or search | label ≠ title |
| Inventory | Warehouse sections | `/warehouse` | (not opened) |  |
| Inventory › More stock lists | Boxes and sacks | `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Availability | `/inventory/availability` | Can we deliver? | label ≠ title |
| Inventory › More stock lists | Expiring soon | `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | FEFO & reservations | `/inventory/lots/reservations` | Which one to use first / set aside | jargon "FEFO" in menu; label ≠ title |
| Sales & Customers | Customer orders | `/sales` | Customer orders |  |
| Sales & Customers | Customers | `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board | `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Price offers | `/sales/quotations` | (not opened) |  |
| Sales & Customers › Quotes, prices & returns | Prices | `/sales/price-lists` | (not opened) |  |
| Sales & Customers › Quotes, prices & returns | Customer returns | `/sales/returns` | (not opened) |  |
| Sales & Customers › Billing & payments | Invoices | `/finance/invoices` | Invoices |  |
| Sales & Customers › Billing & payments | Payments | `/finance/payments` | Payments |  |
| Sales & Customers › Billing & payments | Statements | `/finance/statements` | Customer statements | label ≠ title |
| Sales & Customers › Billing & payments | Credits (money back) | `/finance/credit-notes` | Credits (money back) |  |
| Management | Management home | `/management` | Management | label ≠ title |
| Management › Reports & analytics | Business overview | `/analytics/overview` | Business overview | overlaps "Reports" |
| Management › Reports & analytics | Reports | `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time | `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print | `/reports` | Lists to download or print |  |
| Management › Reports & analytics | Lists sent by email | `/reports/schedules` | Lists sent by email |  |
| Management › Purchasing | Sales guess | `/procurement/forecast` | Sales guess |  |
| Management › Finance | Money | `/finance` | Money |  |
| Management › Master data | Products | `/masterdata/products` | Products |  |
| Management › Master data | Sites | `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses | `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines | `/masterdata/lines` | Making areas / lines |  |
| Management › Master data | Units | `/masterdata/uom` | Units |  |
| Management › Master data | Choice lists | `/masterdata/lists` | Choice lists |  |
| Management › Master data | Reasons | `/masterdata/reason-codes` | Reasons |  |
| Management › IT settings | Labels and printouts | `/admin/templates` | Labels and printouts |  |
| Management › IT settings | What each number means | `/analytics/definitions` | What each number means |  |
| Management › Planning tools | Production plan (weeks ahead) | `/production/plan` | Production plan | label ≠ title |
| Management › Planning tools | Production orders, full detail | `/production/work-orders` | Production orders | OLD screen ("Older production order screen"), same title as Production orders; label ≠ title |
| Management › Planning tools | Production board, full detail | `/production/board` | Production board | OLD (Planning tools); label ≠ title |

### warehouse.nfd

- Lands on: `/dashboard`
- Top bar 1440: Bryel's Care home, Scan or search, Sync status: Synced. Open sync, Messages, 14 unread, Account
- Top bar 390 (measured size): Open menu →  [44x44], Bryel's Care home → /dashboard [36x36], Messages, 14 unread → /notifications [40x40], Account →  [40x40]
- Bottom tab bar (390 and 820): Home · Receive · Scan · Inventory · Menu
- Home tab row (phone, 40 px tall): Overview · Messages · More
- Drawer/menu items: **29**

| Destination › section | Menu item | Route | Screen title | Flag |
|---|---|---|---|---|
| Home | Overview | `/dashboard` | Good evening, <name> |  |
| Home | Messages | `/notifications` | Messages | DUP: top-bar bell + this tab |
| Home › Help & my account | Help & guides | `/help` | Help | label ≠ title |
| Home › Help & my account | My account | `/account` | My account |  |
| Home › Help & my account | Working without signal | `/sync` | Working without signal |  |
| Home › Help & my account | My expense claims | `/finance/expenses` | Expense claims | same screen as "Expense approvals"; label ≠ title |
| Operations › Receiving | Deliveries coming | `/procurement/expected` | Deliveries coming |  |
| Operations › Receiving | Receive materials | `/inventory/receive` | Receive a delivery | label ≠ title |
| Operations › Receiving | Deliveries received | `/inventory/receipts` | Deliveries received |  |
| Operations › Receiving | Put away | `/inventory/receive/put-away` | Put away |  |
| Operations › Packing & dispatch | Boxing | `/warehouse/packs` | (not opened) |  |
| Operations › Packing & dispatch | Repack for a customer | `/warehouse/repack` | (not opened) |  |
| Operations › Packing & dispatch | Check labels in an area | `/quality/label-verification` | Check the labels in an area | label ≠ title |
| Operations › Packing & dispatch | To get from shelf | `/sales/picking` | (not opened) |  |
| Operations › Packing & dispatch | Send out | `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries | `/sales/shipments` | Deliveries | "Deliveries" vs "Deliveries coming/received" |
| Inventory | Stock | `/inventory` | Raw materials | label ≠ title |
| Inventory | Scan or look up | `/inventory/scan` | Scan or search | label ≠ title |
| Inventory | Move stock | `/inventory/move` | Move stock |  |
| Inventory | Warehouse sections | `/warehouse` | (not opened) |  |
| Inventory › More stock lists | Shelves | `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks | `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Availability | `/inventory/availability` | Can we deliver? | label ≠ title |
| Inventory › More stock lists | Expiring soon | `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | FEFO & reservations | `/inventory/lots/reservations` | Which one to use first / set aside | jargon "FEFO" in menu; label ≠ title |
| Inventory › More stock lists | Stock changes | `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts | `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Adjustments | `/inventory/adjustments` | Fix stock | label ≠ title |
| Inventory › Counts & labels | Labels to print | `/labels` | Labels to print |  |

## Comparison with the brief's mockup board (Part III/IV, as summarised in docs/CONSULTANT_REVIEW.md §4)

| Mockup panel | Live app | Matches | Missing or different |
|---|---|---|---|
| **Owner dashboard**: Sales today · Production progress · Inventory alerts · Pending approvals; sales chart; top alerts; recent activity | `/dashboard` as owner (`vp-dashboard-owner-1440.png`, `dashboard-owner-390.png`) | All four cards in mockup order (Sales today ₱3,456; Production progress 50%; Stock to look at 8; Waiting for your approval 17). "Needs your attention" list (top alerts). "Sales this week" chart with a Chart/Table toggle. Production by stage. Recent activity. Site toggle. | No single "What to do next". "−₱63,744.00 (−95 %) vs yesterday" in red under a quiet day alarms more than it informs. Recent activity is an audit log (technical verbs, codes, "generated generated"). No "top products" on Home (it is on Reports). The approvals card and the first attention line both say 17, so it is counted twice. |
| **Operator workspace**: "Your tasks today", task cards with Start, Production Step with numbered sub-tasks, one Complete Step | `/dashboard` as operator (`dashboard-operator.nfd-390.png`) | "Your tasks today" as cards: verb title ("Weigh the ingredients"), product, step x of 7, progress, one big green "Continue" per card. Counters (Batches for you / Weighing / Waiting). Quick actions. Tab bar Home · My work · Today's count · Scan. | Every card has an equally strong green "Continue" (4 identical green buttons), not one first task. Batch codes in mono after the product name are fine. The step screen (outside this scope) was not re-checked. |
| **Inventory** (Raw / WIP / Finished, Scan box) | outside this scope | – | The menu says "Stock" but the screen title is "Raw materials" |
| **Sales split view** | outside this scope | – | – |
| **Operations Center**: flow strip, current step + due, recent activity | `/operations` (`vp-operations-owner-1440.png`) | 9 numbered stages from delivery to dispatch with counts and red/amber warnings; "Batches being made" table; Quick links | Stage cards are on a grid, not a connected strip. The batch table leads with codes. No "due" column and no recent activity. On phones the warning links are 25 px tall. |
| **Top bar with 5 destinations** (icon + one-line description) | frame at 1440/820/390 | 5 destinations with icons; descriptions in the drawer and in title tooltips | At 1440 the one-line descriptions are hidden (shown only from 1536 px). Duplicate To approve/Messages. Phones have no Scan. |
| **Reports** (one chart, top products, three tiles) | `/analytics` | Three tiles, weekly chart, "What sells best" | "Business overview", "Reports" and "Compare over time" overlap; KPI codes still shown on the overview and drill-downs |
| **Production floor TV** (Making now · Next up · Waiting · Today) | `/floor` at 1920 (`vp-floor-floor.nfd-1920.png`) | Exactly this layout, big type, clock, auto-refresh line, no prices | "Anyone" as the assignee looks like missing data; batch codes are shown |

## Old or superseded screens still reachable

| Old screen | Exact path to reach it | What the owner sees | Recommendation |
|---|---|---|---|
| `/production/work-orders` | Management › Planning tools › "Production orders, full detail" (owner, manager, QA, sales, auditor) | Title "Production orders" (same as the new `/production/orders`); intro "Older production order screen. Use Production orders for daily work." | Remove from the menu; redirect to `/production/orders` |
| `/production/board` | Management › Planning tools › "Production board, full detail" | "Production board" | Hide for owner/sales; keep only for planners if needed |
| `/production` | Management › Planning tools › "All batches and their records" | "Batches" | Rename and keep only if there is no new list |
| `/production/new` | Management › Planning tools › "Make a batch without an order" (owner, manager) | "New batch"; intro says "Make a batch from an approved production order", which contradicts the menu label | Remove (ADR-074: an order creates its batch) or fix the wording |
| `/production/staging` | Management › Planning tools › "Get materials by scanning" | "Stage materials" | Rename so the title matches the menu |
| `/masterdata/formulas`, `/masterdata/formulas/new` | Management › Production setup › "Recipes (advanced)"; ⋯ More on that screen; "Advanced editing instead" link on every wizard screen; `/masterdata/recipes` redirects here | "Recipes (advanced)" and "New recipe (advanced)" (old 3-field form) | Keep for engineers only (permission), take it out of the owner menu, and remove the wizard's "Advanced editing instead" link |
| `/masterdata/routings`, `/masterdata/routings/new`, `/masterdata/routings/[id]/revisions/[id]` | Management › Production setup › "Steps (advanced)"; "Open version 2" | The steps version page has 106 visible inputs | Same as above |
| `/finance/expenses?status=to_approve` | Management › Finance › "Expense approvals" | The same screen as Home › My expense claims; also in To approve | Remove the menu item; To approve is the single inbox |
| `/action-centre` "To decide" tab | Home › Problems & alerts | A second approvals inbox with different buttons | Drop the tab and link to To approve instead |
| `/masterdata/recipes/[formulaId]` | Wizard "← All recipes" / product links | Not listed in PAGE_REVIEW.md; no intro line; words "disposition" and "quarantine" | Add it to the review and give it the standard |

## Concrete fix list

| # | What | Where (file) |
|---|---|---|
| 1 | Verify on a real phone (outside this sandbox) that record pages (`/…/[id]`) load. If the JS files of dynamic routes really return 404 for browsers, fix how static files are served (Railway start command / `next start` vs standalone, `assetPrefix`, encoded `[id]` paths) | deployment config, `next.config.*`, Railway service |
| 2 | One inbox: remove the "To decide" tab from Problems & alerts (link to /approvals instead). Hide the tab-row "To approve" and "Messages" pills when the top-bar buttons are visible (or the reverse) | `src/app/(app)/action-centre/page.tsx`, `src/app/(app)/nav.ts` (Home items), `src/app/(app)/shell.tsx` |
| 3 | Take the Planning tools section out of the menu for owner and sales (keep it for planners only); redirect `/production/work-orders` to `/production/orders`; remove "Make a batch without an order" | `nav.ts` (`ADVANCED_ITEMS`, `buildNav`), `src/app/(app)/production/work-orders/page.tsx` |
| 4 | Rename to remove the name clashes: Operations "Quality check" → "Check finished batches"; /quality/inspections → "Lab tests"; /masterdata/inspection-plans → "What QA tests per item"; merge or rename "Suppliers we may buy from"; drop "Expense approvals" | `nav.ts`, page titles in `src/app/(app)/quality/**`, `masterdata/inspection-plans/**`, `procurement/suppliers/**` |
| 5 | Make each menu label equal to the screen title (29 pairs listed above). Remove "FEFO" from the menu. Change the Management tagline (no HR) | `nav.ts`, page `<h1>`s |
| 6 | Names before codes in the activity feeds: Home Recent activity, Messages titles, Problems & alerts cards and the Operations batch table should start with the product/customer name; write activity sentences in plain verbs; fix "generated generated document"; hide raw setting keys (`platform.rate_limits`) and KPI/ADR codes | the dashboard recent-activity read model (`src/modules/analytics/*`), notification templates (`src/modules/platform`/notifications), `src/app/(app)/action-centre/page.tsx`, `src/app/(app)/operations/page.tsx`, `src/app/(app)/analytics/overview/page.tsx` |
| 7 | 44 px everywhere: top-bar buttons `size-10`/`h-10` → `size-11`; tab row `min-h-[40px]` → 44; drawer close `size-9` → `size-11`; `Explain` summary `min-h-[32px]` → 44; filter chips on Problems & alerts / diagnostics / sync conflicts; Messages buttons; bigger checkbox/radio hit areas (wrap in a 44 px label) | `src/app/(app)/shell.tsx`, `src/ui/guide.tsx`, `src/ui/form.tsx`, `src/app/(app)/notifications/page.tsx`, `src/app/(app)/action-centre/page.tsx` |
| 8 | Phone Scan: show the "Scan or search" icon in the top bar below 640 px (remove `hidden … sm:flex`), or add Scan to the office tab bar | `shell.tsx`, `tabsFor` in `nav.ts` |
| 9 | Recipe wizard: block "Send for approval" (and do not tick screens 3/4) when there are no ingredients or steps; restore the "Has a recipe · open it" guard on screen 1 (all 3 products with recipes were selectable); add a PageIntro; remove "Advanced editing instead" | `src/app/(app)/masterdata/recipes/wizard.tsx` (`check()`, `go()`, `ProductStep`), `masterdata/recipes/new/page.tsx` (`p.formulaId` data) |
| 10 | Add a NextStep box (or "Waiting for <name>") to the Setup detail pages (supplier, material, location, site, warehouse, line, equipment, inspection plan, reason) and to finance payment/credit/expense details. Remove the duplicate "Do it now" green button on the invoice. Give the expense claim box a button or a waiting name | `src/app/(app)/masterdata/*/[id]/page.tsx`, `src/app/(app)/finance/{payments,credit-notes,expenses,invoices}/[id]/page.tsx`, `src/ui/guide.tsx` |
| 11 | Fold big forms: role clone (fold the permission list, only name visible), steps version (edit one step at a time), label new/edit (fold printed fields), reason detail (fold "where offered"; plain words; hide `no_purchase_order`), site detail (one form, one Save) | `src/app/(app)/admin/roles/[id]/clone/*`, `masterdata/routings/[id]/revisions/[revisionId]/*`, `admin/templates/labels/*`, `masterdata/reason-codes/[id]/*`, `masterdata/sites/[id]/*` |
| 12 | Same intro position everywhere: the PageIntro goes directly under the title, before action buttons (Materials, Messages, Invoice currently put it under the buttons) | the affected `page.tsx` files; consider making the `PageHeader` render the intro |
| 13 | Help "?": add one help button to the frame (top bar or page header) that opens `/help#<screen>`, rather than only 3 screens having it | `shell.tsx`, `src/ui/help/*` |
| 14 | Wording: "delivery(ies)" → "deliveries"; "(PLACEHOLDER)" in inspection plan names; "Anyone" on the floor TV → "Not assigned yet"; recent-activity verbs | `finance/invoices/page.tsx`, seed data (`src/db/seed*.ts`), `src/app/floor/*` |
| 15 | Home: the sales card shows "−95 % vs yesterday" in red on a quiet day. Compare with the same weekday or the week to date, or show it neutral when the base is small | dashboard sales read model |
