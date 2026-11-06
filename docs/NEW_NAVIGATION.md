# New navigation: five destinations (ADR-081)

| | |
|---|---|
| Status | Built in slice R1 (2026-10-30); round 2 of the UX audit fixes (2026-10-31): one door per job, menu words = screen titles, smaller office menu |
| Code | `src/app/(app)/nav.ts` (model), `src/app/(app)/shell.tsx` (top bar, section menus, phone tab bar, drawer) |
| Tests | `tests/unit/nav-per-role.test.ts`, `tests/unit/nav-titles.test.ts` |
| Read with | `docs/archive/UX_AUDIT.md` (why), `docs/archive/WORKFLOW_ARCHITECTURE.md` (what the Operations destination shows) |

## 1. Principles

1. **Five destinations, always in the same order:** Home, Operations, Inventory, Sales & Customers,
   Management. A user sees only those with at least one screen they may open.
2. **Every screen keeps its URL.** Only its place in the menu changed. Notification links, bookmarks,
   printed QR links and tests keep working.
3. **Each screen is listed once.** (Test: "every screen is listed once".)
4. **Main tabs + small section menus.** Inside a destination the daily screens are tabs; the rest sit in
   named menus that open on tap. "Planning tools" and "IT and system" are always last.
5. **Menus never grant access.** Every page and service still checks permission and site on the server;
   hiding a menu entry is only about focus.

## 2. The map (UX audit round 2, 2026-10-31; round 4, 2026-11-01; generated from `nav.ts`)

Legend: tabs = always visible inside the destination; *Section* = a menu of that name; folded *Advanced* =
rarely used entries at the end of a section (one more tap). ¹ also the top-bar bell, so the tab rows leave it
out; ² also the top-bar "To approve" button from 640 px, so the tab row shows it on phones only. The drawer
(the full menu) lists every entry. ³ round 4: folded under *Advanced* for everyone except the roles that use it daily
(`foldUnless` in `nav.ts`: QA for the recall and change screens, warehouse for repacking and stock lists, finance for
statements, credits and month close, purchasing for supplier returns, system admin for the rare settings and IT
screens, floor roles for Working without signal). Operators see "My work" and "Today" instead of the production tabs;
floor roles keep only their screens (ADR-083). *IT and system* is for the system admin and the owner only.

### Home — "Your day at a glance"
- tabs: Overview (`/dashboard`), To approve (`/approvals`) ², Messages (`/notifications`) ¹, Problems & alerts (`/action-centre`)
- *Help & my account*: Help (`/help`), My account (`/account`), Working without signal (`/sync`) ³, Expense claims (`/finance/expenses`)

### Operations — "Production and the daily work"
- tabs: Operations Center (`/operations`), Production orders (`/production/orders`), Today (`/production/today`), Rejects (`/production/defects`), Check a batch or delivery (`/quality`), Floor screen (TV) (`/floor`)
- *Receiving*: Deliveries coming (`/procurement/expected`), Receive a delivery (`/inventory/receive`), Deliveries received (`/inventory/receipts`), Put away (`/inventory/receive/put-away`)
- *Quality*: Quality tests (`/quality/inspections`), Problem reports (`/quality/deviations`), Stopped by QA (`/quality/holds`), Decide many lots at once (`/quality/bulk`) ³, Where it came from and where it went (`/quality/trace`), Customer complaints (`/quality/complaints`), Who received it (recall check) (`/quality/recall`) ³, Product recalls (`/quality/recalls`) ³, Fix-and-prevent plans (`/quality/capa`), Change requests (`/quality/changes`) ³
- *Packing & dispatch*: Boxing (`/warehouse/packs`), Repack for a customer (`/warehouse/repack`) ³, Check the labels in an area (`/quality/label-verification`) ³, To get from shelf (`/sales/picking`), Send out (`/sales/dispatch`), Deliveries (`/sales/shipments`)
- *Maintenance*: Maintenance (`/maintenance`), Regular maintenance (`/maintenance/plans`), Repair jobs (`/maintenance/work-orders`); folded *Advanced*: Spare parts (`/maintenance/spare-parts`)

### Inventory — "Track stock and materials"
- tabs: Stock (`/inventory`), Scan or search (`/inventory/scan`), Move stock (`/inventory/move`), Warehouse (`/warehouse`)
- *More stock lists*: Shelves (`/inventory/locations`) ³, Boxes and sacks (`/inventory/containers`) ³, Can we deliver? (`/inventory/availability`), Expiring soon (`/inventory/lots/expiry`), Which one to use first / set aside (`/inventory/lots/reservations`) ³, Stock changes (`/inventory/movements`) ³
- *Counts & labels*: Stock counts (`/inventory/counts`), Fix stock (`/inventory/adjustments`), Labels printed (`/labels`; not in the operator and warehouse menus, ADR-099)

### Sales & Customers — "Orders, deliveries and payments"
- tabs: Customer orders (`/sales`), Customers (`/sales/customers`), Orders as a board (`/sales/board`)
- *Quotes, prices & returns*: Price offers (`/sales/quotations`), Prices (`/sales/price-lists`), Customer returns (`/sales/returns`)
- *Billing & payments*: Invoices (`/finance/invoices`), Payments (`/finance/payments`), Customer statements (`/finance/statements`) ³, Credits (money back) (`/finance/credit-notes`) ³

### Management — "Buying, money, reports and settings"
- tabs: Management (`/management`)
- *Reports & analytics*: Business overview (`/analytics/overview`), Reports (`/analytics`), Lists to download or print (`/reports`); folded *Advanced*: Compare over time (`/analytics/trends`), Lists sent by email (`/reports/schedules`), What each number means (`/analytics/definitions`)
- *Purchasing*: Purchasing (`/procurement`), Requests to buy (`/procurement/requests`), Purchase orders (`/procurement/orders`), Send back to supplier (`/procurement/returns`) ³, Suppliers we may buy from (`/procurement/suppliers`), Running low (`/procurement/reorder`); folded *Advanced*: How suppliers do (`/procurement/performance`), Sales guess (`/procurement/forecast`)
- *Finance*: Money (`/finance`), Supplier bills (`/finance/bills`), Close the month (`/finance/periods`) ³; folded *Advanced*: Tax rates (`/finance/tax`)
- *Production setup*: Recipes (`/masterdata/recipes`, the plain list; "New recipe" opens the wizard from it), How-to sheets (`/masterdata/work-instructions`), Quality checks for each item (`/masterdata/inspection-plans`) ³, Equipment (`/masterdata/equipment`); folded *Advanced*: Recipes (advanced) (`/masterdata/formulas`), Steps (advanced) (`/masterdata/routings`)
- *Master data*: Materials (`/masterdata/materials`), Products (`/masterdata/products`), Locations (`/masterdata/locations`), Sites (`/masterdata/sites`) ³, Warehouses (`/masterdata/warehouses`) ³, Making areas / lines (`/masterdata/lines`) ³; folded *Advanced*: Units (`/masterdata/uom`), Choice lists (`/masterdata/lists`), Reasons (`/masterdata/reason-codes`)
- *People, rules and settings* (round 4: one sub-menu instead of "People & access" and "Rules and settings"): People who use the app (`/admin/users`), Roles (what each job may do) (`/admin/roles`), Settings (`/admin/settings`), Who says OK to what (`/admin/approval-rules`), History of changes (`/admin/audit`), Who gets which message (`/admin/notification-rules`) ³, Labels and printouts (`/admin/templates`) ³, How record numbers look (`/admin/numbering`) ³
- *Planning tools*: Production plan (`/production/plan`), Batch records (`/production`)
- *IT and system*: Health of the system (`/admin/diagnostics`), Load data from a spreadsheet (`/admin/imports`), Who is signed in (`/admin/sessions`) ³, Sign-in safety (`/admin/security`) ³, Phones and tablets (`/admin/devices`) ³, Phone changes to check (`/sync/conflicts`) ³, Keeping and deleting old records (`/admin/retention`) ³, Old paper documents (`/admin/imports/legacy-documents`) ³

### Round 2 rules (UX audit 2026-10-31)

1. **One door per job.** "To approve" is the top-bar button (from 640 px) or a Home tab (phones); Problems &
   alerts links to it instead of keeping a "To decide" list. "Messages" is only the top-bar bell. One QA door
   ("Check a batch or delivery", `/quality`; the batch-only list `/quality/check` opens from it); one
   supplier list in the menu ("Suppliers we may buy from"; it links to adding and editing a supplier); one
   "Expense claims" entry for people who file or approve claims.
2. **Menu word = screen title.** Every entry uses the H1 of the screen it opens (test
   `tests/unit/nav-titles.test.ts`; screens with a dynamic H1 are listed there with the reason).
3. **Old production screens are in no menu** (`/production/work-orders`, `/production/board`,
   `/production/staging`, `/production/new`); they redirect to the new flow (round 1).
4. **Frame targets are at least 44 px** at 390, 820 and 1440 px (top bar, tab rows, drawer, dropdowns,
   account menu, demo strip); the phone tab row scrolls with a fade and keeps "More" visible.
5. **Scan in the top bar for every role** (icon + "Scan" on phones, "Scan or search" on tablets).

### Round 4 rules (live re-audit C, 2026-11-01)

6. **No empty or one-entry sub-menus.** After filtering per role (`tidySections` in `nav.ts`), a sub-menu whose
   entries are all folded joins the sub-menu before it (still folded), and a sub-menu with one entry joins its
   neighbour. *Planning tools* and *IT and system* stay as they are (always last). The sales role no longer sees an
   empty *Purchasing*; the system admin no longer sees a one-entry *Purchasing*.
7. **A short owner menu without hiding work.** `foldUnless` folds rare entries under *Advanced* for everyone except
   the roles that use them daily (³ above). Owner: 73 of 112 entries visible without opening a fold (was 103 of 113).
8. **The Operations sub-row fits one line at 1440 px**: the destination's one-line description shows from 1536 px
   (it is also the pill's tooltip).
9. **Frame:** the site selector shows the site's name only, never cut (the code is in its tooltip); a Help "?"
   (44 px) in the top bar on every screen opens the quick guide for that screen (`src/ui/help/screen-guides.ts`,
   role guide otherwise); at 1280–1535 px Scan shows the word "Scan", and To approve and Messages show their words
   when the bar has room (one site); with the site selector they stay icons with tooltips (measured: 110 px short).

### Live check rules (desktop Chrome, 2026-11-06)

10. **The desktop tab row is one line at 1280, 1440 and 1920 px.** At most 7 entries (tabs and sub-menus,
    `DESKTOP_ROW_MAX`, `desktopRow` in `nav.ts`); the rest go into one **More ▾** menu at the end of the row, which
    lists the left-over tabs first and then each left-over sub-menu under its name (Advanced still folded). Tabs marked
    `deskMore` leave the row first: *Floor screen (TV)* and *Rejects*. Owner: Operations shows Operations Center, How
    work flows, Production orders, Today, Check a batch or delivery, Receiving ▾, Quality ▾, More ▾ (Floor screen,
    Rejects, Packing & dispatch, Maintenance); Management shows Management and six sub-menus, More ▾ (Planning tools,
    IT and system). More is highlighted when the open page is inside it. Phones and tablets are unchanged (their row
    scrolls sideways and "More" opens the drawer). Menu words still equal the screen titles; nothing is removed.

### Where things moved (old group → new place)

| Old group | Now |
|---|---|
| Home: Dashboards, Trends, KPI definitions | Management → Reports & analytics |
| Warehouse (15 items) | Receiving steps → Operations → Receiving; Boxing, Repack, Label verification, Picking, Dispatch → Operations → Packing & dispatch; Scan, Move, Counts, Adjustments, Labels, Warehouse sections → Inventory |
| Production | Operations (tabs); Setup → Management → Production setup; Advanced unchanged |
| Maintenance | Operations → Maintenance |
| Quality | QA queue → Operations tab "Quality check"; the rest → Operations → Quality; Inspection plans → Management → Production setup |
| Sales | Sales & Customers; Shipments → Operations → Packing & dispatch |
| Procurement | Management → Purchasing (Expected receipts → Operations → Receiving) |
| Finance | Customer side → Sales & Customers → Billing & payments; the rest → Management → Finance |
| Reports, Master data, Admin | Management |
| Quick-action rail | Removed; its actions are the Operations Center "Quick links" |

## 3. Visibility per role (shipped role bundles)

| Persona (from permissions) | Destinations | Phone/iPad-portrait tab bar |
|---|---|---|
| Owner | all five | Home · Operations · Inventory · Sales · Menu |
| Planner, site manager, viewer roles (auditor, sales, finance, procurement, admin) | those with a permitted screen | Home · Operations · Inventory · Sales · Menu (tabs without permission drop out) |
| QA | all with a permitted screen | Home · Quality check · Operations · Scan · Menu |
| Production operator | Home, Operations, Inventory | Home · My work · Today · Scan · Menu |
| Warehouse operator | Home, Operations, Inventory, Sales & Customers (picking-related) | Home · Receive · Scan · Inventory · Menu |

Operator and warehouse personas never get Management (A-UX-02). The persona is decided by permissions
first, role names second, so custom roles behave sensibly (`productionPersona`).

## 4. Shell behaviour

- **Desktop (≥ 1280 px):** logo, five destination pills (icon + label, description as tooltip), then site
  switcher (name only), Scan, sync chip, To approve, notifications, Help "?", account. Under it, the active destination's tabs
  and section menus. The section of the current page is highlighted.
- **Phone / iPad portrait:** the role's tab bar at the bottom; "Menu" opens the drawer with the five
  destinations, their tabs, and each section collapsed (the current one opens).
- **Badges:** To approve (count waiting for the user) and Quality check (lots and batches waiting for QA).
