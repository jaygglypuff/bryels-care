# Usability test (2026-10-30): non-technical owner, operator and warehouse helper

| | |
|---|---|
| Method | Testers played a non-technical owner, a production operator, a checker, a planner and a warehouse helper on the demo (fictional data) at phone 390×844, iPad 820×1180 / 1180×820 and desktop 1440×900, plus an automatic layout check of 166 screens × 4 sizes (overlapping text/buttons, sideways scrolling) |
| Decisions | ADR-083 (layout, Home, floor menus, words); ADR-082 (assignment, approvals) |
| Not tested | Camera / handheld scanner input, offline, QA release then put-away of the new lot |

## Fixed in this round

| Finding | Fix |
|---|---|
| iPad landscape: destination buttons cut off ("Sale…", Management missing), header crowded | Full top menu only from 1280 px; compact header + tab row + bottom bar below |
| Phone header 400 px wide on a 390 px screen; bottom-bar labels off screen; avatar menu slid the page | Header fits (logo mark, sync status in the menu); avatar menu capped to the screen |
| Reject type names hidden under their input boxes (all sizes) and other narrow inputs over their labels | Shared field component keeps the width a screen asks for (`fieldClass`) |
| Home: 5,800 px engineering dashboard, codes, placeholder cards; late items buried | Plain Home: needs attention, four numbers, pipeline; details moved to Business overview |
| Site shown as "NFD" in the header but "All sites" on Home | Home follows the header site unless "All my sites" is chosen |
| Black primary buttons | Green |
| Phone menu ~35 entries, expanders without arrows, two "Overview", vague names | Menu folds per destination with arrows; renamed (Daily log, Problems & alerts, Help & my account, Older screens, More stock lists, Counts & labels, Quotes, prices & returns, Management home, IT settings); "HR & attendance · Phase 5–6" chip removed |
| Floor staff see Quality, Maintenance, Advanced, Sales… | Operator and warehouse menus trimmed to their work |
| Warehouse bottom bar lit "Receive" and "Inventory" together | Only the closest tab lights up |
| "Go to Finish" opened the full batch record; order button "Transfer to quarantine storage area" | Button "Finish" opens the simple Finish screen |
| Sticky action bars covered "Checked by" and the keypad on phones | The bars sit at the end of the form |
| "All taken" with 0 ticked marked everything | On-page confirmation "Mark all 5 materials as taken?" |
| Receipt said "put the stock away; QA can then release it", put-away then refused with "Lot … is quarantine … Allowed: HLD-01, QUA-01, RET-01" | Receipt: leave the containers in the hold area until QA approves; put-away explains the same in plain words |
| Pipeline and Home jargon (Awaiting inspection, awaiting QC, pts, receipts posted…) | Materials to check, Materials ready, Being made, Products to check, Boxing, Ready to sell, Orders to ship; "points"; "deliveries recorded today" |
| To approve offered the owner a site-manager step that then failed; "Asked by someone", "12768.00 PHP", raw keys; badge ≠ rows | See the approvals change in this round (decidable items only, names, ₱ amounts, on-page confirm) |
| Low stock nowhere although Soap wrapper 3,000 < 20,000 minimum | Low-stock read model; shown in "Needs your attention" |
| Sales list jargon, wrapping order numbers, codes instead of product names, late orders not flagged; expired lot shown "Released"; batch step chips "Waiting"/truncated | Fixed on those screens in this round |

## Still open (need product work or an owner/GMP decision)

| Finding | Why not in this round | Proposal |
|---|---|---|
| Step 4 "Mixing and cutting": warning "Select the mixer used" but no mixer field on the step card | Equipment choice is a GMP record; needs the step-card equipment picker | Big buttons per available mixer on the step card (out-of-service shown disabled) |
| Step 6 "Packaging and labeling" asks to scan packaging lots that were never on the Materials list | Packaging issue design (list vs scan) | Add packaging to "Get materials" or a scan box on step 6; ask wrapper counts once |
| Checker can be "signed" by picking their name on the operator's tablet without the checker present | Owner decision ADR-078 (name pick); the GMP review asked about a PIN | Owner/GMP to decide: PIN or the checker's own session for marked lines |
| Checker gets no notification or "next task" | Needs a check task model | Notify the checker; "Check weighing" card on their Home |
| Finish screen: confirm shown before validation; reason box only after the error; checker choice wiped | Finish form rework | Validate first, show the reason box when rejects are over the limit, keep the selection |
| An approved order with no batch says "Nothing to do on this order right now" (WOM-2610-027, demo data) | Likely a seed artefact | Check the seed; show the reason and who can help |
| Weigh on phone: keypad below the fold; two Save buttons | Weigh layout rework for phones | Pin the keypad like the iPad landscape layout |
| Labels: four screens to print; label shows the whole-lot quantity on each container | Label station flow | "Print labels" opens the print preview directly |
