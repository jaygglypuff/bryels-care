# Navigation: one short menu per job (round 5, ADR-129)

| | |
|---|---|
| Status | Round 5 (2026-11-08), owner decision "go ahead with the new navigation". Replaces the five destinations of ADR-081 (slice R1, rounds 2–4). |
| Code | `src/app/(app)/nav.ts` (catalogue, menus per job, bottom bars, active-area rule), `src/app/(app)/shell.tsx` (top bar, tab rows, bottom bar, drawer, avatar menu), `src/app/(app)/setup/page.tsx` (Set-up), `src/ui/master-search.tsx` (Search) |
| Tests | `tests/unit/nav-per-role.test.ts`, `tests/unit/nav-titles.test.ts`, `tests/unit/menu-paths.test.ts`, `tests/unit/search-screens.test.ts`, `tests/unit/search-round5.test.ts`, `tests/e2e/top-bar-fit.cjs` |
| Why | `docs/ux-audit/round5/` (A floor, B owner and manager, C office): "including navigation"; the owner could not find the search |

## 1. Principles

1. **Organised by the person's questions, not by department.** The owner asks "what needs me, how are sales, is
   production on track, do we have stock, how is the money": Home · Needs me · Sell · Make · Buy & stock · Money.
2. **Each job sees only its menu.** Office roles get the areas of their work (C report); floor roles get four doors
   in the bottom bar and no tab rows (A report).
3. **Two levels at most.** Area → at most five tabs (`MAX_TABS`) and one flat **More** list. No menu inside a menu,
   no section dropdowns, no chip rows inside pages (the purchasing chip row is gone), no hub card grids.
4. **Menu word = screen title** (ADR-101 stays; `tests/unit/nav-titles.test.ts`).
5. **Every screen is in the catalogue once** (`NAV` in `nav.ts`). Search, quoted menu paths in messages
   (`src/lib/menu-paths.ts`), the Set-up page and the "which area is this page in" highlight read it. A screen that left
   a job's menu still opens by URL, from links and from Search.
6. **Menus never grant access.** Every page and service checks permission and site on the server, as before.
7. **Set-up is not daily work.** Products, recipes, materials, people, settings, labels, shelves, machines and record
   numbers are on the Set-up page (`/setup`), opened from the avatar menu and from Search.

## 2. The catalogue (`NAV`)

| Area | Screens (tabs first for the owner and manager; the rest in More or Search) |
|---|---|
| Home | Home (`/dashboard`), Help, My account, Working without signal |
| Needs me | To approve, Problems & alerts, Messages |
| Sell | Customer orders, Customers, Price offers, Deliveries, Customer returns, Orders as a board; *Packing and sending*: To get from shelf, Send out, Boxing, Repack for a customer, Check the labels in an area |
| Make | Operations Center, Production orders, Production plan, Check a batch or delivery, Problem reports, Batch records, Today, Rejects, How work flows, Floor screen (TV); *Quality*: Quality tests, Stopped by QA, Decide many lots at once, Where it came from and where it went, Customer complaints, Who received it (recall check), Product recalls, Fix-and-prevent plans, Change requests; *Machines*: Maintenance, Regular maintenance, Repair jobs, Spare parts |
| Buy & stock | Stock, What to buy, Purchase orders, Deliveries coming, Suppliers we may buy from; *Buying*: Purchasing, Requests to buy, Send back to supplier, How suppliers do, Sales guess; *Receiving*: Receive a delivery, Deliveries received, Put away; *Stock*: Scan or search, Move stock, Warehouse sections, Shelves, Boxes and sacks, Can we deliver?, Expiring soon, Which one to use first / set aside, Stock changes, Stock counts, Fix stock, Labels printed |
| Money | Money, Invoices, Supplier bills, Payments, Reports, Customer statements, Credits (money back), Expense claims, Close the month, Tax rates; *Reports*: Business overview (detailed), Lists to download or print, Compare over time, Lists sent by email, What each number means |
| Set-up (avatar menu) | Set-up; *Products and recipes*: Products, Recipes, Materials, Prices, How-to sheets, Quality checks for each item, Recipes (advanced), Steps (advanced); *Places and machines*: Shelves and areas (set up), Equipment, Sites, Warehouses, Making areas / lines; *People, rules and settings*: People who use the app, Roles (what each job may do), Settings, Who says OK to what, Who gets which message, Labels and printouts, How record numbers look, History of changes; *Lists* (folded): Units, Choice lists, Reasons; *IT and system* (system admin and owner): Health of the system, Load data from a spreadsheet, Who is signed in, Sign-in safety, Phones and tablets, Phone changes to check, Keeping and deleting old records, Old paper documents |

"Running low" was renamed **What to buy** (screen title and menu word; C report #5).

## 3. Menus per job (`AREAS_BY_PERSONA`)

The job ("persona") is decided by role codes in this order: owner, site manager, planner, QA, finance, purchasing,
sales, warehouse, operator, system admin; then by permissions for custom roles (`navPersona`). Entries a person may
not open drop out; an area with nothing left drops out.

| Job | Top menu (from 1280 px) | Tabs (≤ 5) and More |
|---|---|---|
| Owner, site manager (also planner, auditor, system admin, filtered by permission) | Home · **Needs me** (badge) · Sell · Make · Buy & stock · Money | Needs me: To approve, Problems & alerts, Messages · Sell: Customer orders, Customers, Price offers, Deliveries, Customer returns; More: Orders as a board, To get from shelf, Send out, Boxing · Make: Operations Center, Production orders, **Production plan**, Check a batch or delivery, Problem reports; More: Batch records, Today, Rejects, How work flows, Quality tests, Stopped by QA, Where it came from and where it went, Customer complaints, Fix-and-prevent plans, Product recalls, Maintenance, Repair jobs, Regular maintenance · Buy & stock: Stock, What to buy, Purchase orders, Deliveries coming, Suppliers we may buy from; More: Requests to buy, Receive a delivery, Deliveries received, Put away, Move stock, Warehouse sections, Stock counts, Fix stock, Expiring soon, Can we deliver?, Shelves · Money: Money, Invoices, Supplier bills, Payments, Reports; More: Customer statements, Credits (money back), Expense claims, Business overview (detailed), Lists to download or print |
| Sales | Home · Orders · Customers · Price offers · Invoices | Orders: Customer orders, Orders as a board, Deliveries · Customers: Customers, Prices, Customer returns · Price offers · Invoices (to look at) |
| Purchasing | Home · Buying · Suppliers | Buying: What to buy, Requests to buy, Purchase orders, Deliveries coming, Deliveries received; More: Send back to supplier, Purchasing, Sales guess, Stock · Suppliers: Suppliers we may buy from, How suppliers do |
| Finance | Home (= the **Money** page) · Money in · Money out · Month end · Reports | Money in: Invoices, Payments, Customer statements, Credits (money back) · Money out: Supplier bills, Expense claims · Month end: Close the month, Tax rates · Reports: Reports, Business overview (detailed), Lists to download or print; More: Compare over time, Lists sent by email, What each number means |
| QA | Home · Check · Problems · Trace | Check: Check a batch or delivery, Quality tests, Stopped by QA, Decide many lots at once; More: Batch records, Stock, Check the labels in an area · Problems: Problem reports, Fix-and-prevent plans, Customer complaints, Product recalls, Change requests · Trace: Where it came from and where it went, Who received it (recall check) |
| Machine operator (floor) | My jobs · Scan · Batches · Help | none (the drawer lists My work: Production orders, Today, Stock, Scan or search) |
| Warehouse (floor) | My jobs · Scan · Receive · Help | none (the drawer lists Receiving, Packing and sending, Stock) |
| Floor display (TV) | — | Floor screen (TV) is its Home |

Not in any owner or manager menu (B report): Floor screen (TV), Decide many lots at once, Change requests, Recall
check, Repack, Check the labels in an area, Boxes and sacks, Stock changes, Labels printed, Lists sent by email, What
each number means, Compare over time, Sales guess, How suppliers do, Send back to supplier, Close the month, Tax rates,
Spare parts. They open from Search, links and (Set-up screens) the Set-up page.

## 4. Bottom bar (phones and tablets below 1280 px; `tabsFor`)

| Job | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Machine operator | My jobs | Scan | Batches | Help | |
| Warehouse | My jobs | Scan | Receive | Help | |
| Site manager | My jobs | Scan | To check/approve (badge) | Help | |
| Owner (planner, auditor, admin) | Home | Needs me (badge) | Sell | Make | Money |
| Sales | Home | Orders | Customers | Price offers | |
| Purchasing | Home | What to buy | Purchase orders | Suppliers | |
| Finance | Home | Money in | Money out | Reports | |
| QA | Home | Check | Problems | Trace | |

There is never a second menu button in the bottom bar. Floor people at 1280 px and wider see the same four doors as
the top-bar menu.

## 5. The frame (`shell.tsx`)

- **Top bar, from 1280 px:** logo (mark; full logo from 1536 px) · the menu row starting next to the logo · the
  **Search** box right after it · site selector (people with two or more sites) · sync chip (only when something waits
  to be sent or there is no signal) · To approve and Messages (office roles; owner and manager have them in Needs me)
  · Help "?" with the word Help from 1024 px (one site) · avatar. Floor roles: logo, their four doors, Search,
  Messages, avatar.
- **Below 1280 px:** one ☰ (not for floor roles) · logo · Search (a box with the word "Search" from 768 px, a
  labelled "Search" button on phones) · Messages (not owner and manager) · Help (from 640 px) · avatar.
- **Avatar menu:** name, job, site · My account and devices · Help · **Set-up** (people with set-up screens) ·
  **All screens** (opens the drawer, every width) · Reset demo data (demo owner) · Sign out.
- **Tab row:** the open area's tabs (≤ 5) and one flat **More** list (desktop); phones scroll the tabs with a fade
  and **More** opens the drawer at that area. Floor roles have no tab row (the "My work / Today" row that covered page
  titles is gone).
- **Drawer:** the job's areas (tabs, then More), Set-up, Help; the sync line in words. **Esc** closes it and any open
  frame menu (B report bug B12).
- **Which area lights up** (`activeEntry`): the most specific menu entry wins; a page that has a more specific screen
  of its own in the catalogue (Scan or search under Stock) lights only its area; a page outside the job's menu lights
  the catalogue area if the job has it. A batch record lights **Make → Batch records**, never Set-up (B report B13).
- **ADR-126 `ui.wide_screen_top_bar`:** "search" (default) as above; "scan" puts the **Scan** button where the Search
  box stands, at every width; Ctrl/⌘+K and "/" still open the search.
- Targets ≥ 44 px; no sideways scroll at 390, 820, 1366 and 1440 px.

## 6. Old addresses

Every screen keeps its URL. `/management` (the hub card grid) redirects to `/setup`. The old menu paths quoted in
messages were rewritten to the new ones (`tests/unit/menu-paths.test.ts`).

## 7. History

Round 1 (ADR-081): five destinations (Home, Operations, Inventory, Sales & Customers, Management) replaced fourteen
module menus. Rounds 2–4 (ADR-101, -107, -123): one door per job, menu words = titles, Advanced folds, the 1280 px fit.
Round 5 (ADR-129): one short menu per job, Set-up behind the avatar, labelled Search at every width (this page).
