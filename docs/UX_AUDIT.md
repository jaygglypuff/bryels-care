# UX audit: current state (Part II §2 of the brief)

| | |
|---|---|
| Status | Audit complete. Findings addressed in slice R1 are marked in §8 (ADR-081) |
| Owner of this document | UX/UI designer persona |
| Snapshot | Repository at commit `8be80ce` (2026-10-30, "Merge G2 ... (ADR-080)"). Navigation and shell are being changed in parallel; findings cite the code as of this commit. |
| Read with | `docs/source/master-brief.md` (Part II-IV), `docs/ux-system.md`, `docs/decision-log.md` ADR-024, ADR-074..080, `docs/reviews/production-flow-v2-ux-review.md` |

## 1. Scope and method

The owner reports the app is "confusing and overwhelming". This audit records why, with evidence,
before any restructuring into the five destinations (Home, Operations, Inventory, Sales & Customers,
Management) asked for in Part II §3.

Method (repository only):

1. Read the navigation model in code: `src/app/(app)/nav.ts` (`NAV`, `QUICK_ACTIONS`, `buildNav`,
   `tabsFor`, `productionPersona`) and the shell `src/app/(app)/shell.tsx` (top pill bar, sub-tab row,
   quick-action rail, phone tab bar, drawer).
2. Computed the real menu per role by running `buildNav`, `QUICK_ACTIONS` and `tabsFor` against
   `ROLE_BUNDLES` in `src/lib/permissions.ts` (script run with `tsx`; not committed).
3. Counted routes: `find src/app/(app) -name page.tsx` and compared static routes with nav hrefs.
4. Checked error boundaries (`error.tsx`), empty states (`EmptyState`), placeholder markers
   ("Coming", "planned", "TODO", "Not available yet", disabled controls) and page titles vs menu labels.
5. Read the key home, list and detail pages: `/dashboard`, `/warehouse`, `/inventory`,
   `/inventory/receive`, `/production/orders`, `/quality`, `/sales/[orderId]`, `/approvals`,
   `/action-centre`, `/analytics`.

Severity: **High** = blocks or misleads a core daily task or a first-time user; **Medium** = slows
work, duplicates paths or uses confusing words; **Low** = polish or documentation drift.

### 1.1 Could not verify

| Item | Why | Consequence |
|---|---|---|
| The deployed Railway app and its demo account | No credentials and no sign-in from this environment | No authenticated screen was seen rendered. Nothing here claims "observed on screen". |
| Actual layout at 390, 820, 1180, 1440 px | No browser run | Overflow of the 12-pill top bar and 15-pill sub-tab rows is inferred from the markup, not measured. |
| Real role assignments and custom roles in production data | No database access | Per-role menus below use the shipped `ROLE_BUNDLES`; custom roles or multi-role users will see more. |
| Seed/demo data volumes | Not loaded | Empty-state frequency and list lengths are not known. |
| Runtime behaviour of each button | Read, not clicked | "Placeholder" findings are based on code paths; no fake-success button was found by grep, but not every form was traced end to end. |
| Work in progress by another engineer (e.g. untracked `tests/integration/analytics/operations-center.test.ts`) | Not merged | An Operations Center may be landing; not audited. |
| Performance on phones and tablets, offline behaviour on device | No device | Out of scope here. |

## 2. Current-state inventory (real numbers from the code)

### 2.1 Navigation surfaces

A user can reach pages through **six** separate surfaces:

| Surface | Where | Count |
|---|---|---|
| Top module pills (desktop >= 1024 px) | `shell.tsx:139-158` | 12 groups with live items (13 defined; "Coming next" is drawer-only) |
| Sub-tab pill row for the active group | `shell.tsx:203-249` | up to 16 pills (Admin), wraps (`flex-wrap`, `shell.tsx:224`) |
| Quick-action rail (desktop) | `nav.ts:12-22`, `shell.tsx:254-274` | 8 actions defined |
| Top-bar buttons (scan, To approve, bell, avatar menu) | `shell.tsx:162-199` | 4 |
| Phone/tablet bottom tab bar, per role | `nav.ts:284-299` | 3 to 5 tabs |
| Drawer (phone/tablet) | `shell.tsx:315-376` | all groups + "Coming next" |

Plus page-level shortcuts on the owner overview (`dashboard/owner-overview.tsx:485-491`) and the
operator home tiles (`src/modules/analytics/dashboard.ts:482-531`).

### 2.2 Menu groups and items (`NAV`, `nav.ts:43-234`)

| # | Group | Items | Notes |
|---|---|---|---|
| 1 | Home | 10 | Overview, To approve, Action centre, Dashboards, Trends, KPI definitions, Notifications, Help & guides, My account, Sync & offline |
| 2 | Inventory | 7 | stock visibility |
| 3 | Warehouse | 15 | receiving, moves, counts, labels, boxing, picking, dispatch |
| 4 | Production | 14 | 4 main + 4 "Setup" + 6 "Advanced" (built per role by `productionItems`) |
| 5 | Maintenance | 4 | |
| 6 | Quality | 12 | |
| 7 | Sales | 8 | |
| 8 | Procurement | 8 | |
| 9 | Finance | 10 | |
| 10 | Reports | 2 | |
| 11 | Master data | 10 | |
| 12 | Admin | 16 | |
| 13 | Coming next | 1 | "HR & attendance", `href: "#"`, planned "Phase 5-6" |
| | **Total** | **117** | |

Quick-action rail (`nav.ts:12-22`), 8 items: To approve, Scan or look up, Receive materials,
New production order, QA queue, New sales order, Traceability, Audit log.

### 2.3 Routes

| Measure | Value |
|---|---|
| `page.tsx` under `src/app/(app)` | **239** |
| of which static (no `[param]`) | 154 |
| static routes not reachable from the menu (mostly `/new` forms, plus `/admin`, `/admin/demo`, `/inventory/lots` redirect, `/quality/holds/issue`, `/admin/templates/stations`) | 41 |
| Routes by top folder | masterdata 38, inventory 29, quality 28, admin 27, sales 25, production 20, finance 19, procurement 17, maintenance 8, reports 6, analytics 5, warehouse 4, sync 3, labels 3, others 1 each |
| `error.tsx` boundaries | 61 segments; **no** root `src/app/(app)/error.tsx` or `global-error.tsx` |
| Pages with no `error.tsx` on their path | **28** (list in UX-24) |
| `loading.tsx` | 0 (by design: ADR-043 uses `NavigationProgress`) |

### 2.4 What each role actually sees (computed from `ROLE_BUNDLES`)

| Role | Permissions | Groups | Menu items | Rail | Phone/tablet tabs |
|---|---|---|---|---|---|
| owner_director | 297 | 13 | 114 | 7 | Home, Production, Sales, To approve, Menu |
| site_manager | 229 | 13 | 105 | 7 | Home, Production, Sales, To approve, Menu |
| production_planner | 79 | 13 | 59 | 4 | Home, Production, Sales, To approve, Menu |
| production_operator | 77 | 11 | 54 | 2 | Home, Today, Scan, Help |
| warehouse_operator | 100 | 13 | 69 | 3 | Home, Scan, Help |
| qa_qc | 148 | 13 | 82 | 4 | Home, Quality check, Production, Scan, Menu |
| sales_cs | 85 | 12 | 52 | 3 | Home, Production, Sales, Scan, Menu |
| finance | 67 | 8 | 40 | 1 | Home, Sales, Menu |
| procurement | 74 | 11 | 45 | 3 | Home, Scan, Menu |
| auditor | 131 | 13 | 104 | 5 | Home, Production, Sales, Scan, Menu |
| system_admin | 134 | 12 | 80 | 5 | Home, Production, Sales, Scan, Menu |

Reading: a **production operator sees 54 menu entries in 11 groups**, including 9 Master data
pages, 4 Maintenance pages, 7 Inventory pages and 9 "Advanced" production screens. A warehouse
operator sees 69 entries in 13 groups. The brief (Part II §6) asks that operators see only their
assigned work and next action.

## 3. Role to tasks map

"Needs" is from Part II §3, §6, §8 and the master brief; "Lives today" is where the code puts it.

| Role | Top daily tasks (needs) | Where it lives today | Gap |
|---|---|---|---|
| owner_director | Business health, alerts, approvals, orders, production, stock exceptions, finance summary | `/dashboard` (owner overview), `/approvals`, `/action-centre`, `/notifications`, `/analytics/*`, `/reports`, `/finance` | Four inboxes (approvals, action centre, notifications, expense approvals); analytics split across Home and Reports; no single Operations Center |
| site_manager | Team workload, approvals, delays, exceptions | Same as owner plus all operational groups (105 items) | No "delayed / blocked" board; workload by person not shown |
| production_planner | Plan and approve production orders, material availability, reorder | Production (Orders, New order, Setup, Advanced), Procurement reorder, Inventory availability | Plan, board, work orders still offered as "Advanced" duplicates |
| production_operator | Open assigned batch, do the current step, log output and rejects | Home tile "My work", `/production/orders` (titled "My work"), `/production/today` | "My work" is every open order at the site, not assigned work (no assignee on production orders); tab bar has no My work tab |
| warehouse_operator | Receive, inspect handover, put away, move, count, pick, pack, dispatch | Warehouse group (15 pills, routes under `/inventory`, `/procurement`, `/quality`, `/warehouse`, `/sales`) | Steps of one flow live in 4 URL areas; tab bar has only Home, Scan, Help |
| qa_qc | Inspect incoming lots, release batches, holds, deviations | Quality (12), tab "Quality check" -> `/quality` ("QA queue") | Inspection plans live in `/masterdata`; label verification is in the Warehouse group |
| sales_cs | Customers, quotes, orders, fulfilment status, payments, returns, complaints | Sales (8), Finance (invoices, payments), Quality (complaints), Warehouse (picking, dispatch) | One customer order spans Sales, Warehouse, Finance and Quality groups |
| finance | Invoices, payments, bills, expenses, periods, statements | Finance (10), Sales (6), Procurement (7), Warehouse (2) | Expense approvals separate from "To approve" |
| procurement | Requests, POs, expected deliveries, suppliers, reorder | Procurement (8) plus Warehouse "Expected receipts" and Master data "Suppliers" | Suppliers in two places; expected deliveries filed under Warehouse |
| auditor | Read everything, audit log, traceability | 104 items, rail Audit log | Read-only role sees same create-oriented layout |
| system_admin | Users, roles, settings, numbering, imports, devices | Admin (16), Master data (10) | Settings scattered between Admin, Master data, Finance (tax, periods), Quality (inspection plans) |

## 4. Findings

| ID | Finding | Sev | Affected roles | Evidence | Recommendation |
|---|---|---|---|---|---|
| UX-01 | Too many top-level groups: 12 module pills on desktop, 13 in the drawer, 117 menu items. Brief asks for 5 destinations. | High | all, esp. owner (114 items), site_manager (105) | `nav.ts:43-234`; per-role counts §2.4 | Collapse into Home / Operations / Inventory / Sales & Customers / Management (Part II §3); keep URLs, change grouping only. |
| UX-02 | Operators see admin, setup and analytics entries: production_operator gets Master data (9), Maintenance (4), Inventory (7), KPI definitions, Templates & labels and 9 "Advanced" production screens. | High | production_operator, warehouse_operator | §2.4; `nav.ts:24-40` (Setup/Advanced shown to non-owners as Advanced, `nav.ts:265`) | Operator workspace with only assigned work + Scan + Help; hide view-only reference pages from operator menus (permissions unchanged server-side). |
| UX-03 | Receiving is split across three groups and four URL areas: Receive materials `/inventory/receive`, Expected receipts `/procurement/expected`, Goods receipts `/inventory/receipts`, Put away `/inventory/receive/put-away` (Warehouse); Purchase orders (Procurement); incoming inspection `/quality/inspections` and QA queue `/quality` (Quality); Label verification `/quality/label-verification` (Warehouse). | High | warehouse_operator, qa_qc, procurement | `nav.ts:65-68,74,112-113,151` | One "Receive" flow in Operations: Expected delivery -> Receive -> Inspection -> Put away, each step opening the next (Part II §4, §10). |
| UX-04 | Picking and dispatch are in the Warehouse group but their routes are `/sales/picking`, `/sales/dispatch`; Shipments `/sales/shipments` is in Sales; Boxing is `/warehouse/packs`; `/sales/packing/[id]` exists outside the menu. Detail pages under `/sales/...` highlight the Sales pill while the user is doing warehouse work. | Medium | warehouse_operator, sales_cs | `nav.ts:76-79,139`; active-group logic `shell.tsx:80-101` | Single "Pick, pack, dispatch" stage in Operations; one URL area for fulfilment (redirect old routes). |
| UX-05 | "Scan / look up" is offered in 5 places: rail (`nav.ts:14`), top-bar icon (`shell.tsx:162`), Warehouse group (`nav.ts:70`), tab bar (`nav.ts:289`), operator home tile (`dashboard.ts:492`). Labels differ ("Scan or look up", "Scan or search", "Scan / look up", "Scan"). | Medium | all | as cited | One scan entry per breakpoint (top bar on desktop, tab on phone), one label "Scan". |
| UX-06 | "To approve" appears in 4 places (rail `nav.ts:13`, top bar `shell.tsx:167-178`, Home group `nav.ts:44`, tab bar `nav.ts:297`) and overlaps with Action centre's "Approvals" tab (`action-centre/page.tsx:84-85,143`) and Finance "Expense approvals" (`nav.ts:171`). Shown to every role, including operators with nothing to approve (no permission on the item). | Medium | all | as cited | One approvals inbox (include expense claims); show only to roles holding an approve permission; fold Action centre and Notifications into one "Alerts" view. |
| UX-07 | Analytics is split: Home holds Dashboards, Trends, KPI definitions (`nav.ts:44`); Reports is its own group (`nav.ts:178-183`); Forecast assumptions sits in Procurement (`nav.ts:156`); Supplier performance in Procurement. Brief §8 asks to keep advanced analytics separate from daily operations. | Medium | owner, site_manager, finance, auditor | as cited | Move all analytics/reports under Management -> Reports & analytics; Home shows only the role's summary. |
| UX-08 | Old production screens kept as "Advanced" duplicates: Production plan, Work orders (detailed), Board (detailed), Batches (full record), Materials by scan, New batch without an order. Operators can reach "Materials by scan", which bypasses the v2 materials list. | High | production_operator, planner, site_manager, owner | `nav.ts:33-40`; ADR-080 §11 and stage G4 ("hide and redirect") | Finish ADR-080 G4: redirect list screens to the order hub; keep batch record as a tab of the order; remove "New batch without an order" from menus (owner-only if retained). |
| UX-09 | Owner overview links into the "Advanced" batch screens: board cards open `/production/{batchId}` and "+N more in Batches" opens `/production`. | Medium | owner, site_manager | `dashboard/owner-overview.tsx:54,129` | Link to the production order hub `/production/orders/{id}`. |
| UX-10 | Wrong-module items: Inspection plans (Quality) -> `/masterdata/inspection-plans`; Label verification (Warehouse) -> `/quality/label-verification`; Products and formulas / Steps / Work instructions / Equipment (Production "Setup") -> `/masterdata/*`; Sync conflicts (Admin) -> `/sync/conflicts`; Forecast assumptions (Procurement) uses an analytics permission. | Medium | qa_qc, warehouse, admin | `nav.ts:26-29,74,125,156,222` | Place each item where its workflow runs; keep one canonical route and redirect others. |
| UX-11 | Same records under two menus: Suppliers (`/procurement/suppliers` "Approved suppliers" and `/masterdata/suppliers`), Locations (`/inventory/locations` and `/masterdata/locations`), Products (`/masterdata/products` and "Products and formulas" `/masterdata/formulas`), Recall explorer `/quality/recall` vs Recall cases `/quality/recalls`, Dispatch vs Shipments. | Medium | procurement, warehouse, qa_qc, sales_cs | `nav.ts:50-51,120,124,139,153,190-192` | One entry per record type; rename near-identical pairs ("Trace a lot" vs "Recall cases"). |
| UX-12 | Utility pages are primary menu items: Notifications, Help & guides, My account, Sync & offline sit in the Home group although the top bar (bell, avatar menu with "My account and devices", sync chip) already provides them. | Low | all | `nav.ts:44`; `shell.tsx:165,179,193` | Remove from the menu; keep in top bar / account menu. |
| UX-13 | "Coming next: HR & attendance" (`href: "#"`) is shown in the phone/tablet drawer only, not on desktop. HR, attendance and payroll have no routes and no permissions, but the brief's Management destination lists them. | Medium | owner, site_manager | `nav.ts:227-233`; `shell.tsx:357-366`; no `hr.*`/`payroll.*` in `src/lib/permissions.ts` | Remove the entry from navigation until built; track HR/payroll as a roadmap item in `docs/backlog.md`, not as a disabled menu row. |
| UX-14 | Analytics shows "Not available yet · {phase}" cards and a "Not available yet" list. Honest (no fake numbers) but adds dead tiles to dashboards. | Low | owner, site_manager | `analytics/kpi-ui.tsx:131-140`; `analytics/definitions/page.tsx:100` | Keep honesty; hide unavailable KPIs from dashboards, list them only on KPI definitions. |
| UX-15 | Operator "My work" is not assigned work: the page lists every open production order at the site; production orders have no assignee column (`assigned_to` exists only in fulfilment and maintenance). | High | production_operator | `production/orders/page.tsx:67,75`; `src/db/schema/fulfilment.ts:171`, `maintenance.ts:102` | Add assignment (team or person) to the workflow model before calling it "My work"; until then label it "Open orders". |
| UX-16 | Phone tab bars miss the main task: production_operator tabs are Home, Today, Scan, Help ("Today" is a read-only daily log list, ADR-080 G1); warehouse_operator tabs are Home, Scan, Help, with no receiving/picking task tab and no Menu tab (drawer only via the header button). | High | production_operator, warehouse_operator | `nav.ts:290-298`; `shell.tsx:133` | Tabs: Home, My tasks, Scan, Alerts, Menu (as `ux-system.md` §3.4 already specifies). |
| UX-17 | Operator home tiles are not task counts and use banned words: "Receive materials" counts "receipts posted today" and says "create lots in quarantine"; "Scan / look up" counts "lots with stock on hand"; "QA queue" says "quarantined lots"; "Dispatch orders" opens `/sales`, not the dispatch screen. | Medium | production_operator, warehouse_operator, qa_qc | `src/modules/analytics/dashboard.ts:482,492,518-522,531` | Count work waiting (expected deliveries today, picks open); link to the task screen; apply ADR-080 word list. |
| UX-18 | Jargon in menus and page copy: FEFO & reservations, Goods receipts, Put away, Bulk disposition, CAPA, Change control, PM plans, Periods and locks, Reason codes, Units of measure, Numbering, Diagnostics, Lots & stock; page text "posted to quarantine" (`warehouse/packs/page.tsx:31`), "QA dispositions" (`quality/page.tsx:173`), "Pick list (FEFO allocation)" and "Next: start the pick list (Fulfilment)" (`sales/[orderId]/page.tsx:25,191`). "Fulfilment" is not a menu label anywhere. | Medium | all non-specialists | `nav.ts` labels; files cited | Plain-language label set per destination; specialist terms only in More details or Management. |
| UX-19 | Same thing, different names: menu "Receive materials" vs page title "Receive a delivery" (`inventory/receive/page.tsx:38`); "Scan to move" vs "Move stock" (`warehouse/page.tsx:22`); rail "QA queue" vs tab "Quality check" vs page "QA queue"; group "Home" shown as pill "Overview" (`shell.tsx:153`) next to item "Overview"; "Production orders" vs "My work" vs "Orders". | Medium | all | as cited | Glossary of screen names in `docs/PRD.md`; menu label = page title. |
| UX-20 | No Operations Center: no screen shows the pipeline Expected -> Receiving -> Inspection -> Available -> Production -> QC -> Packaging -> FG -> Orders -> Dispatch with real counts. Closest are the owner overview batch board (production only) and `/warehouse` section tiles. | High | owner, site_manager, planner | no route; `dashboard/owner-overview.tsx:120-135`; `warehouse/page.tsx` | Build Operations Center from existing state machines (Part II §9); counts from records only. |
| UX-21 | No common transaction detail layout. Sales order, PO, goods receipt, production order and batch pages each compose `Card`/`Dl`/`Banner` differently; only some show a progress strip; activity history appears on some (shipment, PO, sales order) and not on others (goods receipt, production order). | Medium | all | `sales/[orderId]/page.tsx`, `procurement/orders/[id]/page.tsx`, `inventory/receive/[grId]/page.tsx`, `production/orders/[workOrderId]/page.tsx`, `production/[batchId]/page.tsx` | One `RecordPage` layout: header, progress, current work + one primary action, related, activity (Part II §7). |
| UX-22 | Workflow continuity is partial: the receipt page links to Put away and labels but not to the inspection; the sales order's next step is text ("start the pick list (Fulfilment)") plus a `FulfilmentPanel`; invoices and payments for an order live only under Finance. There is no workflow-instance record (reference, type, current step, assignee) across modules. | High | warehouse_operator, sales_cs, finance | `inventory/receive/[grId]/page.tsx:97,124`; `sales/[orderId]/page.tsx:25,315`; `src/db/schema/` has no workflow-instance table | Each record shows "Next step" as one button to the next screen; design the workflow read model in `docs/WORKFLOW_ARCHITECTURE.md` before schema work. |
| UX-23 | Inventory does not present Raw materials / WIP / Finished goods as first-level choices. ADR-077 sections exist (`raw_materials`, `packaging`, `finished_goods`, `qa_hold`, `production`...) and drive `/warehouse` tiles and `/inventory?section=`, but the Inventory group is 7 tabs by function (lots, locations, boxes, availability, expiry, FEFO, movements). | Medium | warehouse, planner, owner | `nav.ts:47-57`; `src/lib/location-sections.ts`; `warehouse/page.tsx:44` | Inventory = tabs Raw materials / WIP / Finished goods + Scan as primary action; other views as filters. |
| UX-24 | 28 pages have no error boundary on their path, including high-traffic ones: `/inventory`, `/inventory/scan`, `/inventory/[lotId]`, `/inventory/movements`, `/production`, `/production/[batchId]`, `/sales`, `/sales/[orderId]`, `/sales/new`, `/quality`, `/quality/trace`, `/quality/lots/[lotId]`, `/quality/batches/[batchId]`, `/approvals`, `/action-centre`, `/reports/*` (5), `/documents/[id]`, `/help`, `/masterdata/lists`. No root `(app)/error.tsx`. | Medium | all | `find` result §2.3 | Add `src/app/(app)/error.tsx` (one shared boundary with retry and reference id, `ux-system.md` §6) plus segment boundaries for the pages above. |
| UX-25 | Some list pages have no explicit empty state: `/production/defects` renders nothing when there are no products (`products.length > 0 &&`), `/finance/periods`, `/warehouse/repack` (no `EmptyState`). 195 files do use `EmptyState`. | Low | finance, operators | `production/defects/page.tsx:35` | Add empty states with the next action. |
| UX-26 | Long, single-page forms without progressive disclosure: material (18 fields, `masterdata/materials/material-fields.tsx`), supplier (16), complaint (18), CAPA (19); the customer page carries 9 inline forms (profile, credit, status, address, contact, requirement, artwork, item code) on one screen (`sales/customers/[id]/customer-forms.tsx`); the batch record page is 683 lines with 34 inputs in `exec-forms.tsx`. Only the receive form uses "More details" (`receive-form.tsx`, 6 disclosures). | Medium | sales_cs, procurement, qa_qc, operators | files cited | Required fields first, rest under "More details" (pattern from ADR-077 receive screen); customer page as tabs. |
| UX-27 | Rail is desktop-only and duplicates menu items; with 8 icon-only actions (owner sees 7) it adds a sixth navigation surface without labels. | Low | desktop users | `shell.tsx:254-274` | Replace with one primary "New" / "Scan" action per destination. |
| UX-28 | Desktop top bar: 12 pills in a horizontally scrolling, scrollbar-hidden strip (`scroll-x-hidden overflow-x-auto`); at 1024-1280 px the last groups are likely off-screen with no affordance (inferred, not measured). Sub-tab rows of 15-16 pills wrap to two or three lines (Warehouse, Admin). | Medium | desktop/iPad landscape | `shell.tsx:140,224` | Five destinations fit without scrolling; sub-navigation as a left list inside the destination. |
| UX-29 | Inbox overlap: `/approvals` (To approve), `/action-centre` (approvals + exceptions + alerts), `/notifications` (bell) and `/sync` each list "things needing attention". | Medium | owner, site_manager, qa_qc | `approvals/page.tsx:70`; `action-centre/page.tsx:84-85`; `nav.ts:44` | One "Needs attention" area on Home with tabs Approvals / Alerts / Sync. |
| UX-30 | Persona logic puts warehouse operators into the production "operator" persona, so they get production "My work" and production Advanced items in their menu. | Low | warehouse_operator | `nav.ts:246` | Separate warehouse persona; driven by permissions as today. |
| UX-31 | Documentation drift: `ux-system.md` §3 amendment still says phone tabs are "Home, Scan, Batches, QA, Orders" and §3.1 describes a 240 px left nav; code uses role tabs (`tabsFor`) and top pills. | Low | engineers | `docs/ux-system.md` §3 (lines ~270-277, 305-330, 353-362) | Update `ux-system.md` §3 when the new navigation is approved (`docs/NEW_NAVIGATION.md`). |

No button was found that fakes success: grep for "Coming", "TODO", "not yet", "placeholder" found
only the HR planned row (UX-13) and the honest "Not available yet" KPI cards (UX-14); `disabled`
controls found are pending-state submit buttons, empty select prompts and locked system roles
(`admin/roles/forms.tsx:48`). This was not verified by clicking (see §1.1).

### 4.1 Priority summary

| Priority | Findings | Why first |
|---|---|---|
| P1 (navigation and operator focus) | UX-01, 02, 08, 15, 16 | These cause the "overwhelming" feeling and can be fixed largely by regrouping and per-role visibility, with no schema change except assignment (UX-15). |
| P2 (connected work) | UX-03, 04, 20, 21, 22, 23 | Need the workflow read model, Operations Center and the shared record layout. |
| P3 (duplicates and words) | UX-05, 06, 07, 09, 10, 11, 12, 17, 18, 19, 29, 30 | Mostly label and menu changes with redirects. |
| P4 (states and polish) | UX-13, 14, 24, 25, 26, 27, 28, 31 | Robustness and consistency. |

## 5. What is already good and must be preserved

| Strength | Evidence | Why it matters for the redesign |
|---|---|---|
| Server-side authorization: every page calls `requireContext()` and checks `ctx.can(...)`; services take `AuthContext` and check permission and site; hiding a menu item never grants or removes access | `src/lib/auth/context.ts`, `src/app/(app)/forbidden.tsx`, e.g. `production/orders/page.tsx:63` | Menus can be regrouped freely; security does not depend on navigation. |
| Single stock ledger (`postMovement`), immutable postings, reversals with reason | `src/modules/inventory/ledger.ts`; CLAUDE.md | Operations Center counts and inventory tabs can read from it without new stock logic. |
| Production flow v2 order hub: one production order, simple status list, one next action, "who can help" when the user cannot act, materials list, weigh card with lot confirm, step cards | ADR-080; `production/orders/[workOrderId]/page.tsx`; `production-order-next.ts`; `ui/who-can-help.tsx` | This is the model for the shared transaction detail page (Part II §7) and the operator workspace. |
| Per-role navigation built from permissions, unit-tested | `nav.ts:243-299`; `tests/unit/nav-per-role.test.ts` | The five destinations can reuse `buildNav`/`tabsFor` and their tests. |
| Notification deep links and "To approve" with in-place decisions using module services | ADR-075; `src/lib/record-links.ts`; `tests/unit/record-links.test.ts` | Every alert already opens its record; keep this for the Home "Needs attention" list. |
| Tablet receive screen: one card per item, "More details" disclosure, container queries | ADR-077 §3; `inventory/receive/receive-form.tsx` | Pattern for shortening other long forms (UX-26). |
| Warehouse sections (raw materials, packaging, finished goods, QA hold, production) | ADR-077 §1; `src/lib/location-sections.ts` | Basis for Raw materials / WIP / Finished goods tabs (UX-23). |
| Honest analytics: owner overview says "every number opens the records behind it"; unavailable KPIs say why instead of showing a number | `dashboard/page.tsx:49`; `analytics/kpi-ui.tsx:131` | Matches Part II §8 and §15 (no fake metrics). |
| Operator home with large tiles and live counts; banned-word list for operator screens | `dashboard/operator-home.tsx`; `docs/reviews/production-flow-v2-ux-review.md` §4 | Starting point for the operator workspace; fix counts and words (UX-17). |
| Design tokens, status chips with icon + label + colour, navigation progress bar, error boundaries on 61 segments, `EmptyState` in 195 files | `docs/ux-system.md` §2, §6; `src/ui/status.tsx`; `src/ui/navigation-progress.tsx` | The redesign is a restructuring, not a new visual system. |
| Draft deletion and system-assigned codes | ADR-075 | Keeps mistakes cheap for a first-time owner. |

## 6. Assumptions (flag for owner approval)

| ID | Assumption |
|---|---|
| A-UXA-01 | Shipped `ROLE_BUNDLES` reflect how roles are used in the company; custom roles were not inspected. |
| A-UXA-02 | Part II's five destinations replace the 12 module pills; existing URLs are kept and regrouped (with redirects where a route moves), so bookmarks, notification links and tests keep working. |
| A-UXA-03 | HR, attendance and payroll are not built; Management will show them only when the owner approves that phase (master brief phases). |
| A-UXA-04 | "Assigned work" for operators needs an assignment field or team rule on production orders; who assigns (planner or site manager) is an owner decision. |

## 7. Next steps

1. Owner reviews this audit (Part II §19: no redesign coding before approval).
2. `docs/NEW_NAVIGATION.md`: map all 117 menu entries to the five destinations, per role, with redirects.
3. `docs/WORKFLOW_ARCHITECTURE.md`: pipeline stages and the workflow read model over existing state machines (UX-20, UX-22).
4. `docs/OPERATOR_EXPERIENCE.md` and `docs/OWNER_EXPERIENCE.md` from findings UX-02, 15, 16, 17 and UX-06, 07, 09, 29.
5. Quick wins that need no approval of structure but are safe: root `(app)/error.tsx` (UX-24), owner overview links to the order hub (UX-09), label/title alignment (UX-19). Each still needs a ticket and tests.

## 8. Status after slice R1 (ADR-081)

| Finding | Status |
|---|---|
| UX-01, UX-28 | Done: five destinations; section menus instead of 15-pill rows |
| UX-02 | Done for menus: operator and warehouse personas get Home, Operations, Inventory (warehouse also picking in Sales & Customers); no Management |
| UX-05 | Partly: rail removed; Scan stays in the top bar, the tab bar and Inventory |
| UX-07 | Done: analytics and reports together under Management → Reports & analytics |
| UX-10 | Done for menus: setup items, inspection plans in Management → Production setup; label verification in Packing & dispatch |
| UX-16, UX-30 | Done: new tab bars per persona, separate warehouse persona, every bar ends with Menu |
| UX-20 | Done: Operations Center `/operations` |
| UX-23 | Done: Inventory tabs Raw materials · Work in progress · Finished goods |
| UX-24 | Partly: app-wide `src/app/(app)/error.tsx` added; segment boundaries remain |
| UX-27 | Done: rail removed |
| UX-31 | Done: `ux-system.md` §3 points to `NEW_NAVIGATION.md` |
| UX-03, 04, 06, 09, 15, 17–19, 21, 22, 26, 29 | Open: see `docs/REDESIGN_IMPLEMENTATION_PLAN.md` R2–R4 |
