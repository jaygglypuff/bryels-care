# Round 5 novice audits: what was done

| | |
|---|---|
| Audits | [A-floor.md](A-floor.md) (operator, checker, warehouse), [B-owner-manager.md](B-owner-manager.md), [C-office.md](C-office.md) (sales, purchasing, finance, QA) |
| Owner decision | "Go ahead with the new navigation" (2026-11-08) |
| Fixes split in three parts | **Part 1**: navigation, Homes, top and bottom bars, search, messages (ADR-129, this branch). **Part 2**: production floor screens (weigh, get materials, steps, label and pack, finish, checker flow, offline weigh, receiving form, pick and second-check pages). **Part 3**: sales, purchasing and finance flows (order lines, send/email, PO wizard, supplier bills, customers, what to buy, approvals). |
| Part 1 docs | `docs/NEW_NAVIGATION.md`, `docs/ux-system.md` §3 (round 5 block), `docs/help/*` (menu paths, everyday basics, owner guide), `docs/LEGACY_SCREENS.md` (`/management`) |

Status: **done** = built and tested in that part; **partly** = what is left is named; **not** = not done in part 1
(the part that owns it is named). Measurements are in §2.

## 1. Items

### Navigation and frame

| Item (audit) | Status | Part | Notes |
|---|---|---|---|
| Owner/manager menu Home · Needs me · Sell · Make · Buy & stock · Money (B §Navigation, #10) | done | 1 | `AREAS_BY_PERSONA`; ≤ 5 tabs + one flat More; tests `nav-per-role` |
| Needs me = To approve + Problems & alerts + Messages, badge (B #1 #2) | done | 1 | badge = approvals + unread messages |
| Set-up behind the avatar menu, reachable by search (B #10) | done | 1 | `/setup`; `/management` redirects there |
| Production plan under Make (B task 8) | done | 1 | a Make tab |
| Purchasing chip row removed; purchasing appears once (B #10, C §5) | done | 1 | `SubNav` renders nothing |
| Management hub card grid removed; "Help & my account" tab removed (B) | done | 1 | |
| Sales menu: Orders, Customers, Price offers, Invoices (C) | done | 1 | |
| Purchasing menu: Buying (What to buy, Requests, Purchase orders, Deliveries coming, Deliveries received; More: Send back) + Suppliers (C) | partly | 1 | "Delivery problems" has no list screen of its own yet (receipt problems live on the delivery); "Running low" is now **What to buy** (title and menu word). A list of delivery problems is part 3. |
| Finance: Home = Money page; Money in, Money out, Month end, Reports (C #4) | done | 1 | `homeHref(["finance"]) = /finance` |
| QA: Home, Check, Problems, Trace; no Sales or Management (C) | done | 1 | |
| Floor top bar logo, bell, avatar (+ Search); bottom bar of 4 (A #5, §4) | done | 1 | operator My jobs · Scan · Batches · Help; warehouse My jobs · Scan · Receive · Help; manager phone My jobs · Scan · To check/approve · Help |
| No duplicate doors (3 Scan, 2 Menu, 2 "?", 2 My work, chip row over titles) (A #5, B B12, C §5) | done | 1 | one ☰ (none for floor), no Menu tab, no "?" in the floor bar, no floor tab rows |
| Esc closes the drawer (B B12) | done | 1 | measured: closes for every role at 390 px |
| Menu highlight matches the page; batch record ≠ Management (B B13) | done | 1 | `activeEntry`; test |
| Old URLs keep working; permissions unchanged | done | 1 | every page still checks on the server |
| Two sub-menu dropdowns open at once (C B17) | done | 1 | no section dropdowns any more; one More |
| Second "?" in record headers (C B22) | not | — | `RecordHeader` keeps its own "?"; left for the record-template owner |

### Homes

| Item | Status | Part | Notes |
|---|---|---|---|
| Owner/manager Home starts with money and "needs you": Sales this month, Customers owe us, We owe suppliers, Needs you; zero is not red (B #4) | done | 1 | neutral cards; "Needs you" amber only above zero |
| "What to do next" = own job or names who acts; no other people's green buttons on Home (B #5, C #12) | done | 1 | "Waiting on others: Nina (QA) checks 1 finished batch"; the owner is not offered floor checks |
| Recent activity in plain words, no break glass / override / raw audit (B #14, B5) | done | 1 | `BUSINESS_EVENTS`, at most 5; test `home-round5` |
| Production pipeline off Home (B page notes) | done | 1 | link to Operations Center |
| Floor Home = My jobs: one next-job card, Waiting for you to check, Later; no number tiles (A §4, B13) | done | 1 | `TasksToday` |
| Manager/checker sees the box and weighing checks waiting for him (A #11, B13) | done | 1 | `checksWaitingForMe` (box checks exclude the person who picked) |
| Warehouse Home: one green next step (A task 3) | done | 1 | put away first, else the first send-out line; other lines outlined |
| Sales Home: next step, New customer order, New price offer, sales today and this month (C) | done | 1 | "Values hidden" stays for roles without money view |
| Purchasing Home starts with what to buy (C #5) | partly | 1 | "N items are running low" from reorder suggestions; shortage-by-order logic is part 3 |
| QA Home: green button = oldest item to check (C) | done | 1 | oldest of finished batches and delivered lots |
| Page intros on floor Homes removed (A #15) | done | 1 | Home only; other floor screens part 2 |
| "Done! Next: QA checks it" banner after Finish (A §4) | not | 2 | Finish screen |

### Search

| Item | Status | Part | Notes |
|---|---|---|---|
| Labelled Search box from 768 px right after the menu; no lone magnifier (B #1) | done | 1 | measured gap 12 px at every width ≥ 1280 |
| Phones: labelled "Search" button; first line "Scan a label" (B #1) | done | 1 | full-screen dialog with Close |
| Top-bar icons with words where they fit (B, C §5) | done | 1 | To approve / Messages words from 768 px with one site; with the site selector icons + tooltips; Help word from 1024 px |
| Sync cloud only when something waits (B #1, A task 4) | done | 1 | `SyncChip` returns nothing when all saved |
| People by name ("Dino") (B task 7) | done | 1 | site-scoped; negative cross-site test |
| Questions and actions ("who owes", "this month's sales", "new customer") (B task 6, C #15) | done | 1 | `SEARCH_QUESTIONS`, `SEARCH_ACTIONS` |
| Short numbers ("4", "SO 4", "order 4", "0003") (C #15, A B14) | done | 1 | "ends with" match; set-asides, stock changes, documents left out of short results |
| Enter opens exact number, else the highlighted row, never an unrelated first hit (A B14) | done | 1 | measured: "0003" + Enter stays with "choose one" for all 9 roles |
| Floor search limited to batches, lots, boxes, shelves, orders (A #15) | partly | 1 | noise types out of short-number results for everyone; full role filter not done |
| Addresses ("pasig") (C #15) | not | — | customer addresses are not searched |
| `ui.wide_screen_top_bar` = scan still works (ADR-126) | done | 1 | Scan button in the Search box's place at every width |

### Messages

| Item | Status | Part | Notes |
|---|---|---|---|
| Messages clear when the work is done or no longer theirs (A #6 B10, B #9 B9, C #6 B10) | done | 1 | `notification-done.ts`, 33 message kinds; integration test `messages-clear` |
| Put-away to the warehouse, not the operator/owner/manager (A B10, C B15) | done | 1 | `usersForJob`, `HandoffRule.only`; "Waiting for … to put it away" names the warehouse |
| Box check, pick, send-out messages to the warehouse (and manager for box checks), not the operator (A #6) | done | 1 | `only` on pick, dispatch, pack_check, delivery_coming |
| "they will see it on Packing" → "on their Home" (A #11) | done | 1 | `pack_check.where` |
| Floor: tap = read, no "Mark read / I'm on it" (A #6) | done | 1 | |
| Group many messages ("12 lots are ready…") (A #6) | not | — | not done; the auto-clear removes most of the pile |
| Message wording with names and places instead of codes (B #9) | not | — | message titles unchanged |

### Owned by parts 2 and 3 (not in part 1)

A: #1–#4, #7–#10, #12–#14, bugs B1–B9, B11–B12, B15–B19 (part 2). B: #2, #3, #6, #7, #8, #11, #12, #13, #15, bugs B1–B4, B6–B8, B10, B11, B14–B17 (parts 2/3). C: #1–#3, #5, #7–#11, #13, #14, bugs B1–B9, B11–B14, B16, B18–B21, B23 (part 3, some QA screens).

## 2. Measurements (part 1, production build, full demo)

- `tests/e2e/top-bar-fit.cjs` (updated: menu row "Menu", labelled Search right after it, bar ends inside the window):
  roles owner, manager.nfd, finance, sales, procurement, qa.nfd, warehouse.rvs, warehouse.nfd, operator.nfd at 1280,
  1366, 1440, 1536 and 1920 px, every area. Result in the hand-off report (ADR-129).
- Walk at 390, 820, 1366, 1440 px for owner, manager, operator, checker, warehouse, sales, purchasing, finance, QA:
  no sideways scroll; no frame target under 44 px; exactly one menu button on phones for office roles and none for
  floor roles; Esc closes the drawer; "0003" + Enter never opens a record.
