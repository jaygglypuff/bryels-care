# New navigation: five destinations (ADR-081)

| | |
|---|---|
| Status | Built in slice R1 (2026-10-30); round 2 of the UX audit fixes (2026-10-31): one door per job, menu words = screen titles, smaller office menu |
| Code | `src/app/(app)/nav.ts` (model), `src/app/(app)/shell.tsx` (top bar, section menus, phone tab bar, drawer) |
| Tests | `tests/unit/nav-per-role.test.ts`, `tests/unit/nav-titles.test.ts` |
| Read with | `docs/UX_AUDIT.md` (why), `docs/WORKFLOW_ARCHITECTURE.md` (what the Operations destination shows) |

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

## 2. The map (UX audit round 2, 2026-10-31; generated from `nav.ts`)

Legend: tabs = always visible inside the destination; *Section* = a menu of that name; folded *Advanced* =
rarely used entries at the end of a section (one more tap). ¹ also the top-bar bell, so the tab rows leave it
out; ² also the top-bar "To approve" button from 640 px, so the tab row shows it on phones only. The drawer
(the full menu) lists every entry. Operators see "My work" and "Today" instead of the production tabs;
floor roles keep only their screens (ADR-083). *IT and system* is for the system admin and the owner only.

### Home — "Your day at a glance"
- tabs: Overview (`/dashboard`), To approve (`/approvals`) ², Messages (`/notifications`) ¹, Problems & alerts (`/action-centre`)
- *Help & my account*: Help (`/help`), My account (`/account`), Working without signal (`/sync`), Expense claims (`/finance/expenses`)

### Operations — "Production and the daily work"
- tabs: Operations Center (`/operations`), Production orders (`/production/orders`), Today (`/production/today`), Rejects (`/production/defects`), Check a batch or delivery (`/quality`), Floor screen (TV) (`/floor`)
- *Receiving*: Deliveries coming (`/procurement/expected`), Receive a delivery (`/inventory/receive`), Deliveries received (`/inventory/receipts`), Put away (`/inventory/receive/put-away`)
- *Quality*: Quality tests (`/quality/inspections`), Problem reports (`/quality/deviations`), Stopped by QA (`/quality/holds`), Decide many lots at once (`/quality/bulk`), Where it came from and where it went (`/quality/trace`), Customer complaints (`/quality/complaints`), Who received it (recall check) (`/quality/recall`), Product recalls (`/quality/recalls`), Fix-and-prevent plans (`/quality/capa`), Change requests (`/quality/changes`)
- *Packing & dispatch*: Boxing (`/warehouse/packs`), Repack for a customer (`/warehouse/repack`), Check the labels in an area (`/quality/label-verification`), To get from shelf (`/sales/picking`), Send out (`/sales/dispatch`), Deliveries (`/sales/shipments`)
- *Maintenance*: Maintenance (`/maintenance`), Regular maintenance (`/maintenance/plans`), Repair jobs (`/maintenance/work-orders`), Spare parts (`/maintenance/spare-parts`)

### Inventory — "Track stock and materials"
- tabs: Stock (`/inventory`), Scan or search (`/inventory/scan`), Move stock (`/inventory/move`), Warehouse (`/warehouse`)
- *More stock lists*: Shelves (`/inventory/locations`), Boxes and sacks (`/inventory/containers`), Can we deliver? (`/inventory/availability`), Expiring soon (`/inventory/lots/expiry`), Which one to use first / set aside (`/inventory/lots/reservations`), Stock changes (`/inventory/movements`)
- *Counts & labels*: Stock counts (`/inventory/counts`), Fix stock (`/inventory/adjustments`), Labels printed (`/labels`; not in the operator and warehouse menus, ADR-099)

### Sales & Customers — "Orders, deliveries and payments"
- tabs: Customer orders (`/sales`), Customers (`/sales/customers`), Orders as a board (`/sales/board`)
- *Quotes, prices & returns*: Price offers (`/sales/quotations`), Prices (`/sales/price-lists`), Customer returns (`/sales/returns`)
- *Billing & payments*: Invoices (`/finance/invoices`), Payments (`/finance/payments`), Customer statements (`/finance/statements`), Credits (money back) (`/finance/credit-notes`)

### Management — "Buying, money, reports and settings"
- tabs: Management (`/management`)
- *Reports & analytics*: Business overview (`/analytics/overview`), Reports (`/analytics`), Compare over time (`/analytics/trends`), Lists to download or print (`/reports`); folded *Advanced*: Lists sent by email (`/reports/schedules`), What each number means (`/analytics/definitions`)
- *Purchasing*: Purchasing (`/procurement`), Requests to buy (`/procurement/requests`), Purchase orders (`/procurement/orders`), Send back to supplier (`/procurement/returns`), Suppliers we may buy from (`/procurement/suppliers`), Running low (`/procurement/reorder`); folded *Advanced*: How suppliers do (`/procurement/performance`), Sales guess (`/procurement/forecast`)
- *Finance*: Money (`/finance`), Supplier bills (`/finance/bills`), Close the month (`/finance/periods`); folded *Advanced*: Tax rates (`/finance/tax`)
- *Production setup*: New recipe (`/masterdata/recipes/new`), How-to sheets (`/masterdata/work-instructions`), Quality checks for each item (`/masterdata/inspection-plans`), Equipment (`/masterdata/equipment`); folded *Advanced*: Recipes (advanced) (`/masterdata/formulas`), Steps (advanced) (`/masterdata/routings`)
- *Master data*: Materials (`/masterdata/materials`), Products (`/masterdata/products`), Locations (`/masterdata/locations`), Sites (`/masterdata/sites`), Warehouses (`/masterdata/warehouses`), Making areas / lines (`/masterdata/lines`); folded *Advanced*: Units (`/masterdata/uom`), Choice lists (`/masterdata/lists`), Reasons (`/masterdata/reason-codes`)
- *People & access*: People who use the app (`/admin/users`), Roles (what each job may do) (`/admin/roles`)
- *Rules and settings*: Settings (`/admin/settings`), Who says OK to what (`/admin/approval-rules`), Who gets which message (`/admin/notification-rules`), Labels and printouts (`/admin/templates`), How record numbers look (`/admin/numbering`), History of changes (`/admin/audit`)
- *Planning tools*: Production plan (`/production/plan`), Batch records (`/production`)
- *IT and system*: Who is signed in (`/admin/sessions`), Sign-in safety (`/admin/security`), Phones and tablets (`/admin/devices`), Phone changes to check (`/sync/conflicts`), Health of the system (`/admin/diagnostics`), Keeping and deleting old records (`/admin/retention`), Load data from a spreadsheet (`/admin/imports`), Old paper documents (`/admin/imports/legacy-documents`)

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

- **Desktop (≥ 1024 px):** logo, five destination pills (icon + label, description as tooltip), then site
  switcher, Scan, sync chip, To approve, notifications, account. Under it, the active destination's tabs
  and section menus. The section of the current page is highlighted.
- **Phone / iPad portrait:** the role's tab bar at the bottom; "Menu" opens the drawer with the five
  destinations, their tabs, and each section collapsed (the current one opens).
- **Badges:** To approve (count waiting for the user) and Quality check (lots and batches waiting for QA).
