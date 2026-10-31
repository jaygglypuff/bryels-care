# Page-by-page review (grade-5 standard, ADR-088)

Every screen is checked against the standard below. Status: ☐ not yet · ◐ in progress · ☑ done (date).

## The standard

1. One sentence under the title: what this screen is for (`PageIntro`).
2. Forms: at most 5 fields visible; everything else has a default and sits under "More details" (`MoreDetails`).
3. Never type a code: the system makes every code (editable only under More details).
4. One green button for the next step (`NextStep` on records); secondary actions in "⋯ More".
5. Grade-5 words (glossary in `docs/USABILITY_TEST.md` and `docs/CONSULTANT_REVIEW.md` §5); "What is this?" (`Explain`) for the six kept words.
6. Works on a phone (390 px): no sideways scroll, nothing covered, buttons ≥ 44 px.
7. Empty, loading and error states say what to do and who to ask.

Total screens: 250.

## Home (10)

| Screen | Status | Notes |
|---|---|---|
| `/account` | ☑ 2026-10-31 | Intro; “needs the owner's OK” wording; password, phone code and sign-ins unchanged. |
| `/action-centre` | ☑ 2026-10-31 | “Problems & alerts”: plain tabs (To decide, Problems, Alerts for you, Phone changes to check), 44 px tabs, title first/number grey, “I'm on it”; message rules in ⋯ More. |
| `/approvals` | ☑ 2026-10-31 | Next step opens the oldest decision; title first, number grey; Problems & alerts in ⋯ More; owner banner in plain words. |
| `/dashboard/details/batches` | ☑ 2026-10-31 | Intro (“Done” = QA OK); back to Home. |
| `/dashboard/details/stock` | ☑ 2026-10-31 | “Stock to look at”: running low / use first / stopped by QA. |
| `/dashboard` | ☑ 2026-10-31 | Per-role intro sentence (owner, site manager, QA, sales, finance, operator, warehouse); ADR-081/082/083/086 layout and attentionItems kept; plain words (stopped by QA, QA check, See every step, Full history of changes); link to Reports. |
| `/notifications` | ☑ 2026-10-31 | Intro; “I'm on it” instead of Acknowledge. |
| `/sync/conflicts/[id]` | ☑ 2026-10-31 | “Phone change to check”: next step to the choice, on the phone / in the system now. |
| `/sync/conflicts` | ☑ 2026-10-31 | “Phone changes to check”, intro. |
| `/sync` | ☑ 2026-10-31 | “Working without signal”, intro. |

## Settings & people (29)

| Screen | Status | Notes |
|---|---|---|
| `/admin/approval-rules` | ☑ 2026-10-31 | “Who says OK to what”: 5 visible fields (what, when, more than, who, why) + password; rest folded; plain record types and roles. |
| `/admin/audit` | ☑ 2026-10-31 | “History of changes”: area + record number search, sentences; technical name and before/after folded. |
| `/admin/demo` | ☑ 2026-10-31 | Intro (demo only, real data never touched). |
| `/admin/devices` | ☑ 2026-10-31 | “Phones and tablets”; 44 px filter chips. |
| `/admin/diagnostics` | ☑ 2026-10-31 | “Health of the system” (IT only); tables scroll inside their card. |
| `/admin/imports/[id]` | ☑ 2026-10-31 | Next step by status; columns preview folded; rows as a list (phone); “Save … rows for good”; permission names folded. |
| `/admin/imports/legacy-documents` | ☑ 2026-10-31 | “Old paper documents”: one card per scan, product first. |
| `/admin/imports` | ☑ 2026-10-31 | “Load data from a spreadsheet”: saved matching picked from a list (no typed code); files as list; templates as 44 px buttons; legacy docs in ⋯ More. |
| `/admin/notification-rules` | ☑ 2026-10-31 | “Who gets which message”: 4 visible fields; site, name, severity, email folded; Add a rule folded. |
| `/admin/numbering` | ☑ 2026-10-31 | “How record numbers look”: list with example; change form 4 fields; pattern/digits folded; waiting changes shown with OK. |
| `/admin` | ☑ 2026-10-31 | Redirects to People (/admin/users). |
| `/admin/retention` | ☑ 2026-10-31 | “Keeping and deleting old records”, plain card titles; tables scroll in card. |
| `/admin/roles/[id]/clone` | ☑ 2026-10-31 | “New job, copied from …”: name only; technical code made from the name (folded). |
| `/admin/roles/[id]` | ☑ 2026-10-31 | Plain role name; “What this job may do” as sentences per area; permission strings folded as technical names; stop/delete in ⋯ More. |
| `/admin/roles` | ☑ 2026-10-31 | Jobs as a list (Owner, Site manager, Machine operator…); permission matrix folded. |
| `/admin/security` | ☑ 2026-10-31 | “Sign-in safety”; assumption ids and permission names removed from view. |
| `/admin/sessions` | ☑ 2026-10-31 | “Who is signed in”; Can approve / Extra code checked chips. |
| `/admin/settings` | ☑ 2026-10-31 | One group at a time (chips), label + one sentence + “Now:”; key and assumption under Technical name; “Needs the owner's OK”; history folded; next step for waiting changes. |
| `/admin/templates/[id]` | ☑ 2026-10-31 | Layout name first, versions with plain status; next step for QA; JSON folded for IT. |
| `/admin/templates/labels/[id]` | ☑ 2026-10-31 | Label name first; next step (QA OK); printer details folded; stop in ⋯. |
| `/admin/templates/labels/new` | ☑ 2026-10-31 | Name (code made from it), for, size, printed fields; layout/barcode/copies/dpi folded. |
| `/admin/templates/new` | ☑ 2026-10-31 | What it is for + name; code made from the name. |
| `/admin/templates` | ☑ 2026-10-31 | “Labels and printouts”: labels and layouts as lists; printers and recent printouts folded; new layout/printers in ⋯ More. |
| `/admin/templates/stations` | ☑ 2026-10-31 | “Label printers”: name + printer name; code made from the name; in-use/notes folded. |
| `/admin/users/[id]` | ☑ 2026-10-31 | Next step (give a job / waiting for sign-in / unlock); plain role names; account actions in ⋯ More; permission strings folded. |
| `/admin/users/invite` | ☑ 2026-10-31 | “Add a person”: 4 fields; warehouse limit folded; plain job names. |
| `/admin/users` | ☑ 2026-10-31 | “People who use the app”: plain statuses and job names; roles/CSV in ⋯ More. |
| `/documents/[id]` | ☑ 2026-10-31 | Kind + number title; plain banners (cancelled, replaced). |
| `/management` | ☑ 2026-10-31 | Plain section texts; 44 px links. |

## Reports (12)

| Screen | Status | Notes |
|---|---|---|
| `/analytics/[area]` | ☑ 2026-10-31 | Plain titles (Making products, Stock numbers, Quality numbers, Sales numbers), intro, plain chart/list titles, no KPI codes. |
| `/analytics/definitions` | ☑ 2026-10-31 | “What each number means”; codes only as technical name. |
| `/analytics/kpi/[code]` | ☑ 2026-10-31 | Plain title, no code in subtitle; calculation folded. |
| `/analytics/overview` | ☑ 2026-10-31 | Intro; plain card titles (PLAIN_KPI); no codes in chart subtitles. |
| `/analytics` | ☑ 2026-10-31 | Reports landing: three tiles (sales 4 weeks, batches done, stock to look at), one weekly chart, What sells best (new read model getTopProducts), more reports in plain words. |
| `/analytics/trends` | ☑ 2026-10-31 | “Compare over time”: plain number names, 44 px checkboxes. |
| `/reports/[code]` | ☑ 2026-10-31 | Plain title; site + dates visible, other filters folded; Print green, Excel/CSV/email in ⋯ More; rows as cards on phones; definitions folded. |
| `/reports` | ☑ 2026-10-31 | “Lists to download or print”: plain names per area as list; planned lists folded. |
| `/reports/runs/[runId]` | ☑ 2026-10-31 | “Download” the emailed file; plain status. |
| `/reports/schedules/[id]` | ☑ 2026-10-31 | Plain summary; history as list; stop/start in ⋯ More. |
| `/reports/schedules/new` | ☑ 2026-10-31 | 4 visible fields (how often, day, time, who); name/sites/file type/filters folded. |
| `/reports/schedules` | ☑ 2026-10-31 | “Lists sent by email” as list. |

## Finance (19)

| Screen | Status | Notes |
|---|---|---|
| `/finance/bills/[id]` | ☑ 2026-10-31 | Supplier first; next step by state (check against order and delivery, approve, save to the books, pay); match results in words; cancel / cancel (kept on record) in ⋯ More; password kept. |
| `/finance/bills/new` | ☑ 2026-10-31 | Supplier, delivery, their bill number (from their paper), date, prices; kind and note folded; our number automatic. |
| `/finance/bills` | ☑ 2026-10-31 | "Supplier bills" (money we owe): supplier first, ₱ right, plain status chips; "does not match" next step. |
| `/finance/credit-notes/[id]` | ☑ 2026-10-31 | "Credit (money back)": next step by state; save to the books with password; cancels in ⋯ More. |
| `/finance/credit-notes/new` | ☑ 2026-10-31 | 3 visible fields (why, explain, how much); customer return and whole-invoice credit folded. |
| `/finance/credit-notes` | ☑ 2026-10-31 | "Credits (money back)": customer first, amount right; empty state says start from the invoice. |
| `/finance/expenses/[id]` | ☑ 2026-10-31 | Person first; next step (add receipt, send, decide, save to the books, pay back); take back / cancel in ⋯ More. |
| `/finance/expenses/new` | ☑ 2026-10-31 | "Claim money I spent": 4 fields (what for, how much, when = today, kind); site folded (default current). |
| `/finance/expenses` | ☑ 2026-10-31 | Person first, ₱ right, plain claim states; next step for approvers. |
| `/finance/invoices/[id]` | ☑ 2026-10-31 | Customer first; next step by state (send, approve, save to the books, record payment); items as rows; credit, print, cancels in ⋯ More; password kept. |
| `/finance/invoices` | ☑ 2026-10-31 | Customer first, ₱ right; deliveries without an invoice folded after 3; plain states (sent – not paid yet, late). |
| `/finance` | ☑ 2026-10-31 | "Money": money customers owe us / money we owe, "how late" buckets, next step, money screens with plain names. |
| `/finance/payments/[id]` | ☑ 2026-10-31 | Name first, money in/out; what it pays; save to the books with password; cancels in ⋯ More. |
| `/finance/payments/new` | ☑ 2026-10-31 | 4 visible fields (who, how much, when = today, how) + which invoices (oldest first); references, withheld, note folded. |
| `/finance/payments` | ☑ 2026-10-31 | Name first with in/out arrow, ₱ right, "kept for later" amount. |
| `/finance/periods` | ☑ 2026-10-31 | "Close the month": month names, next step (close last month / decide reopen), older months folded; password and open-papers check kept. |
| `/finance/statements/[customerId]` | ☑ 2026-10-31 | "They owe us" big, how-late buckets, unpaid invoices as rows, print as next step; other day in ⋯ More. |
| `/finance/statements` | ☑ 2026-10-31 | Customer search, name first, amount owed right (largest first). |
| `/finance/tax` | ☑ 2026-10-31 | "Tax rates": rows in words; add-rate form 4 fields + password; code picked or made from the name (never typed); second-person check kept. |

## Home & help (1)

| Screen | Status | Notes |
|---|---|---|
| `/help` | ☑ 2026-10-31 | Five role guides “Your day in 5 steps” (own role first), Words we use, task guides folded (/help#key opens them). |

## Inventory & warehouse (38)

| Screen | Status | Notes |
|---|---|---|
| `/inventory/[lotId]/move` | ☑ 2026-10-31 | “Move <item>”: 4 fields (from shelf, to shelf, how much, why), shelves by name, only allowed places; “Move it”. |
| `/inventory/[lotId]` | ☑ 2026-10-31 | Item name title, lot number grey + plain status chip; next step by state (move / waiting for QA / do not use); 8 secondary actions in ⋯ More; history as stock-change rows; details folded. |
| `/inventory/adjustments/[id]` | ☑ 2026-10-31 | “Fix stock: <item>”; next step or “Waiting for a site manager (not the person who made it)” / owner second OK (ADR-091 kept); cancel/delete in ⋯ More; lines as rows with Add/Take away. |
| `/inventory/adjustments/new` | ☑ 2026-10-31 | Intro; lot by scan or item name (keywordMatches); cost per unit folded. |
| `/inventory/adjustments` | ☑ 2026-10-31 | Item names first, reason in words, number grey; state tabs; banner for approvers. |
| `/inventory/availability` | ☑ 2026-10-31 | “Can we deliver?”: one row per item, free amount right (friendly units), tap for lots per shelf; date and the sum folded; exports in ⋯ More. |
| `/inventory/containers/[id]` | ☑ 2026-10-31 | Contents name as title, box number grey, plain box state; next step (print label / close / move); split/merge/repack in ⋯ More; merge/repack pick boxes on the same shelf (no typed box numbers). |
| `/inventory/containers/new` | ☑ 2026-10-31 | “Pack into a box or sack”: what (by name), shelf (only if more than one), how much; kind/part box/notes folded. |
| `/inventory/containers` | ☑ 2026-10-31 | “Boxes and sacks”: what is inside first, shelf by name, state tabs (Closed, Open, On the way…). |
| `/inventory/counts/[id]` | ☑ 2026-10-31 | Shelves as title; next step by state (start / count / waiting for manager / save); shelf-by-shelf count kept; tap expected lot or scan or find by name; differences as cards (no wide table); cancel in ⋯ More; freeze banner kept. |
| `/inventory/counts/[id]/sheet` | ☑ 2026-10-31 | Intro (screen only); item first; print header no longer hidden by the print rule. |
| `/inventory/counts` | ☑ 2026-10-31 | Open and finished counts as rows (shelves first, number grey); plan form: shelves + counters, rest folded. |
| `/inventory/items/[kind]/[id]` | ☑ 2026-10-31 | Intro; one main button, others in ⋯ More; six numbers and lists from ADR-090 kept. |
| `/inventory/locations/[id]` | ☑ 2026-10-31 | Shelf name title, code grey; next step “Move stock here” or count banner; lots as rows with amounts. |
| `/inventory/locations` | ☑ 2026-10-31 | “Shelves”: name first, code grey, part-of-warehouse tabs, “Being counted · no moves” chip. |
| `/inventory/lots/[lotId]/edit` | ☑ 2026-10-31 | “Fix details”: expiry + supplier code + why; made-on/brand folded. |
| `/inventory/lots/expiry` | ☑ 2026-10-31 | “Expiring soon”: groups as rows, item first, days left, amount right; empty state says nothing to do. |
| `/inventory/lots` | ☑ 2026-10-31 | Redirect to /inventory (kept). |
| `/inventory/lots/reservations` | ☑ 2026-10-31 | “Which one to use first / set aside”: items by name, FEFO rule hidden (“Use this first”), reasons in words; set-aside rows with “Let it go”; hours folded. |
| `/inventory/move` | ☑ 2026-10-31 | Intro; scan or type the item name (matches to tap); shelves by name; recent moves as rows. |
| `/inventory/movements/[id]` | ☑ 2026-10-31 | “Moved: <item>”; next step; undo (kept on record) with reason + typed REVERSE kept at the bottom; details folded; undo rows as list. |
| `/inventory/movements` | ☑ 2026-10-31 | “Stock changes”: PlainList rows (item, type chip with icon, shelves in words, who, when; amount right); plain filter chips. 390 px: everything visible. |
| `/inventory` | ☑ 2026-10-31 | Intro; “Receive a delivery”; other stock screens in ⋯ More; ADR-090 list kept. |
| `/inventory/receipts` | ☑ 2026-10-31 | “Deliveries received”: supplier first, plain state chips, problem chips; tabs; export and problem filter in ⋯ More. |
| `/inventory/receive/[grId]/edit` | ☑ 2026-10-31 | Intro; plain words (saved delivery is never changed; undo it). |
| `/inventory/receive/[grId]` | ☑ 2026-10-31 | “Delivery received”; item name first then lot; “Something wrong with this item?”; undo/cancel and links in ⋯ More. |
| `/inventory/receive` | ☑ 2026-10-31 | Intro; receipts/put-away/help in ⋯ More; items and shelves by name. |
| `/inventory/receive/put-away` | ☑ 2026-10-31 | Intro; find by scan or item name; item name title; plain QA words. |
| `/inventory/scan` | ☑ 2026-10-31 | Intro (find anything by scan or words). |
| `/inventory/stock-card/[lotId]` | ☑ 2026-10-31 | “History: <item>”: one list for phone and desktop (+/− amount, left after), start/end amounts, check kept; print/exports in ⋯ More. |
| `/inventory/wip` | ☑ 2026-10-31 | “Being made”: product first, steps done, batch number grey. |
| `/labels/jobs/[jobId]` | ☑ 2026-10-31 | “Label: <item>”; next step by state; reprint with reason kept; cancel/did not print/old label in ⋯ More. |
| `/labels/new` | ☑ 2026-10-31 | “Print a label: <item>”; 3 fields; already printed → next step to reprint with reason. |
| `/labels` | ☑ 2026-10-31 | “Labels to print”: what the label is for first, one Print button, cancel/did not print in ⋯ More; status chips with icons. |
| `/warehouse/packs/[packId]` | ☑ 2026-10-31 | “Boxing: <product>”; next step (pack a box / check / waiting for a checker ≠ packer); cancel and boxing note in ⋯ More. |
| `/warehouse/packs` | ☑ 2026-10-31 | Product first, plain states, number grey; repack in ⋯ More. |
| `/warehouse` | ☑ 2026-10-31 | Intro; “Scan a label”; parts of the warehouse tiles kept. |
| `/warehouse/repack` | ☑ 2026-10-31 | Scan boxes, customer by name, why; units per box folded. |

## Maintenance (8)

| Screen | Status | Notes |
|---|---|---|
| `/maintenance` | ☑ 2026-10-31 | Intro; next step = late maintenance or open repair job; plain KPIs; name-first lists; secondary links in ⋯ More. |
| `/maintenance/plans/[planId]` | ☑ 2026-10-31 | "Machine: what to do" title, number small; next step = make the job; pause/stop in ⋯ More; edit folded. |
| `/maintenance/plans/new` | ☑ 2026-10-31 | "Plan new regular maintenance": 5 fields (machine, what, every N days default 30, who, steps); rest under More details. |
| `/maintenance/plans` | ☑ 2026-10-31 | "Regular maintenance"; name-first list with due chips (Late/Due soon); 44 px filter tabs. |
| `/maintenance/spare-parts` | ☑ 2026-10-31 | Name-first list, "running low" + next step to reorder; add form folded, 2 visible fields, site hidden when one. |
| `/maintenance/work-orders/[workOrderId]` | ☑ 2026-10-31 | "Repair job": next step Start / The job is done / waiting for technician (+ who can help); pause/cancel in ⋯ More. |
| `/maintenance/work-orders/new` | ☑ 2026-10-31 | "Report a broken machine": 5 fields (machine, what is wrong, urgency, technician, broken now); rest folded. |
| `/maintenance/work-orders` | ☑ 2026-10-31 | "Repair jobs"; machine + problem first, number grey; status/urgency chips with icons. |

## Setup (master data, recipes) (38)

| Screen | Status | Notes |
|---|---|---|
| `/masterdata/equipment/[id]` | ☑ | name first, code grey, plain kind words, PageIntro (2026-10-31) |
| `/masterdata/equipment/new` | ☑ | 3 visible fields (name, kind, making area); EQP- number; dates and rules under More details |
| `/masterdata/equipment` | ☑ | name first, plain kinds, 'Can it be used?', empty state with button |
| `/masterdata/formulas/[id]` | ☑ 2026-10-31 | “Recipe for <product>”, code grey; versions as a list (use from, OK by); next step opens the open version or “Make a new version (step by step)”; start-here in ⋯ More. |
| `/masterdata/formulas/[id]/revisions/[revisionId]` | ☑ 2026-10-31 | Next step by status (Send for approval / Waiting for <name> (QA) / Make a new version (step by step)); batch weight, expected amount made, allowed difference, use from; gram total without packaging, “Packaging per batch” apart; approval panel kept. |
| `/masterdata/formulas/new` | ☑ 2026-10-31 | Points to New recipe (step by step) first; 3 visible fields (product, batch weight, expected amount made); name, reason and code folded (F- number). |
| `/masterdata/formulas` | ☑ 2026-10-31 | “Recipes (advanced)”: intro + green New recipe (step by step); product name first, code grey (PlainList); advanced new and example in ⋯ More. |
| `/masterdata/inspection-plans/[id]` | ☑ | "Quality checks" wording, name first, version Explain; test codes optional (made from names), extras under More details |
| `/masterdata/inspection-plans/new` | ☑ | 2 visible fields (which item, when); name and QCP- number by the system |
| `/masterdata/inspection-plans` | ☑ | renamed Quality checks, name first, empty state with button |
| `/masterdata/lines/[id]` | ☑ | Making area / line; name + team visible; code and notes under More details |
| `/masterdata/lines` | ☑ | Making areas; add = name (+ team, site only if >1); LINE- number |
| `/masterdata/lists` | ☑ | renamed Choice lists, PageIntro (codes were already automatic) |
| `/masterdata/locations/[id]` | ☑ | name first; name, type, inside visible; code/section/pickable under More details |
| `/masterdata/locations` | ☑ | name first, code grey; add = name, type, inside (warehouse only if >1); LOC- number |
| `/masterdata/materials/[id]` | ☑ | name first, See stock button, same 3-question form; status changes folded |
| `/masterdata/materials/new` | ☑ | 3 questions (name, kind buttons, buy/count buttons) + usual supplier and pack; rest under More details with defaults by kind |
| `/masterdata/materials` | ☑ | name first, kind, unit, stock links to /inventory/items/material/<id>; extra filters folded |
| `/masterdata/products/[id]` | ☑ 2026-10-31 | Name first; green “Open the recipe” / “Make a recipe (step by step)”; “How it is sold” (sellable items, What is this?) as a list; 5-field form, storage and code folded; stop/delete in ⋯ More. |
| `/masterdata/products/[id]/skus/[skuId]` | ☑ 2026-10-31 | “Sellable item” (pack size) with What is this?; 4 visible fields; barcode, boxes, stock unit, code folded (product code or SKU- number); next step: make it ready to sell. |
| `/masterdata/products` | ☑ 2026-10-31 | Name first, size, good for N months, ways to sell, stock (PlainList); green Make a recipe (step by step); add form = 5 questions, PRD- number, months. |
| `/masterdata/reason-codes/[id]` | ☑ | renamed Reasons; words + where offered + note; code read-only under More details |
| `/masterdata/reason-codes` | ☑ | renamed Reasons; add = words + where; code made from the words |
| `/masterdata/routings/[id]` | ☑ 2026-10-31 | “Steps for <product>”; versions as a list; next step opens the open version or the step-by-step recipe; start-here in ⋯ More. |
| `/masterdata/routings/[id]/revisions/[revisionId]` | ☑ 2026-10-31 | Next step by status (Send for approval / Waiting for <name> / Make a new version (step by step)); plain step kinds and areas; how-to sheet by name; 44 px move buttons; approval panel kept. |
| `/masterdata/routings/new` | ☑ 2026-10-31 | Points to New recipe (step by step) first; 1 visible field (product); name “Steps for …” and R- number by the system. |
| `/masterdata/routings` | ☑ 2026-10-31 | “Steps (advanced)”: intro + green New recipe (step by step); product first, code grey; how-to sheets, advanced new and example in ⋯ More. |
| `/masterdata/sites/[id]` | ☑ | name first; name, address, city visible; code/time zone under More details; teams by name only (DEP-) |
| `/masterdata/sites` | ☑ | add = name (+ address, city); site code made from the name's initials |
| `/masterdata/suppliers/[id]` | ☑ | name first, plain labels (pay within, order to delivery, QA status), materials by name |
| `/masterdata/suppliers/new` | ☑ | 4 visible fields (name, contact, phone, email); SUP- number; rest under More details |
| `/masterdata/suppliers` | ☑ | name first, code grey, plain columns, empty state says what to do |
| `/masterdata/uom` | ☑ | renamed Units; add = name + what it measures; short name made from the name |
| `/masterdata/warehouses/[id]` | ☑ | name first, special places by name, code under More details |
| `/masterdata/warehouses` | ☑ | add = name + what is kept (site only if >1); WH- number |
| `/masterdata/work-instructions/[id]` | ☑ 2026-10-31 | “How-to sheet”, name first; next step (send for an OK / waiting for <name> / start a new version); older versions folded. |
| `/masterdata/work-instructions/new` | ☑ 2026-10-31 | 2 visible fields (name, text); WI- number, own code folded. |
| `/masterdata/work-instructions` | ☑ 2026-10-31 | “How-to sheets”: name first, code grey, plain version status; empty state with button. |

## Operations (2)

| Screen | Status | Notes |
|---|---|---|
| `/operations` | ☑ 2026-10-31 | Intro; From delivery to dispatch; product first on phone cards; 44 px site switch. |
| `/floor` | ☑ 2026-10-31 | TV header says what it is for (vw sizes; a TV, not a phone screen). |

## Purchasing (17)

| Screen | Status | Notes |
|---|---|---|
| `/procurement/expected/[poId]` | ☑ 2026-10-31 | Redirect only (to Receive with the order filled in); no screen of its own. |
| `/procurement/expected` | ☑ 2026-10-31 | "Deliveries coming": supplier first, due date right, row opens Receive; late next step. |
| `/procurement/forecast` | ☑ 2026-10-31 | "Sales guess": product first, guess in words, quality folded; change-a-guess form 4 fields, site folded; second-person approval kept. |
| `/procurement/orders/[id]` | ☑ 2026-10-31 | Supplier first; next step by state (send for approval, approve, send to supplier, receive); items as rows with ₱; print, supplier answer, close, cancel in ⋯ More. |
| `/procurement/orders/new` | ☑ 2026-10-31 | 4-step wizard: supplier by name with search → items (friendly units, pack/price shown) → arrival date (lead-time default) → check and send; extras folded; number automatic. |
| `/procurement/orders` | ☑ 2026-10-31 | Supplier first, ₱ right, plain states; search; download in ⋯ More. |
| `/procurement` | ☑ 2026-10-31 | "Purchasing": next step, plain tiles, late deliveries as rows. |
| `/procurement/performance` | ☑ 2026-10-31 | "How suppliers do": one row per supplier, plain measures; "no data yet" never 0 %. |
| `/procurement/reorder` | ☑ 2026-10-31 | "Running low": buy-about sentence per item, friendly-unit amount, hide with reason; minimums form folded (friendly units); check again in ⋯ More. |
| `/procurement/requests/[id]` | ☑ 2026-10-31 | "Request to buy": items as title; next step (send, decide, make purchase order); cancel in ⋯ More. |
| `/procurement/requests/new` | ☑ 2026-10-31 | "Ask to buy something": item by name, how much (friendly units), needed by (+7 days), why; supplier/price folded. |
| `/procurement/requests` | ☑ 2026-10-31 | "Requests to buy": items first, who asked, estimate right. |
| `/procurement/returns/[id]` | ☑ 2026-10-31 | "Return to supplier": next step (add lots, approve, goods left); add a lot with 2 fields; cancel in ⋯ More. |
| `/procurement/returns/new` | ☑ 2026-10-31 | Supplier by name with search; why + explain; delivery and their return number folded. |
| `/procurement/returns` | ☑ 2026-10-31 | "Send back to supplier": supplier first, money back right. |
| `/procurement/suppliers/[id]` | ☑ 2026-10-31 | Supplier with plain status; items with QA yes/no; price/minimum/days form 5 visible fields; "order from this supplier" next step. |
| `/procurement/suppliers` | ☑ 2026-10-31 | "Suppliers we may buy from": waiting for QA as rows, search, plain supplier status. |

## Production (23)

| Screen | Status | Notes |
|---|---|---|
| `/production/[batchId]/closure` | ☑ 2026-10-31 | Intro; check names in plain words (QA decision, problem reports, pieces made, batch record); button "Close the batch and make the final batch record". |
| `/production/[batchId]/finish` | ☑ 2026-10-31 | Intro; rejects folded under "Any rejects?" (good pieces, samples, left-over wrappers visible); wrappers reconcile; "Open this batch's labels" (ADR-088 §3). |
| `/production/[batchId]` | ☑ 2026-10-31 | Batch record (read-only, one path 2026-10-31): steps with who did/checked, readings, equipment, weighings, packaging, output, quality, timeline; NextStep "Continue this batch → <screen>" when the viewer can act; no step/packaging/yield/transfer forms (only legacy yield/reject approvals). Closure link only for approvers. |
| `/production/board` | ☑ 2026-10-31 | Board: product name first, number grey; status words are the production-order words (Draft, Approved, In progress, Quality check, Done); move labels "Get ready for approval", "Approve and set materials aside"; cards open "continue". Phone height still long (open). |
| `/production/defects` | ☑ 2026-10-31 | Rejects: intro; subtitle shortened. |
| `/production/new` | ☑ 2026-10-31 | Superseded: server redirect to /production/orders/new (one path 2026-10-31). |
| `/production/orders/[workOrderId]/materials` | ☑ 2026-10-31 | Get materials: title and intro; wrappers/labels listed; "no wrappers on this list" note when the product has no packaging per piece; also serves batches without an order (`without-order`). |
| `/production/orders/[workOrderId]` | ☑ 2026-10-31 | Order hub: one green button (per-batch buttons and "Save to daily log" secondary); Batches tab opens "Continue this batch" or the batch record; progress strip labels no longer break on a phone. |
| `/production/orders/[workOrderId]/step/[n]` | ☑ 2026-10-31 | Step card (one path 2026-10-31): plain title/instruction (exact setup words folded); "Not yet" shows no form; own-phone check (Yes, I checked it / send it back); equipment choice; extra fields under More details; packaging: taken lot or tap-to-choose cards + Scan with camera; label preview; print only from the packaging step. |
| `/production/orders/[workOrderId]/weigh` | ☑ 2026-10-31 | Weigh: lot label scanned with the camera (last 4 only for a damaged label); own-phone weighing check; "Other ways to weigh" link per ingredient; wrappers never on this screen. |
| `/production/orders/new` | ☑ 2026-10-31 | New production order: intro; 3 fields + product, the rest under More details; system numbers the order. |
| `/production/orders` | ☑ 2026-10-31 | Orders / My work: intro per role. |
| `/production` | ☑ 2026-10-31 | Batch records (read-only list, one path 2026-10-31); no "New batch"; points to Production orders. |
| `/production/plan/[planId]` | ☑ 2026-10-31 | Plan: intro; "work order" → "production order". |
| `/production/plan` | ☑ 2026-10-31 | Plan list: intro; words. |
| `/production/staging/[batchId]` | ☑ 2026-10-31 | "Lots and sheets": set-aside lots, QA substitution, printed sheets; NextStep Get materials / Continue; no scan-to-stage (one path 2026-10-31). |
| `/production/staging` | ☑ 2026-10-31 | Superseded: server redirect to /production/orders. |
| `/production/orders/[workOrderId]/weigh/more` | ☑ 2026-10-31 | "Other ways to weigh" one ingredient: container weight, second lot, out-of-range approval (CX-TOL), undo with reason, own-session check (from the old workspace). |
| `/production/orders/[workOrderId]/continue` | ☑ 2026-10-31 | No screen: server redirect to the batch's next flow screen (board, scan, bookmarks). |
| `/production/today` | ☑ 2026-10-31 | Today's count: intro; subtitle shortened. |
| `/production/work-orders/[workOrderId]` | ☑ 2026-10-31 | Advanced full order record (plan batch, top-up, dispensing sheet); batch links use "continue" to the flow screens. |
| `/production/work-orders/new` | ☑ 2026-10-31 | Superseded: server redirect to /production/orders/new. |
| `/production/work-orders` | ☑ 2026-10-31 | Superseded: server redirect to /production/orders. |

## Quality (30)

| Screen | Status | Notes |
|---|---|---|
| `/quality/batches/[batchId]` | ☑ 2026-10-31 | Product first; next step (start tests / decide); weighing, tests, history as phone lists; OK to use / Not OK; OK with conditions folded. |
| `/quality/bulk` | ☑ 2026-10-31 | "Decide many lots at once": filter folded, name-first tick list, note folded, password kept. |
| `/quality/capa/[capaId]` | ☑ 2026-10-31 | "Fix-and-prevent plan": next step by state; things to do (fix now / prevent) with who and date; cancel in ⋯ More. |
| `/quality/capa/new` | ☑ 2026-10-31 | 4 visible fields (short name, problem, who looks after it = me, finish by); source/site folded, no code. |
| `/quality/capa` | ☑ 2026-10-31 | "Fix-and-prevent plans"; title first, number grey; download in ⋯ More. |
| `/quality/changes/[changeId]` | ☑ 2026-10-31 | "Change request": next step by state (write effects, send, decide, make, confirm); cancel in ⋯ More. |
| `/quality/changes/new` | ☑ 2026-10-31 | 4 visible fields (short name, what changes, what, why); version link, site, date folded. |
| `/quality/changes` | ☑ 2026-10-31 | "Change requests"; title first; plain status chips with icons. |
| `/quality/check/[batchId]` | ☑ 2026-10-31 | Product first; next step; OK to use / Not yet / Not OK – don't use; note folded; maker/tester rules kept. |
| `/quality/check` | ☑ 2026-10-31 | "Batches waiting for QA check"; next step to the oldest; batch number grey. |
| `/quality/complaints/[complaintId]` | ☑ 2026-10-31 | "Complaint from <customer>": next step by state; trace, letter, plan, return in ⋯ More. |
| `/quality/complaints/new` | ☑ 2026-10-31 | 5 visible fields (customer, kind, product, label number optional, what they say); rest folded. |
| `/quality/complaints` | ☑ 2026-10-31 | Customer + problem first; plain status ("New – QA to look", "Answered – to close"). |
| `/quality/deviations/[deviationId]` | ☑ 2026-10-31 | "Problem report": next step (start looking / close); stop a lot folded; plan in ⋯ More. |
| `/quality/deviations/new` | ☑ 2026-10-31 | "Report a problem": 2 fields (step, what happened). |
| `/quality/deviations` | ☑ 2026-10-31 | "Problem reports"; what happened first; download in ⋯ More. |
| `/quality/holds/[holdId]` | ☑ 2026-10-31 | "Stopped by QA: <item>": next step let go / not OK (second QA person); lots as list. |
| `/quality/holds/issue` | ☑ 2026-10-31 | "Take out stopped stock": lot picked by name (scan folded); exception banner kept. |
| `/quality/holds/new` | ☑ 2026-10-31 | "Stop a lot": lot picked by name (scan folded), 4 fields. |
| `/quality/holds` | ☑ 2026-10-31 | "Stopped by QA" list; exception screen in ⋯ More. |
| `/quality/inspections/[inspectionId]` | ☑ 2026-10-31 | "Quality check: <item>": next step by state; samples list; Is it OK?; second-person check kept; cancel in ⋯ More. |
| `/quality/inspections` | ☑ 2026-10-31 | "Quality checks (tests)"; item first; plain states. |
| `/quality/label-verification` | ☑ 2026-10-31 | "Check the labels in an area": next step, 44 px area chips, scan field. |
| `/quality/lots/[lotId]` | ☑ 2026-10-31 | Item first; next step "decide"; only fitting choices; OK to use / Stop / Not OK; history as list. |
| `/quality` | ☑ 2026-10-31 | QA queue: next step to the oldest batch/lot; name-first lists; older decisions folded; other screens in ⋯ More. |
| `/quality/recall` | ☑ 2026-10-31 | "Who received it": pick the product by name (scan folded); customers list; details folded; start recall = green. |
| `/quality/recalls/[recallId]` | ☑ 2026-10-31 | "Product recall": next step per state; lots and customers as lists; downloads/cancel in ⋯ More. |
| `/quality/recalls/new` | ☑ 2026-10-31 | 3 visible fields (kind, short name, why); class and obligations folded. |
| `/quality/recalls` | ☑ 2026-10-31 | "Product recalls"; title first; plain status chips. |
| `/quality/trace` | ☑ 2026-10-31 | "Where it came from and where it went": pick by name; scan/supplier lot folded; customers list. |

## Sales & customers (25)

| Screen | Status | Notes |
|---|---|---|
| `/sales/[orderId]` | ☑ 2026-10-31 | Record header with grade-5 steps; "What to do next" per status names who we wait for (send / approve / set aside / get from shelf / check box / send out / send the invoice); cancel, let stock go, reorder, delete draft under ⋯ More; lines as rows with ₱ right. |
| `/sales/board` | ☑ 2026-10-31 | PageIntro; columns renamed (Set aside, Getting from shelf, Box checked, Sent out, Billed, Done); cards name first, number small grey; 44 px move picker. |
| `/sales/customers/[id]` | ☑ 2026-10-31 | Next step by status (order / price offer / stopped: unpaid bills); special rules, own product codes, money in plain words; owner may approve own rules (ADR-091, sodConflictAt); orders as PlainList. |
| `/sales/customers/new` | ☑ 2026-10-31 | 4 fields (name, phone, street, city); contact person, days to pay (finance only), number and the rest under More details; CUS number from the server. |
| `/sales/customers` | ☑ 2026-10-31 | Split view kept; name first, phone, number small grey, ₱ owed right; "Stopped: unpaid bills"; CSV and new order under ⋯ More. |
| `/sales/dispatch` | ☑ 2026-10-31 | "Send out" dock, phone first: ready to send out / waiting for second check / waiting for proof of delivery as PlainList rows with one action word. |
| `/sales/new` | ☑ 2026-10-31 | 3-step wizard kept; customer and product picked by name with search (NamePicker); order no., addresses and note under More details. |
| `/sales/orders/[orderId]/edit` | ☑ 2026-10-31 | PageIntro; same name pickers; plain "only a draft can be changed". |
| `/sales/packing/[shipmentId]` | ☑ 2026-10-31 | "Second check of the box", phone first: big scan box, boxes checked/to check, finish card (boxes on truck, carrier; tracking and weight under More); checker ≠ picker and manager exception (password) kept. |
| `/sales` | ☑ 2026-10-31 | PlainList (customer first, ₱ right, number grey, icon status, late in red); FilterTabs; board and help under ⋯ More. |
| `/sales/picking/[pickId]` | ☑ 2026-10-31 | "Get from shelf", phone first: next shelf and box in words, one scan box, big rows, one green Finish button; finish with items missing (reason), print, stop under ⋯ More. |
| `/sales/picking` | ☑ 2026-10-31 | "To get from shelf": started first, then ready orders as big cards with one green button on the first; finished folded away. |
| `/sales/price-lists/[id]/edit` | ☑ 2026-10-31 | PageIntro; same form as new. |
| `/sales/price-lists/[id]` | ☑ 2026-10-31 | "Prices for <customer>": approve / waiting for <name>; rows name first, ₱ right; new version, stop using, delete draft under ⋯ More; "(own request)" on self-approval. |
| `/sales/price-lists/new` | ☑ 2026-10-31 | Who, starts on, products and prices; number and name made by the server (customer list keeps its number = next version); name/number/what changed under More details. |
| `/sales/price-lists` | ☑ 2026-10-31 | "Prices": PlainList, customer first, number grey, waiting-for-approval banner. |
| `/sales/quotations/[id]/edit` | ☑ 2026-10-31 | PageIntro; "Change price offer". |
| `/sales/quotations/[id]` | ☑ 2026-10-31 | "Price offer for <customer>": send / approve / make it an order as the next step; accept, decline, cancel, delete under ⋯ More; rows with ₱ right. |
| `/sales/quotations/new` | ☑ 2026-10-31 | Customer and products by name; good until defaulted; deliver-to and notes under More details. |
| `/sales/quotations` | ☑ 2026-10-31 | "Price offers": PlainList with ₱ right; CSV under ⋯ More. |
| `/sales/returns/[returnId]` | ☑ 2026-10-31 | "Customer return": next step per state (scan, send, approve, take in, QA decided, finish) with who we wait for; lines as rows; cancel/send back under ⋯ More. |
| `/sales/returns/new` | ☑ 2026-10-31 | 3 fields (delivery by customer name, why, explain); where to keep under More details. |
| `/sales/returns` | ☑ 2026-10-31 | "Customer returns": PlainList, FilterTabs, icon statuses in plain words. |
| `/sales/shipments/[shipmentId]` | ☑ 2026-10-31 | "Delivery": next step (get from shelf / check box / send out with driver and plate / proof of delivery); cancel and undo sending under ⋯ More; history folded. |
| `/sales/shipments` | ☑ 2026-10-31 | "Deliveries": PlainList with grade-5 statuses; accountant download folded under More details. |


## Notes from the Home, Settings & people, Reports and Help pass (2026-10-31)

- New read model `getTopProducts` (src/modules/analytics/top-products.ts) for "What sells best" on the Reports page: confirmed orders only (same rule as "Orders confirmed"), money masked like the order-value number, site-scoped; tests in `tests/integration/analytics/top-products.test.ts`.
- Shared grade-5 helpers: `src/ui/role-names.ts` (Owner, Site manager, Machine operator, Warehouse, QA, Sales, Finance; per-role Home sentence), `src/ui/permission-words.ts` (permission strings as "Stock: see, add, approve"; "Needs the owner's OK" for restricted), `src/ui/name-and-code.tsx` (codes made from names: roles, labels, layouts, printer places, column matchings).
- Help: five role guides (`docs/help/role-*.md`, "Your day in 5 steps") and `docs/help/words.md`; task guides stay (the "?" on screens and `/help#key`).
- Settings without a written description show their current value as the sentence; 118 of 170 settings in `src/lib/settings.ts` still need a one-sentence `description` from their module owner.
- Menu labels to rename in `nav.ts` (not changed here): "Dashboards" → "Reports", "Report library" → "Lists to download or print", "Scheduled reports" → "Lists sent by email", "Trends" → "Compare over time", "KPI definitions" → "What each number means", "Users" → "People", "Sessions" → "Who is signed in", "Security" → "Sign-in safety", "Audit log" → "History of changes", "Approval rules" → "Who says OK to what", "Numbering" → "How record numbers look", "Templates & labels" → "Labels and printouts", "Notification rules" → "Who gets which message", "Imports" → "Load data from a spreadsheet", "Legacy documents" → "Old paper documents", "Devices" → "Phones and tablets", "Sync conflicts" → "Phone changes to check", "Retention & holds" → "Keeping and deleting old records", "Diagnostics" → "Health of the system", "Sync & offline" → "Working without signal".


## Notes from the scan-or-pick pass (2026-10-31, owner: "How would he scan it?")

- One shared field for "which lot / box / shelf / batch / item": `src/ui/scan-or-pick.tsx`. Every field it replaced, and
  the production and labels fields still to adopt it, are listed in `docs/SCAN_INPUTS.md`.
- Verified at 390 × 844 (touch) on the dev server: Move stock completed by taps only and again by a scanner burst
  (lot label, then shelf label); wrong label kind and the placeholder text refused in plain words; find by name lists
  usable lots first and expired last, each with amount, shelf name and use-by date. Pack into a box completed by taps;
  the lot's move page completed by taps; Fix stock filled by a scanner burst (shelf chosen by itself, the only one);
  Put away shows only lots waiting to be put away. The QA, sales and maintenance screens are covered by the
  integration tests; their live phone run was cut short by the sandbox running out of memory (see the report).
- Receiving (live audit): brand and "Why no purchase order?" under More details, migration reasons removed, shelf names
  instead of codes. Still 6 fields without a purchase order (supplier, paper number, item, amount, supplier's lot,
  expiry); spare parts are still in the item list (next step: group them).
- Scan screen: "Scan the label, or type what it is", the camera fallback offers the handheld scanner or a name, and
  "Where is the label?" replaces "What can I scan or type?" (A-SCAN-13 needs the warehouse lead).
