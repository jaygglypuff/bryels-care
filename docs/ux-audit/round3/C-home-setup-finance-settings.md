# UX re-audit C (round 3): Home, Help, Operations, Setup, Finance, Reports, Settings & people, and the app frame

Auditor: independent UI/UX re-audit, read-only, on the live demo (https://bryels-care-production.up.railway.app), 2026-11-01, after fix rounds 1–2 (ADR-098 to ADR-103).
Baseline: `docs/ux-audit/C-home-setup-finance-settings.md` (2026-10-31: 31 of 130 rows passed).
Method: the same Playwright measuring script as the first audit (`ux-reaudit/Cw/audit.cjs`) on the same 130 screen + role rows at 390x844 (phone, touch) and 1440x900, plus 820x1180 (iPad, touch) for the frame and menus, 1920x1080 for `/floor`. Measured per screen: H1, "This screen is for…" line, "What to do next" boxes and their buttons, visible fields (folded `<details>` not counted), sideways scroll, tap targets under 44 px (inline text links excluded, as before), codes and jargon in the text. Menus: every drawer entry per role opened at 1440 and its H1 compared with the menu word. I looked at the key screenshots myself. Nothing was saved, approved, sent or reset. The recipe wizard was walked through screens 1–5 with Next/Back only (no "Save as draft", no "Send for approval").
Screenshots: `/tmp/claude-0/-home-user-bryels-care/103807bc-c37f-572c-a3d5-4a6ebca2aac4/scratchpad/ux-reaudit/C/` (`<screen>-<role>-390.png` / `-1440.png` full page; `shell-<role>-<390|820>-home|drawer.png`, `shell-<role>-1440.png`; `wizard-<n>-owner-<vp>.png`, `wizard-3-empty-owner-*.png`, `wizard-1-validation-*.png`; `floor-floor.nfd-1920.png`; `vp-dashboard-owner-820.png`; `menus-<role>.json`). Raw metrics and scripts: `…/ux-reaudit/Cw/` (`res-*.jsonl`, `final.json`, `score.py`, `final.py`).

## How sure these findings are

- **Sandbox quirk (not an app defect).** Headless Chromium here still gets 404 for JS chunks under `(app)` (it re-encodes the parentheses). I worked around it by refetching those chunks with the encoding fixed. With the fix, record pages (`/…/[id]`) and the wizard hydrate and work. A real-phone check outside this sandbox is still recommended once.
- **The demo was reset at least twice while I worked and all sessions were signed out each time** (record ids changed 01a18d48… → 01a1955a… → 01a19565…; the recipe I first opened became "Recipe not found"). I did not press Reset; other auditors share the demo. My script signs in again, and every record page was re-captured with freshly discovered ids. Counts on Home/Operations therefore differ slightly between screenshots taken minutes apart; I did not count such differences as defects.
- Pass/fail is my judgement against the same 10 criteria. Criterion 5 is now also checked for "(s)" plurals ("1 invoice(s)", "22 day(s)"), which the first audit did not count. To compare like with like I give both numbers.

## Summary

| | First audit (2026-10-31) | Re-audit (2026-11-01) |
|---|---|---|
| Rows checked | 130 | 130 (same screen + role pairs; all reachable now, incl. record pages) |
| Pass all 10 (strict, "(s)" plurals count as a fail) | – | **62** |
| Pass all 10 (same word check as the first audit) | **31** | **72** |
| Fail at least one (strict) | 99 | 68 |
| Rows that went from fail to pass | – | 39 |
| Rows newly failing | – | 8, all from the stricter word check ("(s)" plurals on 6; "deviation" on notification rules; raw values on the stock report), none from a changed screen |

Failures by criterion (strict, 130 rows): 1 intro: 1 · 2 one next step: 2 · 3 at most 5 fields: 12 · 4 never type a code: 1 · 5 grade-5 words: 37 (27 without "(s)") · 6 names before codes: 5 · 7 phone fit and 44 px: 39 · 8 empty/error states: 0 · 9 consistency: 1 · 10 old screen: 2.
First audit: 1: 3 · 2: 32 · 3: 19 · 4: 1 · 5: 28 · 6: 35 · 7: 71 · 8: 1 · 9: 11 · 10: 5.

What changed for a first-time owner: one door per job (no duplicate To approve / Messages / "To decide"), menu words equal screen titles, Scan on every phone, a 44 px frame at 390/820/1440, a "What to do next" box on every record page, names before codes almost everywhere, a recipe wizard that cannot send an empty recipe. What is left is mostly in-page small targets (chips, Chart/Table toggle, checkboxes, inline list links), plain words ("(s)", ISO dates, CAPA/deviation/quarantine in alerts and seed data), a still-large owner menu, and one Home feed line type that shows only a code.

### Top remaining problems (ranked by impact on a first-time owner)

1. **Home "Recent activity" is mostly "The system escalated the problem · SO-26-00012"** (six identical lines for owner and manager, no name of what the problem is). Names-first works for user actions ("Ana Villanueva confirmed the customer order for Salon Amihan"), but problem (action item) lines carry no name.
2. **Small targets inside pages (39 rows):** Problems & alerts has 15 filter chips 29 px tall that fill the first phone screen; Chart/Table toggle 34 px on Home and Reports; "Sign out" 33 px on My account; sync-conflict chips 33 px; Operations stage-card warning links 25 px; diagnostics chips 29 px; retention "Change or confirm" 19 px; Units "Edit" 19 px; record lists on Site/Warehouse pages 19–20 px; checkboxes and radios 16–24 px in forms (ADR-101 promised ≥44 px label rows).
3. **Plain words:** "(s)" plurals on 10 screens (Money, Supplier bills, Expense claims, Close the month, Suppliers, statements "1 invoice(s) are late · 22 day(s) late", Messages "1 day(s) late", People "24 device(s)"); ISO dates in alerts and messages ("went out of date on 2026-10-28", "Planned end 2026-10-31"); "CAPA", "Open deviation", "routing" on Problems & alerts; "quarantine", "disposition", "line clearance" from seeded step names on the recipe screens; "(PLACEHOLDER)" in seeded quality-check names; report footnotes "posted", "output mass".
4. **Owner menu still big:** 113 entries (103 unfolded) in 5 destinations and 18 sub-menus (was 120 in 17). Management alone has 9 sub-menus for the owner; at 1440 the Operations sub-row wraps to a second line (Maintenance alone).
5. **Recipe path ends on the advanced screen:** "← All recipes" on the wizard and on the recipe page, and `/masterdata/recipes`, open "Recipes (advanced)" (`/masterdata/formulas`). There is no simple recipe list.
6. **Big forms that remain:** Problems & alerts shows a note box on every card (22 visible fields); Compare over time 40 checkboxes; New material 10; Supplier bill 8; Locations 8 (filters + add form); Site detail 7 inputs with one Save per team; Record a payment 6; Phones and tablets 6.
7. **To approve** still puts a green Approve on every card (17 green buttons under one "What to do next").
8. **Site selector shows the code first and is cut off** ("NFD · North F") in the 1440 top bar and in the drawer.
9. **Small consistency gaps:** Messages intro sits under "Show history / Mark all read"; Messages says "QA decisions waiting are listed in the Check a batch or delivery." (broken sentence); sales role sees an empty "Purchasing" section that only opens "Advanced"; admin sees a one-item "Purchasing" section.
10. **Sign-in page** (first screen of the app) still advertises "FEFO picking" and "Digital Batch Manufacturing Records".

## Finding by finding (first audit → now)

### Top 10 of the first audit

| # | First-audit finding | Status | Evidence now |
|---|---|---|---|
| 1 | Same job behind two or three doors (To approve ×3, Messages ×2, three "Quality check(s)", two supplier lists, three report entries) | **FIXED** (one residual) | To approve: Home tab only on phones, top-bar button from 640 px (820/1440), no "To decide" tab (`/action-centre?tab=approvals` redirects to `/approvals`). Messages: bell only in tab rows. QA: "Check a batch or delivery" (`/quality`, `/quality/check` redirects), "Quality tests", "Quality checks for each item". Suppliers: one entry, `/masterdata/suppliers` redirects to "Suppliers we may buy from". Residual: "Business overview", "Reports" and "Lists to download or print" are still three report doors (STILL OPEN, low). |
| 2 | Old screens in the owner menu | **FIXED** | Planning tools now holds only "Production plan" and "Batch records". `/production/work-orders`, `/production/new`, `/production/staging` redirect to Production orders / New production order. Recipe and step editors folded under "Advanced"; the wizard's "Advanced editing instead" link is gone. Residual: see remaining problem 5 (All recipes → advanced list). |
| 3 | Owner menu too big (120 items, 17 sub-menus) | **STILL OPEN** (small gain) | 113 items, 103 unfolded, 18 sub-menus; manager 98, auditor 96, QA 80, admin 80. |
| 4 | Codes first in Home activity, Messages, Problems & alerts, Operations Center, Reports | **PARTLY FIXED** | Messages, Problems & alerts, Operations Center (product first, "Step now", "Due", Recent activity), approvals and report footnotes now lead with names; KPI/ADR codes gone from reports. "generated generated" gone. STILL OPEN: Home activity lines for problems show only a code; sync conflict title "Stock move · L-2611-00001"; approval rules show "A-PM-15"; stock report rows start with site/location codes; site selector "NFD · North F". |
| 5 | Taps too small on 71 of 130 phone screens; tab row cuts "Problems & alerts" | **PARTLY FIXED** | Frame is 44 px everywhere at 390/820/1440 (top bar, tabs, drawer, account menu, demo strip; drawer close 44). 39 of 130 rows still have small in-page targets (list in remaining problem 2). The phone Home tab row still shows "Probl…" under the fade before "More" (it scrolls). |
| 6 | Record pages without a clear next step (32 rows) | **FIXED** | Every record page re-checked has exactly one "What to do next" (Setup details, finance bill/credit/expense/invoice/payment/statement, template, label, user, role, schedule, equipment, inspection plan, reason, recipe). Invoice has one "Save to the books"; the expense claim names "Waiting for Dino Reyes (Site Manager)". Residual: To approve list (one green Approve per card). |
| 7 | Edit forms far over 5 fields (role clone 399, steps version 106, new label 25, reason 17, site 11) | **PARTLY FIXED** | Role clone: name only; steps version: no open inputs; new label: printed fields folded; reason: plain words, no raw code. STILL OPEN: site detail (7 inputs, one Save per team), forms listed in remaining problem 6. |
| 8 | Recipe wizard sends an empty recipe | **FIXED** | Screens 3/4 refuse to move on with no ingredients ("Add at least one ingredient."), jumping to 5 is refused too; products with a recipe are marked "Already has a recipe · Open it"; intro line present; no advanced link. See wizard section. |
| 9 | No scan on phones; empty sync chip | **FIXED** | "Scan" (79x44) in the phone top bar for every role; drawer sync chip reads "All saved". |
| 10 | Menu word ≠ screen title on 29 items | **FIXED** | 0 of 113 owner entries differ, except 4 listed dynamic titles (Overview → greeting, Floor screen (TV) → site name, Stock → "Raw materials" tab, New recipe → "1. Which product?"). "FEFO" is gone from the menu. |

### Concrete fix list of the first audit

| # | Fix | Status | Note |
|---|---|---|---|
| 1 | Verify record pages on a real phone | **UNVERIFIED** (sandbox) | Quirk is the sandbox's re-encoding of `(app)`; with it worked around everything hydrates. |
| 2 | One inbox; hide duplicate To approve/Messages | FIXED | |
| 3 | Planning tools out of owner/sales menu; redirect old production screens | FIXED | Sales sees only "Production plan". `/production/board` is still reachable from Production orders ("Board") by design. |
| 4 | Rename name clashes; drop "Expense approvals" | FIXED | One "Expense claims" entry (Home › Help & my account). |
| 5 | Menu label = H1; remove FEFO; Management tagline | FIXED | Tagline "Buying, money, reports and settings". |
| 6 | Names before codes in feeds | PARTLY FIXED | Home problem lines (see remaining 1). |
| 7 | 44 px everywhere | PARTLY FIXED | Frame done; in-page remains (39 rows). |
| 8 | Phone Scan | FIXED | |
| 9 | Recipe wizard validation, guard, intro, no advanced link | FIXED | "← All recipes" still opens the advanced list. |
| 10 | Next step on Setup and finance records | FIXED | |
| 11 | Fold big forms | PARTLY FIXED | Site detail and others (remaining 6). |
| 12 | Intro directly under the title | **STILL OPEN** | On phones the header buttons still come before the intro on Materials ("Export CSV · New material"), Messages ("Show history · Mark all read") and Invoice ("More"); the wizard puts the intro above the progress bar and H1. |
| 13 | Help "?" in the frame | **STILL OPEN** | Still only on a few screens (ADR-103 lists it as open). |
| 14 | Wording: delivery(ies), PLACEHOLDER, "Anyone" | PARTLY FIXED | "16 deliveries went out without an invoice" is fixed; "(PLACEHOLDER)" still in quality-check names (**needs demo reset/seed change**); floor TV still shows "Anyone · started 08:00"; ~10 screens with "(s)". |
| 15 | Home sales card "−95 % vs yesterday" | FIXED | "Yesterday: ₱3,456 in total (today is not over yet)", neutral. |

### Old or superseded screens (re-checked by URL and from menus)

| Old screen | Now | Status |
|---|---|---|
| `/production/work-orders`, `/production/work-orders/new` | redirect to `/production/orders`, `/production/orders/new` | FIXED |
| `/production/new` | redirects to New production order | FIXED |
| `/production/staging` | redirects to Production orders | FIXED |
| `/production/board` | still opens "Production board"; not in any menu; "Board" button on Production orders | kept by design (ADR-100); not counted |
| `/quality/check` | redirects to `/quality` "Check a batch or delivery" | FIXED |
| `/masterdata/suppliers` | redirects to "Suppliers we may buy from" | FIXED |
| `/action-centre?tab=approvals` / `?tab=alerts` | redirect to To approve / Messages | FIXED |
| `/finance/expenses?status=to_approve` | not in any menu; still opens Expense claims filtered | FIXED (no duplicate entry) |
| `/masterdata/formulas(/new)`, `/masterdata/routings(/new)` | kept as advanced editors (ADR-096), folded under "Advanced" in Production setup | accepted exception, not counted |
| `/masterdata/recipes` and "← All recipes" | open "Recipes (advanced)" | **STILL OPEN** |

### New findings in this round

| # | Finding | Where | Severity |
|---|---|---|---|
| N1 | Home activity "The system escalated the problem" ×6 with only a record number (action items have no name in the sentence) | `src/app/(app)/dashboard/activity-sentence.ts` (`action_item: "problem"`; no `entityName`), the activity read model | High |
| N2 | Sales role: Management › "Purchasing" section has no daily entry, only "Advanced › Sales guess" | `src/app/(app)/nav.ts` (section split / advanced) | Low |
| N3 | At 1440 the Operations sub-row (6 tabs + 4 menus + description) wraps; "Maintenance" sits alone on a second line | `src/app/(app)/shell.tsx` desktop section row | Low |
| N4 | Site selector option text is "code · name" and truncates to "NFD · North F" | `src/app/(app)/shell.tsx` line ~187 (`{s.code} · {s.name}`) | Medium |
| N5 | ISO dates in alert and message bodies ("2026-10-28", "Planned end 2026-10-31") | action-centre kinds (`src/modules/action-centre/kinds.ts`), notification templates | Medium |
| N6 | Messages intro sentence broken: "QA decisions waiting are listed in the Check a batch or delivery." | `src/app/(app)/notifications/page.tsx` | Low |
| N7 | Sign-in page: "FEFO picking", "Digital Batch Manufacturing Records" | `src/app/(auth)/sign-in/*` | Low |
| N8 | Recipe screens show seeded step names with jargon ("Weighing area line clearance", "Transfer to quarantine storage area", "until QA disposition") | seed (`src/db/seed*.ts`) — needs demo reset after change | Medium (needs demo reset) |
| N9 | The demo was reset at least twice during the audit and every session ended each time; several auditors share it | process, not app | Note |
| N10 | Wizard screen 1 at 390: the sticky Back/Next bar covers the 3rd product and "Make a new product" until you scroll (all three demo products already have a recipe, so "Next" can only show an error) | `src/app/(app)/masterdata/recipes/wizard.tsx` | Low |

## Per-screen table (390 unless noted; 1 intro · 2 one next step on record pages · 3 at most 5 visible fields · 4 never type a code · 5 grade-5 words · 6 names before codes · 7 phone fit and 44 px · 8 empty/error states · 9 consistency · 10 old screen; ✓ pass, ✗ fail, – not applicable). "Was" = first audit row result. Numbering follows the first audit.

| # | Route (live) | Role | Screen title | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Was | Now | Notes (✗ reasons) | Screenshot 390 / 1440 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `/dashboard` | owner | Good afternoon, Ana | ✓ | – | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | fail | fail | 5: escalated; 6: Recent activity: six lines "The system escalated the problem" with only a record number, no name; 7: 2 targets <44px: Chart(57x34), Table(57x34) | dashboard-owner-390.png / -1440.png |
| 2 | `/dashboard` | manager.nfd | Good afternoon, Dino | ✓ | – | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | fail | fail | 5: escalated; 6: Recent activity: "The system escalated the problem · SO-26-00012" (no name); 7: 2 targets <44px: Chart(57x34), Table(57x34) | dashboard-manager.nfd-390.png / -1440.png |
| 3 | `/dashboard` | operator.nfd | Good day, Rhea | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | dashboard-operator.nfd-390.png / -1440.png |
| 4 | `/dashboard` | warehouse.nfd | Good day, Lito | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | dashboard-warehouse.nfd-390.png / -1440.png |
| 5 | `/dashboard` | qa.nfd | Good afternoon, Nina | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 2 targets <44px: Chart(57x34), Table(57x34) | dashboard-qa.nfd-390.png / -1440.png |
| 6 | `/dashboard` | finance | Good afternoon, Rosa | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 2 targets <44px: Chart(57x34), Table(57x34) | dashboard-finance-390.png / -1440.png |
| 7 | `/dashboard` | sales | Good afternoon, Mara | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 2 targets <44px: Chart(57x34), Table(57x34) | dashboard-sales-390.png / -1440.png |
| 8 | `/account` | owner | My account | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 5 targets <44px: Sign out(77x33), Sign out(77x33), Sign out(77x33) | account-owner-390.png / -1440.png |
| 9 | `/account` | operator.nfd | My account | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 1 targets <44px: Sign out(77x33) | account-operator.nfd-390.png / -1440.png |
| 10 | `/action-centre` | owner | Problems & alerts | ✓ | – | ✗ | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 3: 22 visible fields; 5: deviation, routing, CAPA; 7: 17 targets <44px: All kinds(80x29), Late production order(159x29), Lot expiring soon(132x29) | action_centre-owner-390.png / -1440.png |
| 11 | `/action-centre` | manager.nfd | Problems & alerts | ✓ | – | ✗ | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 3: 19 visible fields; 5: deviation, routing, CAPA; 7: 14 targets <44px: All kinds(80x29), Late production order(159x29), Lot expiring soon(132x29) | action_centre-manager.nfd-390.png / -1440.png |
| 12 | `/approvals` | owner | To approve | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 2: Next-step box OK, but every card still has its own green Approve (17 green buttons) | approvals-owner-390.png / -1440.png |
| 13 | `/approvals` | finance | To approve | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 2: every card has its own green Approve | approvals-finance-390.png / -1440.png |
| 14 | `/dashboard/details/batches` | owner | Batches this week | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | dashboard_details_batches-owner-390.png / -1440.png |
| 15 | `/dashboard/details/stock` | owner | Stock to look at | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | dashboard_details_stock-owner-390.png / -1440.png |
| 16 | `/notifications` | manager.nfd | Messages | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: 1× "(s)" | notifications-manager.nfd-390.png / -1440.png |
| 17 | `/notifications` | operator.nfd | Messages | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | notifications-operator.nfd-390.png / -1440.png |
| 18 | `/sync` | operator.nfd | Working without signal | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | sync-operator.nfd-390.png / -1440.png |
| 19 | `/sync/conflicts` | owner | Phone changes to check | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 3 targets <44px: Open(64x33), Resolved(86x33), All(45x33) | sync_conflicts-owner-390.png / -1440.png |
| 20 | `/sync/conflicts/[id]` | owner | Stock move · L-2611-00001 | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | fail | fail | 3: 9 visible fields; 5: deviation; 6: code in title "Stock move · L-2611-00001"; 7: 1 targets <44px: Open record(78x19) | sync_conflicts_id-owner-390.png / -1440.png |
| 21 | `/help` | owner | Help | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: quarantine, deviation, CAPA | help-owner-390.png / -1440.png |
| 22 | `/help` | operator.nfd | Help | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: quarantine, deviation, CAPA | help-operator.nfd-390.png / -1440.png |
| 23 | `/operations` | owner | Operations Center | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 4 targets <44px: 1 past the expected date(138x43), 2 on hold(138x25), 5 expire within 30 days(138x43) | operations-owner-390.png / -1440.png |
| 24 | `/operations` | manager.nfd | Operations Center | ✓ | – | – | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 5: escalated; 7: 4 targets <44px: 1 past the expected date(138x43), 2 on hold(138x25), 5 expire within 30 days(138x43) | operations-manager.nfd-390.png / -1440.png |
| 25 | `/floor` | owner | Bryel's Care · North Fields Plant | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | floor-owner-390.png / -1440.png |
| 26 | `/admin/approval-rules` | admin | Who says OK to what | ✓ | – | – | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | fail | fail | 6: rule ids A-PM-15, A-W4C-05 shown on every step | admin_approval_rules-admin-390.png / -1440.png |
| 27 | `/admin/audit` | admin | History of changes | ✓ | – | ✓ | ✗ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 4: search still says "type its number"; 7: 100 targets <44px: What changed (before / after)(318x40), What changed (before / after)(318x40), What changed (before / after)(318x40) | admin_audit-admin-390.png / -1440.png |
| 28 | `/admin/demo` | admin | Reset demo data | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | admin_demo-admin-390.png / -1440.png |
| 29 | `/admin/devices` | admin | Phones and tablets | ✓ | – | ✗ | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 3: 6 visible fields; 5: workflow; 7: 9 targets <44px: Approve device(318x19), INPUT(20x20), INPUT(20x20) | admin_devices-admin-390.png / -1440.png |
| 30 | `/admin/diagnostics` | admin | Health of the system | ✓ | – | – | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 5: ADR-; 7: 18 targets <44px: All(42x29), queued · 0(92x29), running · 0(92x29) | admin_diagnostics-admin-390.png / -1440.png |
| 31 | `/admin/imports/legacy-documents` | admin | Old paper documents | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | admin_imports_legacy_documents-admin-390.png / -1440.png |
| 32 | `/admin/imports` | admin | Load data from a spreadsheet | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: SKU | admin_imports-admin-390.png / -1440.png |
| 33 | `/admin/notification-rules` | admin | Who gets which message | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | pass | fail | 5: deviation | admin_notification_rules-admin-390.png / -1440.png |
| 34 | `/admin/numbering` | admin | How record numbers look | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: CAPA | admin_numbering-admin-390.png / -1440.png |
| 35 | `/admin/users` | admin | People who use the app | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | admin-admin-390.png / -1440.png |
| 36 | `/admin/retention` | admin | Keeping and deleting old records | ✓ | – | – | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 5: disposition, deviation, entity, idempotency; 7: 29 targets <44px: Change or confirm(137x19), Change or confirm(137x19), Change or confirm(137x19) | admin_retention-admin-390.png / -1440.png |
| 37 | `/admin/roles` | admin | Roles (what each job may do) | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | admin_roles-admin-390.png / -1440.png |
| 38 | `/admin/security` | admin | Sign-in safety | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | admin_security-admin-390.png / -1440.png |
| 39 | `/admin/sessions` | admin | Who is signed in | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | pass | fail | 5: 1× "(s)" | admin_sessions-admin-390.png / -1440.png |
| 40 | `/admin/settings` | admin | Settings | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | admin_settings-admin-390.png / -1440.png |
| 41 | `/admin/templates` | admin | Labels and printouts | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | admin_templates-admin-390.png / -1440.png |
| 42 | `/admin/templates/labels/new` | admin | New label | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | admin_templates_labels_new-admin-390.png / -1440.png |
| 43 | `/admin/templates/new` | admin | New page layout | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | admin_templates_new-admin-390.png / -1440.png |
| 44 | `/admin/templates/stations` | admin | Label printers | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | admin_templates_stations-admin-390.png / -1440.png |
| 45 | `/admin/users` | admin | People who use the app | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | admin_users-admin-390.png / -1440.png |
| 46 | `/admin/users/invite` | admin | Add a person | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 1 targets <44px: Cancel(43x19) | admin_users_invite-admin-390.png / -1440.png |
| 47 | `/admin/roles/[id]` | admin | Auditor (can only look) | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | admin_roles_id-admin-390.png / -1440.png |
| 48 | `/admin/roles/[id]/clone` | admin | New job, copied from Auditor (can only look) | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** | 2: create form; permissions folded, name only visible (fixed) | admin_roles_id_clone-admin-390.png / -1440.png |
| 49 | `/admin/templates/[id]` | admin | BMR hybrid paper page (blank, handwritten steps) | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | admin_templates_id-admin-390.png / -1440.png |
| 50 | `/admin/templates/labels/[id]` | admin | Box / carton 100 × 50 mm | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | admin_templates_labels_id-admin-390.png / -1440.png |
| 51 | `/admin/users/[id]` | admin | Ana Villanueva | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: 1× "(s)" | admin_users_id-admin-390.png / -1440.png |
| 52 | `/documents/[id]` | admin | Label | ✓ | ✓ | – | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 5: quarantine, SHA-256; 7: 1 targets <44px: DOC-26-0000002 · Original(172x19) | documents_id-admin-390.png / -1440.png |
| 53 | `/management` | owner | Management | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | management-owner-390.png / -1440.png |
| 54 | `/management` | manager.nfd | Management | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | management-manager.nfd-390.png / -1440.png |
| 55 | `/admin/settings` | owner | Settings | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | admin_settings_owner-owner-390.png / -1440.png |
| 56 | `/admin/users` | owner | People who use the app | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | admin_users_owner-owner-390.png / -1440.png |
| 57 | `/analytics` | owner | Reports | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 2 targets <44px: This site(80x40), All my sites(99x40) | analytics-owner-390.png / -1440.png |
| 58 | `/analytics/overview` | owner | Business overview | ✓ | – | – | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 5: card footnotes: "posted", "output mass", "grace days", "further along"; 7: 8 targets <44px: New production order(40x40), QA queue(40x40), Production orders(40x40) | analytics_overview-owner-390.png / -1440.png |
| 59 | `/analytics/definitions` | owner | What each number means | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: posting, KPI | analytics_definitions-owner-390.png / -1440.png |
| 60 | `/analytics/operations` | owner | Making products | ✓ | – | – | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 5: deviation, routing, KPI; 7: 11 targets <44px: Chart(57x34), Table(57x34), Chart(57x34) | analytics_operations-owner-390.png / -1440.png |
| 61 | `/reports` | owner | Lists to download or print | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | reports-owner-390.png / -1440.png |
| 62 | `/reports/schedules` | owner | Lists sent by email | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | reports_schedules-owner-390.png / -1440.png |
| 63 | `/reports/schedules/new` | owner |  | ✗ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 1: no "This screen is for" line | reports_schedules_new-owner-390.png / -1440.png |
| 64 | `/reports/RPT-INV-STOCK` | owner | What stock we have, and where | ✓ | – | ✓ | ✓ | ✗ | ✗ | ✓ | – | ✓ | ✓ | pass | fail | 5: "QA status quarantine", ISO dates 2028-10-26; 6: rows start with site/location codes (NFD, QUA-01) | reports_rpt_inv_stock-owner-390.png / -1440.png |
| 65 | `/analytics/kpi/KPI-SAL-01` | owner | Orders confirmed | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | analytics_kpi_code-owner-390.png / -1440.png |
| 66 | `/reports/schedules/[id]` | owner | Weekly QA decisions (demo) | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | reports_schedules_id-owner-390.png / -1440.png |
| 67 | `/finance` | finance | Money | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | pass | fail | 5: 1× "(s)" | finance-finance-390.png / -1440.png |
| 68 | `/finance/bills` | finance | Supplier bills | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: 1× "(s)" | finance_bills-finance-390.png / -1440.png |
| 69 | `/finance/bills/new` | finance | Enter a supplier bill | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 3: 8 visible fields | finance_bills_new-finance-390.png / -1440.png |
| 70 | `/finance/credit-notes` | finance | Credits (money back) | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | finance_credit_notes-finance-390.png / -1440.png |
| 71 | `/finance/expenses` | finance | Expense claims | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | pass | fail | 5: 1× "(s)" | finance_expenses-finance-390.png / -1440.png |
| 72 | `/finance/expenses/new` | finance | Claim money I spent | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | finance_expenses_new-finance-390.png / -1440.png |
| 73 | `/finance/invoices` | finance | Invoices | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | finance_invoices-finance-390.png / -1440.png |
| 74 | `/finance/payments` | finance | Payments | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | finance_payments-finance-390.png / -1440.png |
| 75 | `/finance/payments/new` | finance | Record a payment | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 3: 6 visible fields; 7: 2 targets <44px: INPUT(20x20), INPUT(20x20) | finance_payments_new-finance-390.png / -1440.png |
| 76 | `/finance/periods` | finance | Close the month | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | pass | fail | 5: 1× "(s)" | finance_periods-finance-390.png / -1440.png |
| 77 | `/finance/statements` | finance | Customer statements | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | finance_statements-finance-390.png / -1440.png |
| 78 | `/finance/tax` | finance | Tax rates | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | finance_tax-finance-390.png / -1440.png |
| 79 | `/finance/bills/[id]` | finance | Laguna Botanicals | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | finance_bills_id-finance-390.png / -1440.png |
| 80 | `/finance/credit-notes/[id]` | finance | Luntian Wellness Stores | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | finance_credit_notes_id-finance-390.png / -1440.png |
| 81 | `/finance/credit-notes/new?invoiceId=[id]` | finance | Money back for Luntian Wellness Stores | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** | 2: create form | finance_credit_notes_new-finance-390.png / -1440.png |
| 82 | `/finance/expenses/[id]` | finance | Rhea Mendoza | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | finance_expenses_id-finance-390.png / -1440.png |
| 83 | `/finance/invoices/[id]` | finance | Sari Glow Online | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | finance_invoices_id-finance-390.png / -1440.png |
| 84 | `/finance/payments/[id]` | finance | Sari Glow Online | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 1 targets <44px: INV-2026-000003(123x20) | finance_payments_id-finance-390.png / -1440.png |
| 85 | `/finance/statements/[id]` | finance | Sari Glow Online | ✓ | ✓ | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | pass | fail | 5: 2× "(s)" | finance_statements_id-finance-390.png / -1440.png |
| 86 | `/finance` | owner | Money | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | pass | fail | 5: 1× "(s)" | finance_owner-owner-390.png / -1440.png |
| 87 | `/finance/expenses/new` | operator.nfd | Claim money I spent | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | finance_expenses_new_operator-operator.nfd-390.png / -1440.png |
| 88 | `/masterdata/equipment` | owner | Equipment | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | masterdata_equipment-owner-390.png / -1440.png |
| 89 | `/masterdata/equipment/[id]` | owner | Soap bar cutter (wire) | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: CAPA | masterdata_equipment_id-owner-390.png / -1440.png |
| 90 | `/masterdata/equipment/new` | owner | Register equipment | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | masterdata_equipment_new-owner-390.png / -1440.png |
| 91 | `/masterdata/formulas` | owner | Recipes (advanced) | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | masterdata_formulas-owner-390.png / -1440.png |
| 92 | `/masterdata/formulas/[id]` | owner | Recipe for Acapulco Soap 135 g | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | masterdata_formulas_id-owner-390.png / -1440.png |
| 93 | `/masterdata/formulas/new` | owner | New recipe (advanced) | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** | 10: advanced form kept on purpose (ADR-096), only under Advanced | masterdata_formulas_new-owner-390.png / -1440.png |
| 94 | `/masterdata/inspection-plans` | owner | Quality checks for each item | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: PLACEHOLDER | masterdata_inspection_plans-owner-390.png / -1440.png |
| 95 | `/masterdata/inspection-plans/[id]` | owner | Acapulco Soap finished product | ✓ | ✓ | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: PLACEHOLDER | masterdata_inspection_plans_id-owner-390.png / -1440.png |
| 96 | `/masterdata/inspection-plans/new` | owner | Quality checks for an item | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | masterdata_inspection_plans_new-owner-390.png / -1440.png |
| 97 | `/masterdata/lines` | owner | Making areas / lines | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 1 targets <44px: Add a making area(318x25) | masterdata_lines-owner-390.png / -1440.png |
| 98 | `/masterdata/lines/[id]` | owner | Lotion line | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | masterdata_lines_id-owner-390.png / -1440.png |
| 99 | `/masterdata/locations` | owner | Locations | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 3: 8 visible fields; 7: 1 targets <44px: INPUT(16x16) | masterdata_locations-owner-390.png / -1440.png |
| 100 | `/masterdata/locations/[id]` | owner | Oils rack A-01 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | masterdata_locations_id-owner-390.png / -1440.png |
| 101 | `/masterdata/materials` | owner | Materials | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 14 targets <44px: 33.33% Lye Solution(159x23), 6% Green in Oil(120x23), Acapulco Extract(132x23) | masterdata_materials-owner-390.png / -1440.png |
| 102 | `/masterdata/materials/[id]` | owner | 33.33% Lye Solution | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 3: 7 visible fields; 7: 4 targets <44px: INPUT(20x20), INPUT(20x20), INPUT(20x20) | masterdata_materials_id-owner-390.png / -1440.png |
| 103 | `/masterdata/materials/new` | owner | New material | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 3: 10 visible fields; 7: 6 targets <44px: INPUT(20x20), INPUT(20x20), INPUT(20x20) | masterdata_materials_new-owner-390.png / -1440.png |
| 104 | `/masterdata/products` | owner | Products | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | masterdata_products-owner-390.png / -1440.png |
| 105 | `/masterdata/products/[id]` | owner | Acapulco Soap 135 g | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | masterdata_products_id-owner-390.png / -1440.png |
| 106 | `/masterdata/reason-codes` | owner | Reasons | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 5: deviation; 7: 2 targets <44px: INPUT(16x16), Add a reason(318x25) | masterdata_reason_codes-owner-390.png / -1440.png |
| 107 | `/masterdata/reason-codes/[id]` | owner | No purchase order in the system yet | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 2 targets <44px: INPUT(20x20), INPUT(20x20) | masterdata_reason_codes_id-owner-390.png / -1440.png |
| 108 | `/masterdata/routings` | owner | Steps (advanced) | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | masterdata_routings-owner-390.png / -1440.png |
| 109 | `/masterdata/routings/[id]` | owner | Steps for Acapulco Soap 135 g | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | masterdata_routings_id-owner-390.png / -1440.png |
| 110 | `/masterdata/routings/new` | owner | New steps (advanced) | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** | 10: advanced form kept on purpose (ADR-096), only under Advanced | masterdata_routings_new-owner-390.png / -1440.png |
| 111 | `/masterdata/sites` | owner | Sites | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 1 targets <44px: Add a site(318x25) | masterdata_sites-owner-390.png / -1440.png |
| 112 | `/masterdata/sites/[id]` | owner | North Fields Plant | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 3: 7 visible fields; 7: 8 targets <44px: Main warehouse(110x20), Lotion line(69x20), Soap line 1(71x20) | masterdata_sites_id-owner-390.png / -1440.png |
| 113 | `/procurement/suppliers` | owner | Suppliers we may buy from | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: 1× "(s)" | masterdata_suppliers-owner-390.png / -1440.png |
| 114 | `/procurement/suppliers/[id]` | owner | Bukidnon Aloe Farms | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | masterdata_suppliers_id-owner-390.png / -1440.png |
| 115 | `/masterdata/suppliers/new` | owner | New supplier | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | masterdata_suppliers_new-owner-390.png / -1440.png |
| 116 | `/masterdata/warehouses` | owner | Warehouses | ✓ | – | – | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 1 targets <44px: Add a warehouse(318x25) | masterdata_warehouses-owner-390.png / -1440.png |
| 117 | `/masterdata/warehouses/[id]` | owner | Main warehouse | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 3: 7 visible fields; 7: 12 targets <44px: Oils rack A-01(86x19), Oils rack A-02(89x19), Actives shelf B-01(112x19) | masterdata_warehouses_id-owner-390.png / -1440.png |
| 118 | `/masterdata/work-instructions` | owner | How-to sheets | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | masterdata_work_instructions-owner-390.png / -1440.png |
| 119 | `/masterdata/work-instructions/[id]` | owner | Soap mixing, pouring and cutting (demo) | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | masterdata_work_instructions_id-owner-390.png / -1440.png |
| 120 | `/masterdata/work-instructions/new` | owner | New how-to sheet | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | pass | **pass** |  | masterdata_work_instructions_new-owner-390.png / -1440.png |
| 121 | `/masterdata/lists` | owner | Choice lists | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 1 targets <44px: Units(37x44) | masterdata_lists-owner-390.png / -1440.png |
| 122 | `/masterdata/uom` | owner | Units | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 7: 3 targets <44px: Edit(292x19), Edit(292x19), Edit(292x19) | masterdata_uom-owner-390.png / -1440.png |
| 123 | `/masterdata/formulas` | owner | Recipes (advanced) | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✗ | ✗ | fail | fail | 9: "All recipes" (wizard, recipe page) and /masterdata/recipes open "Recipes (advanced)"; 10: the normal recipe path ends on the advanced list | masterdata_recipes-owner-390.png / -1440.png |
| 124 | `/masterdata/recipes/new` | owner | 1. Which product? | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✗ | fail | fail | 10: "← All recipes" opens Recipes (advanced) (/masterdata/formulas) | masterdata_recipes_new-owner-390.png / -1440.png |
| 125 | `/masterdata/formulas/[id]/revisions/[id]` | owner | Version 1 of the recipe for Acapulco Soap 135 g | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | masterdata_formulas_rev-owner-390.png / -1440.png |
| 126 | `/masterdata/routings/[id]/revisions/[id]` | owner | Version 1 of the steps for Acapulco Soap 135 g | ✓ | ✓ | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: disposition, quarantine | masterdata_routings_rev-owner-390.png / -1440.png |
| 127 | `/masterdata/products/[id]/skus/[id]` | owner | Acapulco Soap 135 g | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | fail | **pass** |  | masterdata_products_sku-owner-390.png / -1440.png |
| 128 | `/analytics/trends` | owner | Compare over time | ✓ | – | ✗ | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 3: 40 visible fields; 5: FEFO; 7: 136 targets <44px: INPUT(16x16), INPUT(16x16), INPUT(16x16) | analytics_trends-owner-390.png / -1440.png |
| 129 | `/analytics/sales` | owner | Sales numbers | ✓ | – | – | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | fail | fail | 5: KPI; 7: 7 targets <44px: Chart(57x34), Table(57x34), Chart(57x34) | analytics_sales-owner-390.png / -1440.png |
| 130 | `/masterdata/recipes/[id]` | owner | Recipe: Acapulco Soap 135 g | ✓ | ✓ | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | fail | fail | 5: disposition, quarantine | masterdata_recipes_id-owner-390.png / -1440.png |

## Menu map per role (drawer at 390; same entries at 820; desktop tabs + section menus at 1440)

Frame at all three widths: every top-bar, tab-row, drawer and bottom-bar target measured 44 px or more (bottom tabs 62 px). Phones: Menu · logo · Scan · bell · avatar (To approve is a Home tab). 820: adds sync icon, "To approve" and "Messages" with words; Home tab row shows Overview · Problems & alerts · More only. 1440: 5 destination pills, site selector, Scan / sync / To approve / bell as icons, avatar; Home tabs Overview · Problems & alerts · Help & my account. No screen is listed twice in any role's menu; no entry leads to a superseded screen; every menu word equals its screen title except the 4 listed dynamic titles.

| Role | Items now (unfolded + under Advanced) | Before | Destinations | Sub-menus | Duplicate doors | Word ≠ title (unlisted) | Leads to old screen | Phone tab bar | Phone Home tab row |
|---|---|---|---|---|---|---|---|---|---|
| owner | 113 (103 + 10) | 120 | 5 | 18 | 0 | 0 | 0 | Home · Operations · Inventory · Sales · Menu | Overview · To approve 17 · Problems & alerts · More |
| manager.nfd | 98 (89 + 9) | 109 | 5 | 17 | 0 | 0 | 0 | Home · Operations · Inventory · Sales · Menu | Overview · To approve 8 · Problems & alerts · More |
| qa.nfd | 80 (72 + 8) | 86 | 5 | 14 | 0 | 0 | 0 | Home · 10 Quality check · Operations · Scan · Menu | Overview · To approve 4 · Problems & alerts · More |
| auditor | 96 (86 + 10) | 107 | 5 | 17 | 0 | 0 | 0 | Home · Operations · Inventory · Sales · Menu | Overview · Problems & alerts · More |
| admin | 80 (73 + 7) | 84 | 5 | 15 | 0 | 0 | 0 | Home · Operations · Inventory · Sales · Menu | Overview · To approve 1 · Problems & alerts · More |
| sales | 50 (44 + 6) | 52 | 5 | 12 | 0 | 0 | 0 | Home · Operations · Inventory · Sales · Menu | Overview · Problems & alerts · More |
| finance | 40 (35 + 5) | 42 | 4 | 9 | 0 | 0 | 0 | Home · Operations · Sales · Menu | Overview · To approve 4 · Problems & alerts · More |
| warehouse.nfd | 28 (28 + 0) | 29 | 3 | 5 | 0 | 0 | 0 | Home · Receive · Scan · Inventory · Menu | – |
| operator.nfd | 10 (10 + 0) | 10 | 3 | 1 | 0 | 0 | 0 | Home · My work · Today · Scan · Menu | – |
| floor.nfd | 0 | 0 | – | – | – | – | – | none (lands on /floor, no frame) | – |

### owner

- Lands on `/dashboard`.
- Top bar 390: Reset demo data -> /admin/demo [97x44] · Open menu ->  [44x44] · Bryel's Care home -> /dashboard [44x44] · Scan or search -> /inventory/scan [79x44] · Messages, 6 unread -> /notifications [44x44] · Account ->  [44x44]
- Top bar 820: Reset demo data -> /admin/demo [97x44] · Open menu ->  [44x44] · Bryel's Care home -> /dashboard [156x44] · Scan or search -> /inventory/scan [141x44] · Sync status: Synced. Open sync -> /sync [44x44] · To approve, 17 waiting -> /approvals [118x44] · Messages, 6 unread -> /notifications [112x44] · Account ->  [44x44]
- Top bar 1440: Reset demo data -> /admin/demo [97x44] · Bryel's Care home -> /dashboard [156x44] · Home -> /dashboard [87x44] · Operations -> /operations [118x44] · Inventory -> /inventory [109x44] · Sales & Customers -> /sales [167x44] · Management -> /management [132x44] · Scan or search -> /inventory/scan [44x44] · Sync status: Synced. Open sync -> /sync [44x44] · To approve, 17 waiting -> /approvals [44x44] · Messages, 6 unread -> /notifications [44x44] · Account ->  [44x44]
- Phone tab bar: Home -> /dashboard · Operations -> /operations · Inventory -> /inventory · Sales -> /sales · Menu -> drawer
- Phone Home tab row (390): Overview -> /dashboard · To approve 17 -> /approvals · Problems & alerts -> /action-centre · More -> drawer
- Drawer sync chip: "All saved"; drawer targets under 44 px: 0

| Destination › section | Menu word → route | Screen title (H1) | Flag |
|---|---|---|---|
| Home | Overview → `/dashboard` | Good afternoon, Ana | dynamic title (greeting), listed exception |
| Home | To approve → `/approvals` | To approve |  |
| Home | Messages → `/notifications` | Messages |  |
| Home | Problems & alerts → `/action-centre` | Problems & alerts |  |
| Home › Help & my account | Help → `/help` | Help |  |
| Home › Help & my account | My account → `/account` | My account |  |
| Home › Help & my account | Working without signal → `/sync` | Working without signal |  |
| Home › Help & my account | Expense claims → `/finance/expenses` | Expense claims |  |
| Operations | Operations Center → `/operations` | Operations Center |  |
| Operations | Production orders → `/production/orders` | Production orders |  |
| Operations | Today → `/production/today` | Today |  |
| Operations | Rejects → `/production/defects` | Rejects |  |
| Operations | Check a batch or delivery → `/quality` | Check a batch or delivery |  |
| Operations | Floor screen (TV) → `/floor` | Bryel's Care · North Fields Plant | dynamic title (site name), listed exception |
| Operations › Receiving | Deliveries coming → `/procurement/expected` | Deliveries coming |  |
| Operations › Receiving | Receive a delivery → `/inventory/receive` | Receive a delivery |  |
| Operations › Receiving | Deliveries received → `/inventory/receipts` | Deliveries received |  |
| Operations › Receiving | Put away → `/inventory/receive/put-away` | Put away |  |
| Operations › Quality | Quality tests → `/quality/inspections` | Quality tests |  |
| Operations › Quality | Problem reports → `/quality/deviations` | Problem reports |  |
| Operations › Quality | Stopped by QA → `/quality/holds` | Stopped by QA |  |
| Operations › Quality | Decide many lots at once → `/quality/bulk` | Decide many lots at once |  |
| Operations › Quality | Where it came from and where it went → `/quality/trace` | Where it came from and where it went |  |
| Operations › Quality | Customer complaints → `/quality/complaints` | Customer complaints |  |
| Operations › Quality | Who received it (recall check) → `/quality/recall` | Who received it (recall check) |  |
| Operations › Quality | Product recalls → `/quality/recalls` | Product recalls |  |
| Operations › Quality | Fix-and-prevent plans → `/quality/capa` | Fix-and-prevent plans |  |
| Operations › Quality | Change requests → `/quality/changes` | Change requests |  |
| Operations › Packing & dispatch | Boxing → `/warehouse/packs` | Boxing |  |
| Operations › Packing & dispatch | Repack for a customer → `/warehouse/repack` | Repack for a customer |  |
| Operations › Packing & dispatch | Check the labels in an area → `/quality/label-verification` | Check the labels in an area |  |
| Operations › Packing & dispatch | To get from shelf → `/sales/picking` | To get from shelf |  |
| Operations › Packing & dispatch | Send out → `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries → `/sales/shipments` | Deliveries |  |
| Operations › Maintenance | Maintenance → `/maintenance` | Maintenance |  |
| Operations › Maintenance | Regular maintenance → `/maintenance/plans` | Regular maintenance |  |
| Operations › Maintenance | Repair jobs → `/maintenance/work-orders` | Repair jobs |  |
| Operations › Maintenance | Spare parts → `/maintenance/spare-parts` | Spare parts |  |
| Inventory | Stock → `/inventory` | Raw materials | opens on the "Raw materials" tab; listed exception |
| Inventory | Scan or search → `/inventory/scan` | Scan or search |  |
| Inventory | Move stock → `/inventory/move` | Move stock |  |
| Inventory | Warehouse sections → `/warehouse` | Warehouse sections |  |
| Inventory › More stock lists | Shelves → `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks → `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Can we deliver? → `/inventory/availability` | Can we deliver? |  |
| Inventory › More stock lists | Expiring soon → `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | Which one to use first / set aside → `/inventory/lots/reservations` | Which one to use first / set aside |  |
| Inventory › More stock lists | Stock changes → `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts → `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Fix stock → `/inventory/adjustments` | Fix stock |  |
| Inventory › Counts & labels | Labels printed → `/labels` | Labels printed |  |
| Sales & Customers | Customer orders → `/sales` | Customer orders |  |
| Sales & Customers | Customers → `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board → `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Price offers → `/sales/quotations` | Price offers |  |
| Sales & Customers › Quotes, prices & returns | Prices → `/sales/price-lists` | Prices |  |
| Sales & Customers › Quotes, prices & returns | Customer returns → `/sales/returns` | Customer returns |  |
| Sales & Customers › Billing & payments | Invoices → `/finance/invoices` | Invoices |  |
| Sales & Customers › Billing & payments | Payments → `/finance/payments` | Payments |  |
| Sales & Customers › Billing & payments | Customer statements → `/finance/statements` | Customer statements |  |
| Sales & Customers › Billing & payments | Credits (money back) → `/finance/credit-notes` | Credits (money back) |  |
| Management | Management → `/management` | Management |  |
| Management › Reports & analytics | Business overview → `/analytics/overview` | Business overview |  |
| Management › Reports & analytics | Reports → `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time → `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print → `/reports` | Lists to download or print |  |
| Management › Reports & analytics › Advanced | Lists sent by email → `/reports/schedules` | Lists sent by email | folded under Advanced |
| Management › Reports & analytics › Advanced | What each number means → `/analytics/definitions` | What each number means | folded under Advanced |
| Management › Purchasing | Purchasing → `/procurement` | Purchasing |  |
| Management › Purchasing | Requests to buy → `/procurement/requests` | Requests to buy |  |
| Management › Purchasing | Purchase orders → `/procurement/orders` | Purchase orders |  |
| Management › Purchasing | Send back to supplier → `/procurement/returns` | Send back to supplier |  |
| Management › Purchasing | Suppliers we may buy from → `/procurement/suppliers` | Suppliers we may buy from |  |
| Management › Purchasing | Running low → `/procurement/reorder` | Running low |  |
| Management › Purchasing › Advanced | How suppliers do → `/procurement/performance` | How suppliers do | folded under Advanced |
| Management › Purchasing › Advanced | Sales guess → `/procurement/forecast` | Sales guess | folded under Advanced |
| Management › Finance | Money → `/finance` | Money |  |
| Management › Finance | Supplier bills → `/finance/bills` | Supplier bills |  |
| Management › Finance | Close the month → `/finance/periods` | Close the month |  |
| Management › Finance › Advanced | Tax rates → `/finance/tax` | Tax rates | folded under Advanced |
| Management › Production setup | New recipe → `/masterdata/recipes/new` | 1. Which product? | wizard question "1. Which product?"; listed exception |
| Management › Production setup | How-to sheets → `/masterdata/work-instructions` | How-to sheets |  |
| Management › Production setup | Quality checks for each item → `/masterdata/inspection-plans` | Quality checks for each item |  |
| Management › Production setup | Equipment → `/masterdata/equipment` | Equipment |  |
| Management › Production setup › Advanced | Recipes (advanced) → `/masterdata/formulas` | Recipes (advanced) | folded under Advanced; advanced editor kept (ADR-096) |
| Management › Production setup › Advanced | Steps (advanced) → `/masterdata/routings` | Steps (advanced) | folded under Advanced; advanced editor kept (ADR-096) |
| Management › Master data | Materials → `/masterdata/materials` | Materials |  |
| Management › Master data | Products → `/masterdata/products` | Products |  |
| Management › Master data | Locations → `/masterdata/locations` | Locations |  |
| Management › Master data | Sites → `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses → `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines → `/masterdata/lines` | Making areas / lines |  |
| Management › Master data › Advanced | Units → `/masterdata/uom` | Units | folded under Advanced |
| Management › Master data › Advanced | Choice lists → `/masterdata/lists` | Choice lists | folded under Advanced |
| Management › Master data › Advanced | Reasons → `/masterdata/reason-codes` | Reasons | folded under Advanced |
| Management › People & access | People who use the app → `/admin/users` | People who use the app |  |
| Management › People & access | Roles (what each job may do) → `/admin/roles` | Roles (what each job may do) |  |
| Management › Rules and settings | Settings → `/admin/settings` | Settings |  |
| Management › Rules and settings | Who says OK to what → `/admin/approval-rules` | Who says OK to what |  |
| Management › Rules and settings | Who gets which message → `/admin/notification-rules` | Who gets which message |  |
| Management › Rules and settings | Labels and printouts → `/admin/templates` | Labels and printouts |  |
| Management › Rules and settings | How record numbers look → `/admin/numbering` | How record numbers look |  |
| Management › Rules and settings | History of changes → `/admin/audit` | History of changes |  |
| Management › Planning tools | Production plan → `/production/plan` | Production plan |  |
| Management › Planning tools | Batch records → `/production` | Batch records |  |
| Management › IT and system | Who is signed in → `/admin/sessions` | Who is signed in |  |
| Management › IT and system | Sign-in safety → `/admin/security` | Sign-in safety |  |
| Management › IT and system | Phones and tablets → `/admin/devices` | Phones and tablets |  |
| Management › IT and system | Phone changes to check → `/sync/conflicts` | Phone changes to check |  |
| Management › IT and system | Health of the system → `/admin/diagnostics` | Health of the system |  |
| Management › IT and system | Keeping and deleting old records → `/admin/retention` | Keeping and deleting old records |  |
| Management › IT and system | Load data from a spreadsheet → `/admin/imports` | Load data from a spreadsheet |  |
| Management › IT and system | Old paper documents → `/admin/imports/legacy-documents` | Old paper documents |  |

### manager.nfd

- Lands on `/dashboard`.
- Top bar 390: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [44x44] · Scan or search -> /inventory/scan [79x44] · Messages, 45 unread -> /notifications [44x44] · Account ->  [44x44]
- Top bar 820: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [156x44] · Scan or search -> /inventory/scan [141x44] · Sync status: Synced. Open sync -> /sync [44x44] · To approve, 10 waiting -> /approvals [118x44] · Messages, 12 unread -> /notifications [112x44] · Account ->  [44x44]
- Top bar 1440: Bryel's Care home -> /dashboard [156x44] · Home -> /dashboard [87x44] · Operations -> /operations [118x44] · Inventory -> /inventory [109x44] · Sales & Customers -> /sales [167x44] · Management -> /management [132x44] · Scan or search -> /inventory/scan [44x44] · Sync status: Synced. Open sync -> /sync [44x44] · To approve, 8 waiting -> /approvals [44x44] · Messages, 45 unread -> /notifications [44x44] · Account ->  [44x44]
- Phone tab bar: Home -> /dashboard · Operations -> /operations · Inventory -> /inventory · Sales -> /sales · Menu -> drawer
- Phone Home tab row (390): Overview -> /dashboard · To approve 8 -> /approvals · Problems & alerts -> /action-centre · More -> drawer
- Drawer sync chip: "All saved"; drawer targets under 44 px: 0

| Destination › section | Menu word → route | Screen title (H1) | Flag |
|---|---|---|---|
| Home | Overview → `/dashboard` | Good afternoon, Ana | dynamic title (greeting), listed exception |
| Home | To approve → `/approvals` | To approve |  |
| Home | Messages → `/notifications` | Messages |  |
| Home | Problems & alerts → `/action-centre` | Problems & alerts |  |
| Home › Help & my account | Help → `/help` | Help |  |
| Home › Help & my account | My account → `/account` | My account |  |
| Home › Help & my account | Working without signal → `/sync` | Working without signal |  |
| Home › Help & my account | Expense claims → `/finance/expenses` | Expense claims |  |
| Operations | Operations Center → `/operations` | Operations Center |  |
| Operations | Production orders → `/production/orders` | Production orders |  |
| Operations | Today → `/production/today` | Today |  |
| Operations | Rejects → `/production/defects` | Rejects |  |
| Operations | Check a batch or delivery → `/quality` | Check a batch or delivery |  |
| Operations | Floor screen (TV) → `/floor` | Bryel's Care · North Fields Plant | dynamic title (site name), listed exception |
| Operations › Receiving | Deliveries coming → `/procurement/expected` | Deliveries coming |  |
| Operations › Receiving | Receive a delivery → `/inventory/receive` | Receive a delivery |  |
| Operations › Receiving | Deliveries received → `/inventory/receipts` | Deliveries received |  |
| Operations › Receiving | Put away → `/inventory/receive/put-away` | Put away |  |
| Operations › Quality | Quality tests → `/quality/inspections` | Quality tests |  |
| Operations › Quality | Problem reports → `/quality/deviations` | Problem reports |  |
| Operations › Quality | Stopped by QA → `/quality/holds` | Stopped by QA |  |
| Operations › Quality | Where it came from and where it went → `/quality/trace` | Where it came from and where it went |  |
| Operations › Quality | Customer complaints → `/quality/complaints` | Customer complaints |  |
| Operations › Quality | Who received it (recall check) → `/quality/recall` | Who received it (recall check) |  |
| Operations › Quality | Product recalls → `/quality/recalls` | Product recalls |  |
| Operations › Quality | Fix-and-prevent plans → `/quality/capa` | Fix-and-prevent plans |  |
| Operations › Quality | Change requests → `/quality/changes` | Change requests |  |
| Operations › Packing & dispatch | Boxing → `/warehouse/packs` | Boxing |  |
| Operations › Packing & dispatch | Repack for a customer → `/warehouse/repack` | Repack for a customer |  |
| Operations › Packing & dispatch | Check the labels in an area → `/quality/label-verification` | Check the labels in an area |  |
| Operations › Packing & dispatch | To get from shelf → `/sales/picking` | To get from shelf |  |
| Operations › Packing & dispatch | Send out → `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries → `/sales/shipments` | Deliveries |  |
| Operations › Maintenance | Maintenance → `/maintenance` | Maintenance |  |
| Operations › Maintenance | Regular maintenance → `/maintenance/plans` | Regular maintenance |  |
| Operations › Maintenance | Repair jobs → `/maintenance/work-orders` | Repair jobs |  |
| Operations › Maintenance | Spare parts → `/maintenance/spare-parts` | Spare parts |  |
| Inventory | Stock → `/inventory` | Raw materials | opens on the "Raw materials" tab; listed exception |
| Inventory | Scan or search → `/inventory/scan` | Scan or search |  |
| Inventory | Move stock → `/inventory/move` | Move stock |  |
| Inventory | Warehouse sections → `/warehouse` | Warehouse sections |  |
| Inventory › More stock lists | Shelves → `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks → `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Can we deliver? → `/inventory/availability` | Can we deliver? |  |
| Inventory › More stock lists | Expiring soon → `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | Which one to use first / set aside → `/inventory/lots/reservations` | Which one to use first / set aside |  |
| Inventory › More stock lists | Stock changes → `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts → `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Fix stock → `/inventory/adjustments` | Fix stock |  |
| Inventory › Counts & labels | Labels printed → `/labels` | Labels printed |  |
| Sales & Customers | Customer orders → `/sales` | Customer orders |  |
| Sales & Customers | Customers → `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board → `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Price offers → `/sales/quotations` | Price offers |  |
| Sales & Customers › Quotes, prices & returns | Customer returns → `/sales/returns` | Customer returns |  |
| Sales & Customers › Billing & payments | Invoices → `/finance/invoices` | Invoices |  |
| Sales & Customers › Billing & payments | Customer statements → `/finance/statements` | Customer statements |  |
| Management | Management → `/management` | Management |  |
| Management › Reports & analytics | Business overview → `/analytics/overview` | Business overview |  |
| Management › Reports & analytics | Reports → `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time → `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print → `/reports` | Lists to download or print |  |
| Management › Reports & analytics › Advanced | Lists sent by email → `/reports/schedules` | Lists sent by email | folded under Advanced |
| Management › Reports & analytics › Advanced | What each number means → `/analytics/definitions` | What each number means | folded under Advanced |
| Management › Purchasing | Purchasing → `/procurement` | Purchasing |  |
| Management › Purchasing | Requests to buy → `/procurement/requests` | Requests to buy |  |
| Management › Purchasing | Purchase orders → `/procurement/orders` | Purchase orders |  |
| Management › Purchasing | Send back to supplier → `/procurement/returns` | Send back to supplier |  |
| Management › Purchasing | Suppliers we may buy from → `/procurement/suppliers` | Suppliers we may buy from |  |
| Management › Purchasing | Running low → `/procurement/reorder` | Running low |  |
| Management › Purchasing › Advanced | How suppliers do → `/procurement/performance` | How suppliers do | folded under Advanced |
| Management › Purchasing › Advanced | Sales guess → `/procurement/forecast` | Sales guess | folded under Advanced |
| Management › Finance | Money → `/finance` | Money |  |
| Management › Finance | Supplier bills → `/finance/bills` | Supplier bills |  |
| Management › Production setup | New recipe → `/masterdata/recipes/new` | 1. Which product? | wizard question "1. Which product?"; listed exception |
| Management › Production setup | How-to sheets → `/masterdata/work-instructions` | How-to sheets |  |
| Management › Production setup | Quality checks for each item → `/masterdata/inspection-plans` | Quality checks for each item |  |
| Management › Production setup | Equipment → `/masterdata/equipment` | Equipment |  |
| Management › Production setup › Advanced | Recipes (advanced) → `/masterdata/formulas` | Recipes (advanced) | folded under Advanced; advanced editor kept (ADR-096) |
| Management › Production setup › Advanced | Steps (advanced) → `/masterdata/routings` | Steps (advanced) | folded under Advanced; advanced editor kept (ADR-096) |
| Management › Master data | Materials → `/masterdata/materials` | Materials |  |
| Management › Master data | Products → `/masterdata/products` | Products |  |
| Management › Master data | Locations → `/masterdata/locations` | Locations |  |
| Management › Master data | Sites → `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses → `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines → `/masterdata/lines` | Making areas / lines |  |
| Management › Master data › Advanced | Units → `/masterdata/uom` | Units | folded under Advanced |
| Management › Master data › Advanced | Choice lists → `/masterdata/lists` | Choice lists | folded under Advanced |
| Management › Master data › Advanced | Reasons → `/masterdata/reason-codes` | Reasons | folded under Advanced |
| Management › People & access | People who use the app → `/admin/users` | People who use the app |  |
| Management › People & access | Roles (what each job may do) → `/admin/roles` | Roles (what each job may do) |  |
| Management › Rules and settings | Who says OK to what → `/admin/approval-rules` | Who says OK to what |  |
| Management › Rules and settings | Who gets which message → `/admin/notification-rules` | Who gets which message |  |
| Management › Rules and settings | Labels and printouts → `/admin/templates` | Labels and printouts |  |
| Management › Rules and settings | How record numbers look → `/admin/numbering` | How record numbers look |  |
| Management › Rules and settings | History of changes → `/admin/audit` | History of changes |  |
| Management › Planning tools | Production plan → `/production/plan` | Production plan |  |
| Management › Planning tools | Batch records → `/production` | Batch records |  |

### qa.nfd

- Lands on `/dashboard`.
- Top bar 390: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [44x44] · Scan or search -> /inventory/scan [79x44] · Messages, 8 unread -> /notifications [44x44] · Account ->  [44x44]
- Top bar 820: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [156x44] · Scan or search -> /inventory/scan [141x44] · Sync status: Synced. Open sync -> /sync [44x44] · To approve, 4 waiting -> /approvals [118x44] · Messages, 8 unread -> /notifications [112x44] · Account ->  [44x44]
- Top bar 1440: Bryel's Care home -> /dashboard [156x44] · Home -> /dashboard [87x44] · Operations -> /operations [118x44] · Inventory -> /inventory [109x44] · Sales & Customers -> /sales [167x44] · Management -> /management [132x44] · Scan or search -> /inventory/scan [44x44] · Sync status: Synced. Open sync -> /sync [44x44] · To approve, 4 waiting -> /approvals [44x44] · Messages, 8 unread -> /notifications [44x44] · Account ->  [44x44]
- Phone tab bar: Home -> /dashboard · 10 Quality check -> /quality · Operations -> /operations · Scan -> /inventory/scan · Menu -> drawer
- Phone Home tab row (390): Overview -> /dashboard · To approve 4 -> /approvals · Problems & alerts -> /action-centre · More -> drawer
- Drawer sync chip: "All saved"; drawer targets under 44 px: 0

| Destination › section | Menu word → route | Screen title (H1) | Flag |
|---|---|---|---|
| Home | Overview → `/dashboard` | Good afternoon, Ana | dynamic title (greeting), listed exception |
| Home | To approve → `/approvals` | To approve |  |
| Home | Messages → `/notifications` | Messages |  |
| Home | Problems & alerts → `/action-centre` | Problems & alerts |  |
| Home › Help & my account | Help → `/help` | Help |  |
| Home › Help & my account | My account → `/account` | My account |  |
| Home › Help & my account | Working without signal → `/sync` | Working without signal |  |
| Home › Help & my account | Expense claims → `/finance/expenses` | Expense claims |  |
| Operations | Operations Center → `/operations` | Operations Center |  |
| Operations | Production orders → `/production/orders` | Production orders |  |
| Operations | Today → `/production/today` | Today |  |
| Operations | Rejects → `/production/defects` | Rejects |  |
| Operations | Check a batch or delivery → `/quality` | Check a batch or delivery |  |
| Operations | Floor screen (TV) → `/floor` | Bryel's Care · North Fields Plant | dynamic title (site name), listed exception |
| Operations › Receiving | Deliveries coming → `/procurement/expected` | Deliveries coming |  |
| Operations › Receiving | Deliveries received → `/inventory/receipts` | Deliveries received |  |
| Operations › Quality | Quality tests → `/quality/inspections` | Quality tests |  |
| Operations › Quality | Problem reports → `/quality/deviations` | Problem reports |  |
| Operations › Quality | Stopped by QA → `/quality/holds` | Stopped by QA |  |
| Operations › Quality | Decide many lots at once → `/quality/bulk` | Decide many lots at once |  |
| Operations › Quality | Where it came from and where it went → `/quality/trace` | Where it came from and where it went |  |
| Operations › Quality | Customer complaints → `/quality/complaints` | Customer complaints |  |
| Operations › Quality | Who received it (recall check) → `/quality/recall` | Who received it (recall check) |  |
| Operations › Quality | Product recalls → `/quality/recalls` | Product recalls |  |
| Operations › Quality | Fix-and-prevent plans → `/quality/capa` | Fix-and-prevent plans |  |
| Operations › Quality | Change requests → `/quality/changes` | Change requests |  |
| Operations › Packing & dispatch | Boxing → `/warehouse/packs` | Boxing |  |
| Operations › Packing & dispatch | To get from shelf → `/sales/picking` | To get from shelf |  |
| Operations › Packing & dispatch | Send out → `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries → `/sales/shipments` | Deliveries |  |
| Operations › Maintenance | Maintenance → `/maintenance` | Maintenance |  |
| Operations › Maintenance | Regular maintenance → `/maintenance/plans` | Regular maintenance |  |
| Operations › Maintenance | Repair jobs → `/maintenance/work-orders` | Repair jobs |  |
| Operations › Maintenance | Spare parts → `/maintenance/spare-parts` | Spare parts |  |
| Inventory | Stock → `/inventory` | Raw materials | opens on the "Raw materials" tab; listed exception |
| Inventory | Scan or search → `/inventory/scan` | Scan or search |  |
| Inventory | Warehouse sections → `/warehouse` | Warehouse sections |  |
| Inventory › More stock lists | Shelves → `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks → `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Can we deliver? → `/inventory/availability` | Can we deliver? |  |
| Inventory › More stock lists | Expiring soon → `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | Which one to use first / set aside → `/inventory/lots/reservations` | Which one to use first / set aside |  |
| Inventory › More stock lists | Stock changes → `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts → `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Fix stock → `/inventory/adjustments` | Fix stock |  |
| Inventory › Counts & labels | Labels printed → `/labels` | Labels printed |  |
| Sales & Customers | Customer orders → `/sales` | Customer orders |  |
| Sales & Customers | Customers → `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board → `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Customer returns → `/sales/returns` | Customer returns |  |
| Management | Management → `/management` | Management |  |
| Management › Reports & analytics | Business overview → `/analytics/overview` | Business overview |  |
| Management › Reports & analytics | Reports → `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time → `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print → `/reports` | Lists to download or print |  |
| Management › Reports & analytics › Advanced | Lists sent by email → `/reports/schedules` | Lists sent by email | folded under Advanced |
| Management › Reports & analytics › Advanced | What each number means → `/analytics/definitions` | What each number means | folded under Advanced |
| Management › Purchasing | Purchasing → `/procurement` | Purchasing |  |
| Management › Purchasing | Requests to buy → `/procurement/requests` | Requests to buy |  |
| Management › Purchasing | Purchase orders → `/procurement/orders` | Purchase orders |  |
| Management › Purchasing | Send back to supplier → `/procurement/returns` | Send back to supplier |  |
| Management › Purchasing | Suppliers we may buy from → `/procurement/suppliers` | Suppliers we may buy from |  |
| Management › Purchasing › Advanced | How suppliers do → `/procurement/performance` | How suppliers do | folded under Advanced |
| Management › Production setup | How-to sheets → `/masterdata/work-instructions` | How-to sheets |  |
| Management › Production setup | Quality checks for each item → `/masterdata/inspection-plans` | Quality checks for each item |  |
| Management › Production setup | Equipment → `/masterdata/equipment` | Equipment |  |
| Management › Production setup › Advanced | Recipes (advanced) → `/masterdata/formulas` | Recipes (advanced) | folded under Advanced; advanced editor kept (ADR-096) |
| Management › Production setup › Advanced | Steps (advanced) → `/masterdata/routings` | Steps (advanced) | folded under Advanced; advanced editor kept (ADR-096) |
| Management › Master data | Materials → `/masterdata/materials` | Materials |  |
| Management › Master data | Products → `/masterdata/products` | Products |  |
| Management › Master data | Locations → `/masterdata/locations` | Locations |  |
| Management › Master data | Sites → `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses → `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines → `/masterdata/lines` | Making areas / lines |  |
| Management › Master data › Advanced | Units → `/masterdata/uom` | Units | folded under Advanced |
| Management › Master data › Advanced | Choice lists → `/masterdata/lists` | Choice lists | folded under Advanced |
| Management › Master data › Advanced | Reasons → `/masterdata/reason-codes` | Reasons | folded under Advanced |
| Management › Rules and settings | Labels and printouts → `/admin/templates` | Labels and printouts |  |
| Management › Planning tools | Production plan → `/production/plan` | Production plan |  |
| Management › Planning tools | Batch records → `/production` | Batch records |  |

### auditor

- Lands on `/dashboard`.
- Top bar 390: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [44x44] · Scan or search -> /inventory/scan [79x44] · Messages, 0 unread -> /notifications [44x44] · Account ->  [44x44]
- Top bar 820: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [156x44] · Scan or search -> /inventory/scan [141x44] · Sync status: Synced. Open sync -> /sync [44x44] · Messages, 0 unread -> /notifications [112x44] · Account ->  [44x44]
- Top bar 1440: Bryel's Care home -> /dashboard [156x44] · Home -> /dashboard [87x44] · Operations -> /operations [118x44] · Inventory -> /inventory [109x44] · Sales & Customers -> /sales [167x44] · Management -> /management [132x44] · Scan or search -> /inventory/scan [44x44] · Sync status: Synced. Open sync -> /sync [44x44] · Messages, 0 unread -> /notifications [44x44] · Account ->  [44x44]
- Phone tab bar: Home -> /dashboard · Operations -> /operations · Inventory -> /inventory · Sales -> /sales · Menu -> drawer
- Phone Home tab row (390): Overview -> /dashboard · Problems & alerts -> /action-centre · More -> drawer
- Drawer sync chip: "All saved"; drawer targets under 44 px: 0

| Destination › section | Menu word → route | Screen title (H1) | Flag |
|---|---|---|---|
| Home | Overview → `/dashboard` | Good afternoon, Ana | dynamic title (greeting), listed exception |
| Home | Messages → `/notifications` | Messages |  |
| Home | Problems & alerts → `/action-centre` | Problems & alerts |  |
| Home › Help & my account | Help → `/help` | Help |  |
| Home › Help & my account | My account → `/account` | My account |  |
| Home › Help & my account | Working without signal → `/sync` | Working without signal |  |
| Operations | Operations Center → `/operations` | Operations Center |  |
| Operations | Production orders → `/production/orders` | Production orders |  |
| Operations | Today → `/production/today` | Today |  |
| Operations | Rejects → `/production/defects` | Rejects |  |
| Operations | Check a batch or delivery → `/quality` | Check a batch or delivery |  |
| Operations | Floor screen (TV) → `/floor` | Bryel's Care · North Fields Plant | dynamic title (site name), listed exception |
| Operations › Receiving | Deliveries coming → `/procurement/expected` | Deliveries coming |  |
| Operations › Receiving | Deliveries received → `/inventory/receipts` | Deliveries received |  |
| Operations › Quality | Quality tests → `/quality/inspections` | Quality tests |  |
| Operations › Quality | Problem reports → `/quality/deviations` | Problem reports |  |
| Operations › Quality | Stopped by QA → `/quality/holds` | Stopped by QA |  |
| Operations › Quality | Where it came from and where it went → `/quality/trace` | Where it came from and where it went |  |
| Operations › Quality | Customer complaints → `/quality/complaints` | Customer complaints |  |
| Operations › Quality | Who received it (recall check) → `/quality/recall` | Who received it (recall check) |  |
| Operations › Quality | Product recalls → `/quality/recalls` | Product recalls |  |
| Operations › Quality | Fix-and-prevent plans → `/quality/capa` | Fix-and-prevent plans |  |
| Operations › Quality | Change requests → `/quality/changes` | Change requests |  |
| Operations › Packing & dispatch | Boxing → `/warehouse/packs` | Boxing |  |
| Operations › Packing & dispatch | To get from shelf → `/sales/picking` | To get from shelf |  |
| Operations › Packing & dispatch | Send out → `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries → `/sales/shipments` | Deliveries |  |
| Operations › Maintenance | Maintenance → `/maintenance` | Maintenance |  |
| Operations › Maintenance | Regular maintenance → `/maintenance/plans` | Regular maintenance |  |
| Operations › Maintenance | Repair jobs → `/maintenance/work-orders` | Repair jobs |  |
| Operations › Maintenance | Spare parts → `/maintenance/spare-parts` | Spare parts |  |
| Inventory | Stock → `/inventory` | Raw materials | opens on the "Raw materials" tab; listed exception |
| Inventory | Scan or search → `/inventory/scan` | Scan or search |  |
| Inventory | Warehouse sections → `/warehouse` | Warehouse sections |  |
| Inventory › More stock lists | Shelves → `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks → `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Can we deliver? → `/inventory/availability` | Can we deliver? |  |
| Inventory › More stock lists | Expiring soon → `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | Which one to use first / set aside → `/inventory/lots/reservations` | Which one to use first / set aside |  |
| Inventory › More stock lists | Stock changes → `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts → `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Fix stock → `/inventory/adjustments` | Fix stock |  |
| Inventory › Counts & labels | Labels printed → `/labels` | Labels printed |  |
| Sales & Customers | Customer orders → `/sales` | Customer orders |  |
| Sales & Customers | Customers → `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board → `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Price offers → `/sales/quotations` | Price offers |  |
| Sales & Customers › Quotes, prices & returns | Prices → `/sales/price-lists` | Prices |  |
| Sales & Customers › Quotes, prices & returns | Customer returns → `/sales/returns` | Customer returns |  |
| Sales & Customers › Billing & payments | Invoices → `/finance/invoices` | Invoices |  |
| Sales & Customers › Billing & payments | Payments → `/finance/payments` | Payments |  |
| Sales & Customers › Billing & payments | Customer statements → `/finance/statements` | Customer statements |  |
| Sales & Customers › Billing & payments | Credits (money back) → `/finance/credit-notes` | Credits (money back) |  |
| Management | Management → `/management` | Management |  |
| Management › Reports & analytics | Business overview → `/analytics/overview` | Business overview |  |
| Management › Reports & analytics | Reports → `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time → `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print → `/reports` | Lists to download or print |  |
| Management › Reports & analytics › Advanced | Lists sent by email → `/reports/schedules` | Lists sent by email | folded under Advanced |
| Management › Reports & analytics › Advanced | What each number means → `/analytics/definitions` | What each number means | folded under Advanced |
| Management › Purchasing | Purchasing → `/procurement` | Purchasing |  |
| Management › Purchasing | Requests to buy → `/procurement/requests` | Requests to buy |  |
| Management › Purchasing | Purchase orders → `/procurement/orders` | Purchase orders |  |
| Management › Purchasing | Send back to supplier → `/procurement/returns` | Send back to supplier |  |
| Management › Purchasing | Suppliers we may buy from → `/procurement/suppliers` | Suppliers we may buy from |  |
| Management › Purchasing | Running low → `/procurement/reorder` | Running low |  |
| Management › Purchasing › Advanced | How suppliers do → `/procurement/performance` | How suppliers do | folded under Advanced |
| Management › Purchasing › Advanced | Sales guess → `/procurement/forecast` | Sales guess | folded under Advanced |
| Management › Finance | Money → `/finance` | Money |  |
| Management › Finance | Supplier bills → `/finance/bills` | Supplier bills |  |
| Management › Finance | Close the month → `/finance/periods` | Close the month |  |
| Management › Finance › Advanced | Tax rates → `/finance/tax` | Tax rates | folded under Advanced |
| Management › Production setup | How-to sheets → `/masterdata/work-instructions` | How-to sheets |  |
| Management › Production setup | Quality checks for each item → `/masterdata/inspection-plans` | Quality checks for each item |  |
| Management › Production setup | Equipment → `/masterdata/equipment` | Equipment |  |
| Management › Production setup › Advanced | Recipes (advanced) → `/masterdata/formulas` | Recipes (advanced) | folded under Advanced; advanced editor kept (ADR-096) |
| Management › Production setup › Advanced | Steps (advanced) → `/masterdata/routings` | Steps (advanced) | folded under Advanced; advanced editor kept (ADR-096) |
| Management › Master data | Materials → `/masterdata/materials` | Materials |  |
| Management › Master data | Products → `/masterdata/products` | Products |  |
| Management › Master data | Locations → `/masterdata/locations` | Locations |  |
| Management › Master data | Sites → `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses → `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines → `/masterdata/lines` | Making areas / lines |  |
| Management › Master data › Advanced | Units → `/masterdata/uom` | Units | folded under Advanced |
| Management › Master data › Advanced | Choice lists → `/masterdata/lists` | Choice lists | folded under Advanced |
| Management › Master data › Advanced | Reasons → `/masterdata/reason-codes` | Reasons | folded under Advanced |
| Management › People & access | People who use the app → `/admin/users` | People who use the app |  |
| Management › People & access | Roles (what each job may do) → `/admin/roles` | Roles (what each job may do) |  |
| Management › Rules and settings | Settings → `/admin/settings` | Settings |  |
| Management › Rules and settings | Who says OK to what → `/admin/approval-rules` | Who says OK to what |  |
| Management › Rules and settings | Who gets which message → `/admin/notification-rules` | Who gets which message |  |
| Management › Rules and settings | Labels and printouts → `/admin/templates` | Labels and printouts |  |
| Management › Rules and settings | How record numbers look → `/admin/numbering` | How record numbers look |  |
| Management › Rules and settings | History of changes → `/admin/audit` | History of changes |  |
| Management › Planning tools | Production plan → `/production/plan` | Production plan |  |
| Management › Planning tools | Batch records → `/production` | Batch records |  |

### admin

- Lands on `/dashboard`.
- Top bar 390: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [44x44] · Scan or search -> /inventory/scan [79x44] · Messages, 1 unread -> /notifications [44x44] · Account ->  [44x44]
- Top bar 820: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [156x44] · Scan or search -> /inventory/scan [141x44] · Sync status: Synced. Open sync -> /sync [44x44] · To approve, 1 waiting -> /approvals [118x44] · Messages, 1 unread -> /notifications [112x44] · Account ->  [44x44]
- Top bar 1440: Bryel's Care home -> /dashboard [156x44] · Home -> /dashboard [87x44] · Operations -> /operations [118x44] · Inventory -> /inventory [109x44] · Sales & Customers -> /sales [167x44] · Management -> /management [132x44] · Scan or search -> /inventory/scan [44x44] · Sync status: Synced. Open sync -> /sync [44x44] · To approve, 1 waiting -> /approvals [44x44] · Messages, 1 unread -> /notifications [44x44] · Account ->  [44x44]
- Phone tab bar: Home -> /dashboard · Operations -> /operations · Inventory -> /inventory · Sales -> /sales · Menu -> drawer
- Phone Home tab row (390): Overview -> /dashboard · To approve 1 -> /approvals · Problems & alerts -> /action-centre · More -> drawer
- Drawer sync chip: "All saved"; drawer targets under 44 px: 0

| Destination › section | Menu word → route | Screen title (H1) | Flag |
|---|---|---|---|
| Home | Overview → `/dashboard` | Good afternoon, Ana | dynamic title (greeting), listed exception |
| Home | To approve → `/approvals` | To approve |  |
| Home | Messages → `/notifications` | Messages |  |
| Home | Problems & alerts → `/action-centre` | Problems & alerts |  |
| Home › Help & my account | Help → `/help` | Help |  |
| Home › Help & my account | My account → `/account` | My account |  |
| Home › Help & my account | Working without signal → `/sync` | Working without signal |  |
| Operations | Operations Center → `/operations` | Operations Center |  |
| Operations | Production orders → `/production/orders` | Production orders |  |
| Operations | Today → `/production/today` | Today |  |
| Operations | Rejects → `/production/defects` | Rejects |  |
| Operations | Check a batch or delivery → `/quality` | Check a batch or delivery |  |
| Operations | Floor screen (TV) → `/floor` | Bryel's Care · North Fields Plant | dynamic title (site name), listed exception |
| Operations › Receiving | Deliveries received → `/inventory/receipts` | Deliveries received |  |
| Operations › Quality | Stopped by QA → `/quality/holds` | Stopped by QA |  |
| Operations › Quality | Where it came from and where it went → `/quality/trace` | Where it came from and where it went |  |
| Operations › Quality | Who received it (recall check) → `/quality/recall` | Who received it (recall check) |  |
| Operations › Packing & dispatch | Boxing → `/warehouse/packs` | Boxing |  |
| Operations › Packing & dispatch | To get from shelf → `/sales/picking` | To get from shelf |  |
| Operations › Packing & dispatch | Send out → `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries → `/sales/shipments` | Deliveries |  |
| Operations › Maintenance | Maintenance → `/maintenance` | Maintenance |  |
| Operations › Maintenance | Regular maintenance → `/maintenance/plans` | Regular maintenance |  |
| Operations › Maintenance | Repair jobs → `/maintenance/work-orders` | Repair jobs |  |
| Operations › Maintenance | Spare parts → `/maintenance/spare-parts` | Spare parts |  |
| Inventory | Stock → `/inventory` | Raw materials | opens on the "Raw materials" tab; listed exception |
| Inventory | Scan or search → `/inventory/scan` | Scan or search |  |
| Inventory | Warehouse sections → `/warehouse` | Warehouse sections |  |
| Inventory › More stock lists | Shelves → `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks → `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Can we deliver? → `/inventory/availability` | Can we deliver? |  |
| Inventory › More stock lists | Expiring soon → `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | Which one to use first / set aside → `/inventory/lots/reservations` | Which one to use first / set aside |  |
| Inventory › More stock lists | Stock changes → `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts → `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Fix stock → `/inventory/adjustments` | Fix stock |  |
| Inventory › Counts & labels | Labels printed → `/labels` | Labels printed |  |
| Sales & Customers | Customer orders → `/sales` | Customer orders |  |
| Sales & Customers | Customers → `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board → `/sales/board` | Orders as a board |  |
| Management | Management → `/management` | Management |  |
| Management › Reports & analytics | Business overview → `/analytics/overview` | Business overview |  |
| Management › Reports & analytics | Reports → `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time → `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print → `/reports` | Lists to download or print |  |
| Management › Reports & analytics › Advanced | Lists sent by email → `/reports/schedules` | Lists sent by email | folded under Advanced |
| Management › Reports & analytics › Advanced | What each number means → `/analytics/definitions` | What each number means | folded under Advanced |
| Management › Purchasing | Suppliers we may buy from → `/procurement/suppliers` | Suppliers we may buy from |  |
| Management › Production setup | How-to sheets → `/masterdata/work-instructions` | How-to sheets |  |
| Management › Production setup | Quality checks for each item → `/masterdata/inspection-plans` | Quality checks for each item |  |
| Management › Production setup | Equipment → `/masterdata/equipment` | Equipment |  |
| Management › Production setup › Advanced | Recipes (advanced) → `/masterdata/formulas` | Recipes (advanced) | folded under Advanced; advanced editor kept (ADR-096) |
| Management › Production setup › Advanced | Steps (advanced) → `/masterdata/routings` | Steps (advanced) | folded under Advanced; advanced editor kept (ADR-096) |
| Management › Master data | Materials → `/masterdata/materials` | Materials |  |
| Management › Master data | Products → `/masterdata/products` | Products |  |
| Management › Master data | Locations → `/masterdata/locations` | Locations |  |
| Management › Master data | Sites → `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses → `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines → `/masterdata/lines` | Making areas / lines |  |
| Management › Master data › Advanced | Units → `/masterdata/uom` | Units | folded under Advanced |
| Management › Master data › Advanced | Choice lists → `/masterdata/lists` | Choice lists | folded under Advanced |
| Management › Master data › Advanced | Reasons → `/masterdata/reason-codes` | Reasons | folded under Advanced |
| Management › People & access | People who use the app → `/admin/users` | People who use the app |  |
| Management › People & access | Roles (what each job may do) → `/admin/roles` | Roles (what each job may do) |  |
| Management › Rules and settings | Settings → `/admin/settings` | Settings |  |
| Management › Rules and settings | Who says OK to what → `/admin/approval-rules` | Who says OK to what |  |
| Management › Rules and settings | Who gets which message → `/admin/notification-rules` | Who gets which message |  |
| Management › Rules and settings | Labels and printouts → `/admin/templates` | Labels and printouts |  |
| Management › Rules and settings | How record numbers look → `/admin/numbering` | How record numbers look |  |
| Management › Rules and settings | History of changes → `/admin/audit` | History of changes |  |
| Management › Planning tools | Production plan → `/production/plan` | Production plan |  |
| Management › Planning tools | Batch records → `/production` | Batch records |  |
| Management › IT and system | Who is signed in → `/admin/sessions` | Who is signed in |  |
| Management › IT and system | Sign-in safety → `/admin/security` | Sign-in safety |  |
| Management › IT and system | Phones and tablets → `/admin/devices` | Phones and tablets |  |
| Management › IT and system | Phone changes to check → `/sync/conflicts` | Phone changes to check |  |
| Management › IT and system | Health of the system → `/admin/diagnostics` | Health of the system |  |
| Management › IT and system | Keeping and deleting old records → `/admin/retention` | Keeping and deleting old records |  |
| Management › IT and system | Load data from a spreadsheet → `/admin/imports` | Load data from a spreadsheet |  |
| Management › IT and system | Old paper documents → `/admin/imports/legacy-documents` | Old paper documents |  |

### sales

- Lands on `/dashboard`.
- Top bar 390: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [44x44] · Scan or search -> /inventory/scan [79x44] · Messages, 2 unread -> /notifications [44x44] · Account ->  [44x44]
- Top bar 820: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [156x44] · Scan or search -> /inventory/scan [141x44] · Sync status: Synced. Open sync -> /sync [44x44] · Messages, 2 unread -> /notifications [112x44] · Account ->  [44x44]
- Top bar 1440: Bryel's Care home -> /dashboard [156x44] · Home -> /dashboard [87x44] · Operations -> /operations [118x44] · Inventory -> /inventory [109x44] · Sales & Customers -> /sales [167x44] · Management -> /management [132x44] · Scan or search -> /inventory/scan [44x44] · Sync status: Synced. Open sync -> /sync [44x44] · Messages, 46 unread -> /notifications [44x44] · Account ->  [44x44]
- Phone tab bar: Home -> /dashboard · Operations -> /operations · Inventory -> /inventory · Sales -> /sales · Menu -> drawer
- Phone Home tab row (390): Overview -> /dashboard · Problems & alerts -> /action-centre · More -> drawer
- Drawer sync chip: "All saved"; drawer targets under 44 px: 0

| Destination › section | Menu word → route | Screen title (H1) | Flag |
|---|---|---|---|
| Home | Overview → `/dashboard` | Good afternoon, Ana | dynamic title (greeting), listed exception |
| Home | Messages → `/notifications` | Messages |  |
| Home | Problems & alerts → `/action-centre` | Problems & alerts |  |
| Home › Help & my account | Help → `/help` | Help |  |
| Home › Help & my account | My account → `/account` | My account |  |
| Home › Help & my account | Working without signal → `/sync` | Working without signal |  |
| Home › Help & my account | Expense claims → `/finance/expenses` | Expense claims |  |
| Operations | Operations Center → `/operations` | Operations Center |  |
| Operations | Production orders → `/production/orders` | Production orders |  |
| Operations › Quality | Customer complaints → `/quality/complaints` | Customer complaints |  |
| Operations › Quality | Product recalls → `/quality/recalls` | Product recalls |  |
| Operations › Packing & dispatch | Boxing → `/warehouse/packs` | Boxing |  |
| Operations › Packing & dispatch | To get from shelf → `/sales/picking` | To get from shelf |  |
| Operations › Packing & dispatch | Send out → `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries → `/sales/shipments` | Deliveries |  |
| Inventory | Stock → `/inventory` | Raw materials | opens on the "Raw materials" tab; listed exception |
| Inventory | Scan or search → `/inventory/scan` | Scan or search |  |
| Inventory | Warehouse sections → `/warehouse` | Warehouse sections |  |
| Inventory › More stock lists | Boxes and sacks → `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Can we deliver? → `/inventory/availability` | Can we deliver? |  |
| Inventory › More stock lists | Expiring soon → `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | Which one to use first / set aside → `/inventory/lots/reservations` | Which one to use first / set aside |  |
| Sales & Customers | Customer orders → `/sales` | Customer orders |  |
| Sales & Customers | Customers → `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board → `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Price offers → `/sales/quotations` | Price offers |  |
| Sales & Customers › Quotes, prices & returns | Prices → `/sales/price-lists` | Prices |  |
| Sales & Customers › Quotes, prices & returns | Customer returns → `/sales/returns` | Customer returns |  |
| Sales & Customers › Billing & payments | Invoices → `/finance/invoices` | Invoices |  |
| Sales & Customers › Billing & payments | Payments → `/finance/payments` | Payments |  |
| Sales & Customers › Billing & payments | Customer statements → `/finance/statements` | Customer statements |  |
| Sales & Customers › Billing & payments | Credits (money back) → `/finance/credit-notes` | Credits (money back) |  |
| Management | Management → `/management` | Management |  |
| Management › Reports & analytics | Business overview → `/analytics/overview` | Business overview |  |
| Management › Reports & analytics | Reports → `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time → `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print → `/reports` | Lists to download or print |  |
| Management › Reports & analytics › Advanced | Lists sent by email → `/reports/schedules` | Lists sent by email | folded under Advanced |
| Management › Reports & analytics › Advanced | What each number means → `/analytics/definitions` | What each number means | folded under Advanced |
| Management › Purchasing | (no daily item; only "Advanced") | | EMPTY SECTION |
| Management › Purchasing › Advanced | Sales guess → `/procurement/forecast` | Sales guess | folded under Advanced |
| Management › Finance | Money → `/finance` | Money |  |
| Management › Master data | Products → `/masterdata/products` | Products |  |
| Management › Master data | Sites → `/masterdata/sites` | Sites |  |
| Management › Master data | Warehouses → `/masterdata/warehouses` | Warehouses |  |
| Management › Master data | Making areas / lines → `/masterdata/lines` | Making areas / lines |  |
| Management › Master data › Advanced | Units → `/masterdata/uom` | Units | folded under Advanced |
| Management › Master data › Advanced | Choice lists → `/masterdata/lists` | Choice lists | folded under Advanced |
| Management › Master data › Advanced | Reasons → `/masterdata/reason-codes` | Reasons | folded under Advanced |
| Management › Rules and settings | Labels and printouts → `/admin/templates` | Labels and printouts |  |
| Management › Planning tools | Production plan → `/production/plan` | Production plan |  |

### finance

- Lands on `/dashboard`.
- Top bar 390: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [44x44] · Scan or search -> /inventory/scan [79x44] · Messages, 0 unread -> /notifications [44x44] · Account ->  [44x44]
- Top bar 820: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [156x44] · Scan or search -> /inventory/scan [141x44] · Sync status: Synced. Open sync -> /sync [44x44] · To approve, 4 waiting -> /approvals [118x44] · Messages, 0 unread -> /notifications [112x44] · Account ->  [44x44]
- Top bar 1440: Bryel's Care home -> /dashboard [156x44] · Home -> /dashboard [87x44] · Operations -> /operations [118x44] · Sales & Customers -> /sales [167x44] · Management -> /management [132x44] · Scan or search -> /inventory/scan [44x44] · Sync status: Synced. Open sync -> /sync [44x44] · To approve, 4 waiting -> /approvals [44x44] · Messages, 0 unread -> /notifications [44x44] · Account ->  [44x44]
- Phone tab bar: Home -> /dashboard · Operations -> /operations · Sales -> /sales · Menu -> drawer
- Phone Home tab row (390): Overview -> /dashboard · To approve 4 -> /approvals · Problems & alerts -> /action-centre · More -> drawer
- Drawer sync chip: "All saved"; drawer targets under 44 px: 0

| Destination › section | Menu word → route | Screen title (H1) | Flag |
|---|---|---|---|
| Home | Overview → `/dashboard` | Good afternoon, Ana | dynamic title (greeting), listed exception |
| Home | To approve → `/approvals` | To approve |  |
| Home | Messages → `/notifications` | Messages |  |
| Home | Problems & alerts → `/action-centre` | Problems & alerts |  |
| Home › Help & my account | Help → `/help` | Help |  |
| Home › Help & my account | My account → `/account` | My account |  |
| Home › Help & my account | Working without signal → `/sync` | Working without signal |  |
| Home › Help & my account | Expense claims → `/finance/expenses` | Expense claims |  |
| Operations | Operations Center → `/operations` | Operations Center |  |
| Operations › Receiving | Deliveries coming → `/procurement/expected` | Deliveries coming |  |
| Operations › Packing & dispatch | Send out → `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries → `/sales/shipments` | Deliveries |  |
| Sales & Customers | Customer orders → `/sales` | Customer orders |  |
| Sales & Customers | Customers → `/sales/customers` | Customers |  |
| Sales & Customers | Orders as a board → `/sales/board` | Orders as a board |  |
| Sales & Customers › Quotes, prices & returns | Price offers → `/sales/quotations` | Price offers |  |
| Sales & Customers › Quotes, prices & returns | Prices → `/sales/price-lists` | Prices |  |
| Sales & Customers › Billing & payments | Invoices → `/finance/invoices` | Invoices |  |
| Sales & Customers › Billing & payments | Payments → `/finance/payments` | Payments |  |
| Sales & Customers › Billing & payments | Customer statements → `/finance/statements` | Customer statements |  |
| Sales & Customers › Billing & payments | Credits (money back) → `/finance/credit-notes` | Credits (money back) |  |
| Management | Management → `/management` | Management |  |
| Management › Reports & analytics | Business overview → `/analytics/overview` | Business overview |  |
| Management › Reports & analytics | Reports → `/analytics` | Reports |  |
| Management › Reports & analytics | Compare over time → `/analytics/trends` | Compare over time |  |
| Management › Reports & analytics | Lists to download or print → `/reports` | Lists to download or print |  |
| Management › Reports & analytics › Advanced | Lists sent by email → `/reports/schedules` | Lists sent by email | folded under Advanced |
| Management › Reports & analytics › Advanced | What each number means → `/analytics/definitions` | What each number means | folded under Advanced |
| Management › Purchasing | Purchasing → `/procurement` | Purchasing |  |
| Management › Purchasing | Requests to buy → `/procurement/requests` | Requests to buy |  |
| Management › Purchasing | Purchase orders → `/procurement/orders` | Purchase orders |  |
| Management › Purchasing | Send back to supplier → `/procurement/returns` | Send back to supplier |  |
| Management › Purchasing | Suppliers we may buy from → `/procurement/suppliers` | Suppliers we may buy from |  |
| Management › Purchasing › Advanced | How suppliers do → `/procurement/performance` | How suppliers do | folded under Advanced |
| Management › Purchasing › Advanced | Sales guess → `/procurement/forecast` | Sales guess | folded under Advanced |
| Management › Finance | Money → `/finance` | Money |  |
| Management › Finance | Supplier bills → `/finance/bills` | Supplier bills |  |
| Management › Finance | Close the month → `/finance/periods` | Close the month |  |
| Management › Finance › Advanced | Tax rates → `/finance/tax` | Tax rates | folded under Advanced |
| Management › Master data | Products → `/masterdata/products` | Products |  |

### warehouse.nfd

- Lands on `/dashboard`.
- Top bar 390: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [44x44] · Scan or search -> /inventory/scan [79x44] · Messages, 0 unread -> /notifications [44x44] · Account ->  [44x44]
- Top bar 820: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [156x44] · Scan or search -> /inventory/scan [141x44] · Sync status: Synced. Open sync -> /sync [44x44] · Messages, 1 unread -> /notifications [112x44] · Account ->  [44x44]
- Top bar 1440: Bryel's Care home -> /dashboard [156x44] · Home -> /dashboard [87x44] · Operations -> /procurement/expected [118x44] · Inventory -> /inventory [109x44] · Scan or search -> /inventory/scan [44x44] · Sync status: Synced. Open sync -> /sync [44x44] · Messages, 0 unread -> /notifications [44x44] · Account ->  [44x44]
- Phone tab bar: Home -> /dashboard · Receive -> /inventory/receive · Scan -> /inventory/scan · Inventory -> /inventory · Menu -> drawer
- Phone Home tab row (390): none
- Drawer sync chip: "All saved"; drawer targets under 44 px: 0

| Destination › section | Menu word → route | Screen title (H1) | Flag |
|---|---|---|---|
| Home | Overview → `/dashboard` | Good afternoon, Ana | dynamic title (greeting), listed exception |
| Home | Messages → `/notifications` | Messages |  |
| Home › Help & my account | Help → `/help` | Help |  |
| Home › Help & my account | My account → `/account` | My account |  |
| Home › Help & my account | Working without signal → `/sync` | Working without signal |  |
| Home › Help & my account | Expense claims → `/finance/expenses` | Expense claims |  |
| Operations › Receiving | Deliveries coming → `/procurement/expected` | Deliveries coming |  |
| Operations › Receiving | Receive a delivery → `/inventory/receive` | Receive a delivery |  |
| Operations › Receiving | Deliveries received → `/inventory/receipts` | Deliveries received |  |
| Operations › Receiving | Put away → `/inventory/receive/put-away` | Put away |  |
| Operations › Packing & dispatch | Boxing → `/warehouse/packs` | Boxing |  |
| Operations › Packing & dispatch | Repack for a customer → `/warehouse/repack` | Repack for a customer |  |
| Operations › Packing & dispatch | Check the labels in an area → `/quality/label-verification` | Check the labels in an area |  |
| Operations › Packing & dispatch | To get from shelf → `/sales/picking` | To get from shelf |  |
| Operations › Packing & dispatch | Send out → `/sales/dispatch` | Send out |  |
| Operations › Packing & dispatch | Deliveries → `/sales/shipments` | Deliveries |  |
| Inventory | Stock → `/inventory` | Raw materials | opens on the "Raw materials" tab; listed exception |
| Inventory | Scan or search → `/inventory/scan` | Scan or search |  |
| Inventory | Move stock → `/inventory/move` | Move stock |  |
| Inventory | Warehouse sections → `/warehouse` | Warehouse sections |  |
| Inventory › More stock lists | Shelves → `/inventory/locations` | Shelves |  |
| Inventory › More stock lists | Boxes and sacks → `/inventory/containers` | Boxes and sacks |  |
| Inventory › More stock lists | Can we deliver? → `/inventory/availability` | Can we deliver? |  |
| Inventory › More stock lists | Expiring soon → `/inventory/lots/expiry` | Expiring soon |  |
| Inventory › More stock lists | Which one to use first / set aside → `/inventory/lots/reservations` | Which one to use first / set aside |  |
| Inventory › More stock lists | Stock changes → `/inventory/movements` | Stock changes |  |
| Inventory › Counts & labels | Stock counts → `/inventory/counts` | Stock counts |  |
| Inventory › Counts & labels | Fix stock → `/inventory/adjustments` | Fix stock |  |

### operator.nfd

- Lands on `/dashboard`.
- Top bar 390: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [44x44] · Scan or search -> /inventory/scan [79x44] · Messages, 0 unread -> /notifications [44x44] · Account ->  [44x44]
- Top bar 820: Open menu ->  [44x44] · Bryel's Care home -> /dashboard [156x44] · Scan or search -> /inventory/scan [141x44] · Sync status: Synced. Open sync -> /sync [44x44] · Messages, 0 unread -> /notifications [112x44] · Account ->  [44x44]
- Top bar 1440: Bryel's Care home -> /dashboard [156x44] · Home -> /dashboard [87x44] · Operations -> /production/orders [118x44] · Inventory -> /inventory [109x44] · Scan or search -> /inventory/scan [44x44] · Sync status: Synced. Open sync -> /sync [44x44] · Messages, 0 unread -> /notifications [44x44] · Account ->  [44x44]
- Phone tab bar: Home -> /dashboard · My work -> /production/orders · Today -> /production/today · Scan -> /inventory/scan · Menu -> drawer
- Phone Home tab row (390): none
- Drawer sync chip: "All saved"; drawer targets under 44 px: 0

| Destination › section | Menu word → route | Screen title (H1) | Flag |
|---|---|---|---|
| Home | Overview → `/dashboard` | Good afternoon, Ana | dynamic title (greeting), listed exception |
| Home | Messages → `/notifications` | Messages |  |
| Home › Help & my account | Help → `/help` | Help |  |
| Home › Help & my account | My account → `/account` | My account |  |
| Home › Help & my account | Working without signal → `/sync` | Working without signal |  |
| Home › Help & my account | Expense claims → `/finance/expenses` | Expense claims |  |
| Operations | My work → `/production/orders` | My work (operator view) | |
| Operations | Today → `/production/today` | Today |  |
| Inventory | Stock → `/inventory` | Raw materials | opens on the "Raw materials" tab; listed exception |
| Inventory | Scan or search → `/inventory/scan` | Scan or search |  |

## Recipe wizard, screens 1–5 (owner, 390 and 1440, nothing saved)

Reached screen 1 at `/masterdata/recipes/new`; screens 2–5 by opening Acapulco Soap's recipe → "Make a new version" (`?new=1`) and pressing Next only.

| Screen | 390 | 1440 | Result |
|---|---|---|---|
| Intro / frame | "This screen is for making the recipe of one product in five short screens…" above the progress bar; "← All recipes" 44 px | same | ✓ intro (FIXED). ✗ "← All recipes" opens Recipes (advanced) |
| 1. Which product? | 1 search field; all 3 demo products shown as "Already has a recipe · Open it" (dashed, not selectable); Next without a product → "Choose the product, or make a new one." | same | ✓ guard FIXED; sticky Back/Next bar covers the 3rd product until scrolled (N10) |
| 2. How big is one batch? | 2 fields + By pieces / By weight; "One batch makes about 123 bars of 135 g"; "What is this?" 78x32; "← Back to the recipe without saving" 220x19 | same | ✓ fields; ✗ two small targets |
| 3. Ingredients | 5 copied ingredients, 4 inputs each (20 visible), "second person checks" checkboxes 24x24 (label row), "What is this?" 32 px; total line "17,600.1 g of 17,600 g — 0.1 g too much" | same | list editor (one card per ingredient); small targets ✗ |
| 3 with all ingredients removed | Next → stays on 3 with "Add at least one ingredient." / "Add the ingredients."; jumping to 5 via the progress bar is refused the same way | same | ✓ FIXED (was: green tick and "Send for approval" on an empty recipe) |
| 4. Steps | 7 step cards (Change / move / copy / remove, 44 px), "Add a step" choices | same | ✓; seeded step names use jargon (N8) |
| 5. Check and save | Summary (product, batch, ingredients, steps), 3 fields, "Save as draft" + green "Send for approval" (not pressed) | same | ✓ one green button |

No sideways scroll at 390 on any screen.

## Comparison with the brief's mockup board (as summarised in `docs/CONSULTANT_REVIEW.md` §4)

| Mockup panel | Live app now | Matches | Still different |
|---|---|---|---|
| **Owner dashboard** (Sales today · Production progress · Inventory alerts · Pending approvals; sales chart; top alerts; recent activity) | `/dashboard` owner (`dashboard-owner-1440.png`, `dashboard-owner-390.png`, `vp-dashboard-owner-820.png`) | Four cards in mockup order; new "What to do next: 17 things wait for your decision · Open To approve"; "Needs your attention" (5 + See all 7); "Sales this week" chart with Chart/Table; Production by stage; Recent activity; sales card neutral before the day ends. | Recent activity is dominated by "The system escalated the problem · <code>"; the 17 is still shown twice (next-step box and 4th card); no "top products" (on Reports); Chart/Table 34 px. |
| **Operator workspace** ("Your tasks today", task cards with Start, one Complete) | `/dashboard` operator (`dashboard-operator.nfd-390.png`) | Verb titles ("Check 2 weighings", "Weigh the ingredients"), product name first, step x of 7, progress; **one green button on the top card** ("Check"), the rest outlined "Continue" (FIXED); tab bar Home · My work · Today · Scan · Menu; quick actions. | Batch codes shown after the name (fine). Matches the mockup. |
| **Operations Center** (flow strip, current step + due, recent activity) | `/operations` (`operations-owner-1440.png`) | 9 numbered stages with counts and warnings; "Batches being made" now leads with the product, then "Step now", steps bar, status, **Due**, planned start; **Recent activity** with names ("Dino Reyes boxed the delivery to a customer for Mabuhay Pharmacy Group"); "Start something" tiles. | Stages are a grid, not a connected strip; warning links 25–43 px tall on phones; desktop section row wraps (N3). |
| **Frame / top bar with 5 destinations** | 390 / 820 / 1440 | 5 destination pills (44 px) with icons; descriptions as tooltips and in the drawer; Scan, sync, To approve, bell, account all 44 px; Scan on phones; no duplicate doors; drawer sync "All saved". | At 1440 Scan / To approve / Messages are icon-only (words only at 820 and ≥1536); site selector code-first and cut off ("NFD · North F"); no help "?" in the frame. |
| **Production floor TV** | `/floor` floor.nfd 1920 (`floor-floor.nfd-1920.png`) | Making now · Next up · Waiting · Today; big type; clock; "Updated 12:37:28"; no prices; no app frame. | "Anyone · started 08:00" still reads like missing data; "Next up … Start Tue 27 Oct" is in the past (demo data). |
| **Reports** (one chart, top products, three tiles) | `/analytics` | Tiles, chart, "What sells best"; KPI codes gone. | Three report doors remain; overview footnotes use "posted", "output mass". |

## Ranked remaining fix list

| # | Fix | Files | Rows it clears |
|---|---|---|---|
| 1 | Give problem (action item) lines a name in Recent activity ("Coconut Oil is past its use-by date – sent to the owner") or leave escalations out of the owner feed | `src/app/(app)/dashboard/activity-sentence.ts`, the recent-activity read model (`src/modules/analytics/owner-home.ts`), `src/app/(app)/operations/page.tsx` | Home owner/manager, Operations |
| 2 | In-page 44 px: Problems & alerts kinds as one "Show: All kinds ▾" select (or 44 px chips, folded); Chart/Table toggle 44 px; "Sign out" on My account; sync-conflict and diagnostics chips; Operations stage warning links; retention "Change or confirm"; Units "Edit"; list links on Site/Warehouse/Payment pages as 44 px rows; checkbox/radio label rows ≥44 px in `src/ui/form.tsx` and the wizard | `src/app/(app)/action-centre/page.tsx`, `src/ui/charts/chart-frame.tsx`, `src/app/(app)/account/page.tsx` (line ~91), `src/app/(app)/sync/conflicts/*`, `src/app/(app)/admin/diagnostics/*`, `src/app/(app)/admin/retention/page.tsx`, `src/app/(app)/masterdata/uom/*`, `masterdata/{sites,warehouses}/[id]/page.tsx`, `finance/payments/[id]/page.tsx`, `src/ui/form.tsx`, `src/app/(app)/operations/page.tsx` | up to 39 rows (17 rows fail only this) |
| 3 | Replace "(s)" plurals with real plurals (shared `plural()` helper); format dates in alert/message bodies as "28 Oct 2026"; plain words in alert kinds ("Open problem report" instead of "Open deviation", "Fix-and-prevent plan" instead of "CAPA") | `src/modules/action-centre/kinds.ts`, notification templates, `finance/{page,bills,expenses,periods,statements/[id]}`, `procurement/suppliers`, `admin/users/[id]`, `admin/sessions` | ~14 rows |
| 4 | Seed data: plain step names (no "line clearance", "quarantine", "disposition"), drop "(PLACEHOLDER)" from quality-check names, assign a person to the running batch (floor "Anyone"), keep "Next up" in the future. **Needs demo reset** after the change | `src/db/seed*.ts` | recipe page, steps version, inspection plans, floor |
| 5 | "All recipes" → a plain recipe list (or the Products list with "Recipe" per product) instead of Recipes (advanced); make `/masterdata/recipes` that list | `src/app/(app)/masterdata/recipes/page.tsx`, `recipes/new/page.tsx`, `recipes/[formulaId]/page.tsx` | wizard, recipe page, `/masterdata/recipes` |
| 6 | Shrink the owner menu: fold Planning tools, IT and system and Rules and settings into one "Settings" sub-menu; merge "Business overview" and "Reports"; hide empty sections (sales Purchasing) and one-item sections (admin Purchasing) | `src/app/(app)/nav.ts`, `tests/unit/nav-per-role.test.ts` | menu map |
| 7 | Fold remaining big forms: one note box per card only after "I'm on it"; Compare over time picker; New material questions one at a time; Supplier bill (fold dates/details); Locations add form behind a button; Site detail teams as a list with one edit form; Record a payment allocation radios folded | `action-centre/page.tsx`, `analytics/trends/*`, `masterdata/materials/new/*`, `finance/bills/new/*`, `masterdata/locations/page.tsx`, `masterdata/sites/[id]/page.tsx`, `finance/payments/new/*` | 12 rows |
| 8 | To approve: keep Approve on the first card green, the rest secondary (as operator Home now does) | `src/app/(app)/approvals/page.tsx` | 2 rows |
| 9 | Site selector shows the name first ("North Fields Plant (NFD)") and is wide enough | `src/app/(app)/shell.tsx` (`siteSwitcher`) | frame |
| 10 | Intro under the title before header buttons on phones (Materials, Messages, Invoice); fix the Messages sentence; help "?" in the frame; sign-in page words; sync-conflict title with the item name; approval-rule ids hidden; audit search by name | `src/ui/page-header*` (or the affected `page.tsx`), `notifications/page.tsx`, `shell.tsx`, `(auth)/sign-in/*`, `sync/conflicts/[id]/page.tsx`, `admin/approval-rules/page.tsx`, `admin/audit/page.tsx` | ~8 rows |
| 11 | Desktop: let the section row scroll on one line or move the description to a tooltip so Operations does not wrap at 1440 | `src/app/(app)/shell.tsx` | frame |

Not app defects: the sandbox's JS-chunk 404 for `(app)` routes; demo resets by other auditors during this run.
