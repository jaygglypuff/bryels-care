# New navigation: five destinations (ADR-081)

| | |
|---|---|
| Status | Built in slice R1 (2026-10-30) |
| Code | `src/app/(app)/nav.ts` (model), `src/app/(app)/shell.tsx` (top bar, section menus, phone tab bar, drawer) |
| Tests | `tests/unit/nav-per-role.test.ts` |
| Read with | `docs/UX_AUDIT.md` (why), `docs/WORKFLOW_ARCHITECTURE.md` (what the Operations destination shows) |

## 1. Principles

1. **Five destinations, always in the same order:** Home, Operations, Inventory, Sales & Customers,
   Management. A user sees only those with at least one screen they may open.
2. **Every screen keeps its URL.** Only its place in the menu changed. Notification links, bookmarks,
   printed QR links and tests keep working.
3. **Each screen is listed once.** (Test: "every screen is listed once".)
4. **Main tabs + small section menus.** Inside a destination the daily screens are tabs; the rest sit in
   named menus that open on tap. "Advanced" (the old detailed production screens) is always last.
5. **Menus never grant access.** Every page and service still checks permission and site on the server;
   hiding a menu entry is only about focus.

## 2. The map

Legend: **tab** = always visible inside the destination; *Section* = a menu of that name.

### Home — "Your day at a glance"
- tabs: Overview (`/dashboard`, per role: owner/manager pipeline + KPIs; operators task tiles), To approve,
  Notifications, Action centre
- *Me*: Help & guides, My account, Sync & offline, My expense claims

### Operations — "Production and the daily work"
- tabs: **Operations Center** (`/operations`, landing), production tabs per role (operators: My work, Today;
  others: Production orders, Today, Rejects, New order), Quality check (`/quality`)
- *Receiving*: Expected deliveries, Receive materials, Goods receipts, Put away
- *Quality*: Inspections, Deviations, QA holds, Bulk disposition, Traceability, Complaints, Recall explorer,
  Recall cases, CAPA, Change control
- *Packing & dispatch*: Boxing, Repack for a customer, Label verification, Picking, Dispatch, Shipments
- *Maintenance*: Maintenance, PM plans, Maintenance work orders, Spare parts
- *Advanced*: Production plan, Work orders (detailed), Board (detailed), Batches (full record), Materials by
  scan, New batch without an order

### Inventory — "Track stock and materials"
- tabs: Stock (`/inventory`, with its own tabs Raw materials · Work in progress · Finished goods · All
  stock), Scan, Scan to move, Warehouse sections
- *Stock views*: Locations & stock, Boxes, Availability, Expiry alerts, FEFO & reservations, Stock movements
- *Stock tasks*: Stock counts, Adjustments, Label print station

### Sales & Customers — "Orders, deliveries and payments"
- tabs: Customer orders, New order, Customers, Order board
- *Selling*: Quotations, Price lists, Customer returns
- *Billing & payments*: Invoices, Payments, Statements, Credit notes

### Management — "HR, finance, reports and settings"
- tab: Overview (`/management`, landing: one card per section the user may open)
- *Reports & analytics*: Dashboards, Trends, Report library, Scheduled reports, KPI definitions
- *Purchasing*: Purchasing overview, Purchase requests, Purchase orders, Supplier returns, Approved
  suppliers, Reorder suggestions, Supplier performance, Forecast assumptions
- *Finance*: Finance overview, Supplier bills, Expense approvals, Periods and locks, Tax configuration
- *Production setup*: Products and formulas, Steps for each product, Work instructions, Inspection plans,
  Equipment
- *Master data*: Materials, Products, Suppliers, Locations, Sites, Warehouses, Production lines, Units of
  measure, Lists, Reason codes
- *People & access*: Users, Roles, Sessions, Security, HR & attendance (shown disabled: "Phase 5–6")
- *System*: Audit log, Settings, Approval rules, Numbering, Templates & labels, Notification rules, Imports,
  Legacy documents, Devices, Sync conflicts, Retention & holds, Diagnostics

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
