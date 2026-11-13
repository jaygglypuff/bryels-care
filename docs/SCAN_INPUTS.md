# Every place a lot, box, shelf, batch or item is identified (scan-or-pick audit)

Owner review 2026-10-31 (live app, phone): a field "Scan the packaging or label lot" with the placeholder
`BC:LOT:…`, a box "Location (if several) e.g. PKG-01", and the error "Lot BC not found in your sites" after the
placeholder was sent. "How would he scan it? Double-check all scanning and inputting of labels."

**Owner decision 2026-11-08 (A-SCAN-TYPED-01): every place that asks to scan a label also takes the number printed
on it, typed.** Under the Scan button every `<ScanOrPick>` shows "Or type the number on the … label" (one box; in
fields with a name search the same box also finds by name). Rules:

- any case, with or without dashes or spaces, with or without the `BC:<TYPE>:` prefix (`bx00000005` = `BX-00000005`);
  the last characters (at least 3, e.g. `0005`) when only one EXPECTED candidate ends with them, otherwise "More than
  one ends in … Type more of the number.";
- `inputMode="text"`, `autoCapitalize="characters"`, Enter checks it (never sends the surrounding form); the box is
  never focused by itself, so the phone keyboard opens only when the person taps it;
- recorded as `via: "typed"` in the same fields the scan writes (table below); typing counts for verification checks
  (second check, boxing check, label check, weighing and materials lot confirmation) because the person reads the
  physical label; **a tap from a list still does not** (refused on the server: "Tapping the list does not count as a
  check. Scan the label, or type the number printed on it.");
- a wrong number is refused in plain words: "That number is not on this order. Check the label and type it again."
  (picking, second check), "That number is not on this list …" (other fields with only the listed candidates).

**Setting `scan.typed_code_counts_as_check` (ADR-126, default on).** Settings › Scan and search › "A typed label number
counts as a check". On (today): the rules above. Off: the **verification checks only** take a scan:

| Check | Server (refuses `typed` like `tap`, code `TYPED_NOT_A_CHECK`) | Screen (typing box hidden, `allowTyping={false}`) |
|---|---|---|
| Second check of the box (`/sales/packing/[shipmentId]`) | `scanPackVerification` → `checkEntryMode` | `ScanPanel` |
| Boxing check (`/warehouse/packs/[packId]` Checker) | `verifyPackScan` → `checkEntryMode` | `ScanPanel` |
| Label check (`/quality/label-verification`) | `verifyLabelScan` → `checkEntryMode` | `VerifyScanForm` |
| Lot check at weighing (Weigh card) | `recordDispense` → `confirmLot` (a typed number, and a bare "last 4", are refused whatever `production.weighing.lot_confirm` says, unless it is "none") | `WeighCard` |
| Lot check at weighing, offline (`/offline` Weigh) | replay → `recordDispense` → `checkEntryMode` (read at replay time) | `WeighCapture` (from the cached batch `weighing.typedChecks`) |
| Lot check at weighing, "Other ways" (`/production/orders/[id]/weigh/more`, ADR-133) | `dispenseAction` sends `lotVia` → `recordDispense` → `checkEntryMode` (typed refused); a tapped lot (or no `lotVia`) is a chosen lot → `confirmLot` (refused unless `lot_confirm` is "none") | `WeighForm` (`viaName="lotVia"`; the typing box stays, the server refuses typed while off) |
| Lot check at Get materials (`scan_lots` on) | `confirmPicked` | `MaterialsList` |

The refusal reads: "This check needs the label scanned. Typing is turned off in Settings." Nothing is recorded. Put-away,
counts, moves, finding a box or lot and every other field keep the typing box. A weighing already recorded answers with
its stored result when its idempotency key is sent again. Who changes it: a change request that only the owner approves
(restricted, re-authentication); QA should say yes first (A-SCAN-TYPED-01).

| Where the "how" is stored | scan | typed | tap |
|---|---|---|---|
| `pick_lines.entry_mode` (+ audit `sales.pick.scanned.via`) | `scan` | `typed` | `manual` (with reason) |
| `pack_verification_scans.entry_mode` (second check, boxing check; refusals too) | `scan` | `typed` | refused |
| `label_verifications.entry_mode` (+ audit `via`) | `scan` | `typed` | refused |
| `batch_material_picks.lot_entry_mode` (materials list, `scan_lots` on; + audit `scannedVia`) | `scan` | `typed` | refused |
| dispense audit `lotConfirmed` (weighing lot confirmation) | `scan` | `typed` | refused |
| put-away movement `meta.locationVia` | `scan` | `typed` | `tap` |
| count audit `inventory.stock_count.line_counted.lotVia` | `scan` | `typed` | `tap` |
| offline count (`/offline`, outbox payload `lotVia`, replayed into the count audit `lotVia`, ADR-125) | `scan` | `typed` | `tap` |
| offline weighing (`/offline`, outbox payload `lotVia`, replayed into dispense audit `lotConfirmed`, ADR-125) | `scan` | `typed` | refused on the phone and on replay (`checkEntryMode`) |
| customer return `manual_entry` | false | true | true |

Migration `0039_typed_label_codes` adds the columns and allows `typed` in `ck_pick_lines_mode`. Server matching:
`findByCode` in `src/lib/scan/code-sql.ts` (exact number first, then the same letters and digits; two records that
only differ by dashes match nothing), `resolvePickRef` (same fallback), `checkEntryMode` (refuses a tap for checks).
Pure rules: `codeKey`, `cleanTyped`, `matchTypedCode` in `src/lib/scan/pick.ts`.

**The one way (all screens below marked ✓):** `src/ui/scan-or-pick.tsx` (`<ScanOrPick>`):

1. the **expected candidates** as big tap targets (the lots on this shelf, the shelves that hold this lot, the
   boxes still to take, what left on this delivery…); tapping fills the value;
2. a **Scan** button that opens the camera; a **handheld scanner** works any time without tapping anything (the
   burst goes to the first field on the page still waiting);
3. **find by name** (words such as "coconut oil", or a few digits) as the fallback; found lots list usable stock first and expired or stopped lots last (marked), each with amount, shelf name, use-by and lot number;
4. (2026-11-08: plus "Or type the number on the label", see above.) The placeholder can never be sent (the value is a hidden input that
   only a tap, scan or found item fills); a required field blocks its form with "Tap one of the lots above, or
   scan the lot label."; anything not found says "We couldn't find that. Tap one of the lots above or scan the
   lot label again.";
5. the server still accepts the label (`BC:LOT:…`), a plain number or a candidate id, and checks site and
   permission again (`resolveLotRef` / `resolveLocationRef` in `src/modules/inventory/holds.ts`, `findLotForCount`,
   `findContainerByNumber`, `resolvePickRef` in `src/modules/scan/pick.ts`). Since this change those resolvers
   also refuse the placeholder text and labels of another kind in plain words.
6. Round 5 B8 (2026-11-08): the grey example text in the typing box is never a real record number (people typed
   the example and got another order's box). It says what to type: "e.g. the last 4 numbers on the label", "e.g. the
   last 4 numbers on the box label", "e.g. the code on the shelf" (`PICK_WORDS[kind].example` in `src/lib/scan/pick.ts`).

Legend for "How it works now": **tap** = expected candidates listed; **scan** = camera button + handheld
scanner; **words** = find by name (server search, current site) or **words (list)** = filter of the listed
candidates on the phone; **one → hidden** = a single candidate is chosen and shown as one line. Column **Type the
code**: ✓ = the number printed on the label can be typed (2026-11-08 audit; every ScanOrPick field has it).

## Warehouse and inventory

| Route | Field | Identifies | How it worked | How it works now | ✓ | Type the code |
|---|---|---|---|---|---|---|
| `/inventory/move` | 1 · What are you moving? | lot or box | Text box "Scan, or type a name" (wedge or typing), matches by words | tap (lots with stock here, earliest expiry first) · scan (lot **or** box label) · words | ✓ | ✓ |
| `/inventory/move` | 2 · Take it from | shelf holding the lot | Drop-down of all shelves with stock | tap the shelves that hold the lot · scan · one → hidden | ✓ | ✓ |
| `/inventory/move` | 3 · Which shelf does it go to? | shelf | Text box "Scan the shelf label" + drop-down | tap (allowed shelves only) · scan · words; wrong-kind shelf warns | ✓ | ✓ |
| `/inventory/[lotId]/move` | From which shelf? | shelf holding the lot | Drop-down | tap · scan · one → hidden | ✓ | ✓ |
| `/inventory/[lotId]/move` | To which shelf? | shelf | Drop-down | tap (allowed shelves) · scan · words (list) | ✓ | ✓ |
| `/inventory/receive/put-away` | To put away / Another lot? | lot waiting to be put away | Task cards + text box "Scan, or type the item name" (searched every lot, expired too) | tap (only lots QA said OK that still wait) · scan · words (list, only those lots) → opens the lot | ✓ | ✓ |
| `/inventory/receive/put-away?lot=` | Take it from which place? | place holding the lot | Drop-down | tap · one → hidden | ✓ | ✓ |
| `/inventory/receive/put-away?lot=` | Where does it go? | shelf | Chips + text box "Scan the shelf label" + datalist | tap (suggested shelf preselected, allowed places only) · scan · words (list) | ✓ | ✓ |
| `/inventory/counts/[id]` (count a shelf) | What are you counting? | lot | Buttons of expected lots + text box "Scan the label" + "find by name" | tap (lots that should be on the shelf) · scan · words; "No label" path unchanged | ✓ | ✓ |
| `/inventory/adjustments/new` (Fix stock) | Which lot? (per row) | lot | Text box "Scan, or type a name" + Find | scan · words (with the shelves that hold it) | ✓ | ✓ |
| `/inventory/adjustments/new` | Which shelf? (per row) | shelf holding the lot | Drop-down | tap · one → hidden | ✓ | ✓ |
| `/inventory/containers/new` (Pack into a box) | What goes in? | lot | Drop-down (first lot preselected: a fake default) | tap (lots with loose stock) · scan · words (list); nothing preselected unless one lot | ✓ | ✓ |
| `/inventory/containers/new` | From which shelf? | shelf | Drop-down "if several" | tap · one → hidden | ✓ | ✓ |
| `/inventory/containers/[id]` Split / Repack | Which one? | lot in the box | Drop-down | tap · scan · one → hidden (hidden input) | ✓ | ✓ |
| `/inventory/containers/[id]` Put together | Which boxes go together? | boxes (several) | Tick boxes + text box "Scan the box label" | tap (boxes on the same shelf, several) · scan · words | ✓ | ✓ |
| `/inventory/containers/[id]` Repack | Into which box? | box (optional) | Drop-down | tap · scan · words; none = a new box | ✓ | ✓ |
| `/inventory/containers` | Search | filter | Search box "Box or lot number" | unchanged: list filter, not a field that identifies one thing | n/a | n/a |
| `/inventory/availability`, stock search | Search | filter | Words or number | unchanged: list filter | n/a | n/a |
| `/inventory/scan` (Scan or search) | Scanner | anything | "Scan a label or type a number"; camera fallback "Type the lot number" | the universal look-up page: "Scan the label, or type what it is" (e.g. coconut oil); camera fallback offers the handheld scanner or a name; help says where each label is stuck | ✓ | ✓ |
| `/inventory/receive` | Supplier's lot number, receiving place | supplier's own code (external) | Text from the supplier's label; destination shown as codes | supplier's lot stays typed (it exists only on their label; QA traces with it, A-SCAN-14); required for ingredients only, optional for packaging and supplies, hint "From the supplier's label" (re-audit B); destination and "put it in" shown by shelf name, code after | n/a | n/a |
| `/inventory/movements/[id]` reverse | Replacement from/to | shelf | Drop-downs (manager correction) | unchanged (rare manager form, pick list by name) | n/a | n/a |
| `/warehouse/packs/[packId]` Add a box | Which lot are you boxing? | the pack's lot (check) | Text box "Scan the lot label" | tap or scan the one expected lot (V-MAT check kept on the server) | ✓ | ✓ |
| `/warehouse/packs/[packId]` Checker | Scan each box label, or type the number printed on it | box (verification) | Scanner with typing | scan (camera + handheld) or the box number typed (recorded `typed`); no tap: reading the label is the check | ✓ | ✓ |
| `/warehouse/repack` | Which boxes? | boxes (several) | Text area "Scan the box labels" | tap (product boxes QA said OK) · scan · words | ✓ | ✓ |
| `/offline` Count | Which lot? | lot (or shelf) | Scanner with placeholder `BC:LOT:L-2610-00001` | tap (lots on the shelf, phone data) · scan (lot or shelf) · words (list) — works offline; how the lot was given goes with the queued count (`lotVia`, ADR-125) | ✓ | ✓ |
| `/offline` Weigh | Which container? | lot | Scanner with placeholder `BC:LOT:…` | scan · typed lot number (list shown as a checklist, `allowTap={false}`: the lot field is the lot confirmation); `lotVia` goes with the queued weighing, the server refuses a tap on replay (ADR-125). A scanned `BC:EQP` label sets the scale | ✓ | ✓ |
| `/offline` Weigh | Scale | equipment (scale) | Drop-down | `kind="equipment"`: tap the scales saved on the phone · scan · type the number (ADR-125) | ✓ | ✓ |

## Sales: picking, second check, dispatch, returns

| Route | Field | Identifies | How it worked | How it works now | ✓ | Type the code |
|---|---|---|---|---|---|---|
| `/sales/picking/[pickId]` | Scan the box label, or type the number printed on it | box or lot (loose) | Scanner (camera, scanner, type) placeholder `BC:BOX:BX-00000012 · BC:LOT:…`; typed = manual with reason | scan or type (saved `typed`, no reason needed) · the boxes still to take are listed; a **tap** is saved as entered by hand and needs a tapped reason first (**Label torn**, **Scanner broken** or a few words; round 5 B9: no default reason, refused without one), audited; a lot label then asks "How many loose pieces of this lot?" | ✓ | ✓ |
| `/sales/packing/[shipmentId]` (second check) | Scan each box label, or type the number printed on it | box or lot | Scanner with typing | the box list comes first ("Boxes · 0 of 1 checked", next box marked), then scan or type; a lot label then asks "How many loose pieces of this lot?". Not tappable: the independent check must read the label | ✓ | ✓ |
| `/sales/shipments/[shipmentId]` (dispatch) | driver, plate | — | Text | unchanged: no lot/box identified here | n/a | n/a |
| `/sales/returns/[returnId]` | Which box or lot came back? | box or lot on that delivery | Text box "Scan the box or lot label… or type the number" + "I typed it" tick box | tap (what left on this delivery) · scan · words (list); a tap is recorded as entered by hand | ✓ | ✓ |

## Quality

| Route | Field | Identifies | How it worked | How it works now | ✓ | Type the code |
|---|---|---|---|---|---|---|
| `/quality/holds/new` | Which lot? | lot | Drop-down + "Scan the label" text box under More details | tap · scan · words | ✓ | ✓ |
| `/quality/holds/new` | Which place? | place | Drop-down | tap (stopped places greyed) · scan · words (list) | ✓ | ✓ |
| `/quality/holds/issue` | Which lot? | lot | Drop-down + scan text box | tap · scan · words | ✓ | ✓ |
| `/quality/holds/issue` | From which place? | place holding the lot | Drop-down of every place | tap the places that hold the chosen lot · one → hidden | ✓ | ✓ |
| `/quality/inspections/[id]` sample | Taken from which place? | place holding the lot | Drop-down (first preselected) | tap · one → hidden | ✓ | ✓ |
| `/quality/inspections/[id]` sample | Box it came from (optional) | box | Text box "scan the box label" | scan · words (optional) | ✓ | ✓ |
| `/quality/deviations/[id]` stop the lot | Lot to stop / other lot | lot | Text box "scan the label" | scan · words | ✓ | ✓ |
| `/quality/label-verification` | Scan a box or lot label, or type its number | box/lot (verification) | Text box, typing allowed | scan or the printed number typed (recorded `typed`; last digits matched against the labels still to check here); no tap | ✓ | ✓ |
| `/quality/trace` | Which material or product (lot)? | lot | Long drop-down + "Scan the label" text box | tap (lots at the site) · scan (lot or box) · words; supplier's lot number kept under "Only have the supplier's lot number?" (external code) | ✓ | ✓ |
| `/quality/recall` | Which material or product (lot)? | lot / box | Long drop-down + "Scan a label or complaint number" text box | tap · scan · words; from a complaint use the complaint's "Who received it" button; supplier's lot number kept | ✓ | ✓ |
| `/quality/complaints/new` | Which lot? (optional) | lot on the product | Text box "Number on the product label" | scan · words (the digits the customer reads out) | ✓ | ✓ |
| `/quality/bulk` | Lot prefix | filter | Text | unchanged: list filter for QA | n/a | n/a |

## Maintenance and purchasing

| Route | Field | Identifies | How it worked | How it works now | ✓ | Type the code |
|---|---|---|---|---|---|---|
| `/maintenance/work-orders/[id]` | Which part? | spare part lot + place | Drop-down | tap (parts OK to use here) · scan · words (list) | ✓ | ✓ |
| `/maintenance/work-orders/new` (Report a problem), `/maintenance/plans/new` | Which machine? | equipment | Drop-down by name | `kind="equipment"` (ADR-125): tap (machines at your sites, status shown) · scan a `BC:EQP` label · type the machine number (`mix01` = MIX-01) · words (list); `onlyCandidates`; the service checks organisation and site again (`equipmentInScope`) | ✓ | ✓ |
| `/maintenance/spare-parts` | Only for one machine? (optional) | equipment | Drop-down | unchanged: optional set-up filter under More details, not a floor field | n/a | n/a |
| `/procurement/returns/[id]` | Which lot? | rejected lot + place | Drop-down | tap · scan · words (list) | ✓ | ✓ |

## Production (adopted by the production pass, one path for production work 2026-10-31)

The old batch workspace forms are gone (`/production/[batchId]` is a read-only batch record), so the packaging,
transfer and step fields of that page no longer exist. Production fields now:

| Route | Field | Identifies | Setup | Done | Type the code |
|---|---|---|---|---|---|
| `/production/orders/[id]/step/[n]` packaging box (no packaging lines) | `lotRef` + `locationRef` | packaging lot, shelf | `kind="lot"` candidates = released packaging lots at the site (tap · scan · words); then `kind="location"` = places of the chosen lot, `hideWhenSingle`, `onlyCandidates` | ✓ | ✓ |
| `/production/orders/[id]/step/[n]` packaging box (packaging lines) | — | — | the taken lot is shown; nothing to identify | ✓ | n/a |
| `/production/orders/[id]/weigh` (More details) | scale (`equipmentRef`) | equipment | `kind="equipment"`, `submit="code"`, candidates = the site's scales (the ones that cannot be used greyed with the reason), first usable preselected (ADR-125) | ✓ | ✓ |
| `/production/orders/[id]/weigh` | `lotConfirm` + `lotConfirmVia` | lot | `kind="lot"`, `mode="emit"`, `allowTap={false}`, `onlyCandidates` (a tap is not a check, A-SCAN-11; ADR-080 §3); "Type the lot number" (all of it or the last 4) is a normal option, recorded `typed` (replaces "Label damaged? Type the last 4"). Round 5: `showCandidates` only under "Use another lot" (the lot to take is shown once, "Take lot …0010 · shelf"); a wrong label says which lot to take. With no signal the weighing is queued with the same `lotRef`/`lotVia` (offline outbox, A-OFF-WGH-01) | ✓ | ✓ |
| `/production/orders/[id]/weigh/more` ("Other ways to weigh", exec-forms `WeighForm`) | `lotRef` + `lotVia` + `locationRef` | lot, shelf | `kind="lot"` candidates = usable lots (FEFO) with `places`, `viaName="lotVia"` (ADR-133: a scan or typed number confirms the lot; a tap needs the confirmation of the main Weigh); `kind="location"` `hideWhenSingle` | ✓ | ✓ |
| `/production/orders/[id]/weigh/more` | 2. Scale (`equipmentRef`) | equipment | `kind="equipment"`, `submit="code"`, blocked scales greyed with the reason (ADR-125) | ✓ | ✓ |
| `/production/orders/[id]/materials` (setting scan_lots) | `lotCode` + `lotVia` | lot | `kind="lot"`, `allowTap={false}`, `onlyCandidates`, candidates = the lot to take; typed lot number recorded `typed` | ✓ | ✓ |
| `/production/[batchId]/finish` | `locationRef` | hold area | `kind="location"`, candidates = hold areas, `onlyCandidates` | ✓ | ✓ |
| `/production/staging/[batchId]` ("Lots and sheets") QA substitution | `substituteLotCode` | lot | `kind="lot"` scan · words | ✓ (scan-to-stage removed: Materials list) | ✓ |
| `/production/orders/[id]/step/[n]` equipment (mixing, moulding … and line clearance steps that name equipment) | `equipmentRef` | equipment | `kind="equipment"`, `submit="code"`, `onlyCandidates`, candidates = the equipment of the step's kind at the site; the ones that cannot be used are greyed with the reason (ADR-125). Server: `selectEquipment` → `resolveEquipment` (id, `BC:EQP:` label or the number, matched loosely with `findByCode`, organisation and the caller's sites; then the batch's site and the step's kind) | ✓ | ✓ |
| `/labels/**`, `/print/**` | reprint reason, copies | — | no lot/box identified by typing (labels pass to confirm) | — | n/a |

## Component API (for adopters)

```tsx
import { ScanOrPick, type PickCandidate } from "@/ui/scan-or-pick";

<ScanOrPick
  kind="lot" | "container" | "location" | "batch" | "item" | "equipment"
  label="Which lot?"                 // the question
  name="lotRef"                      // hidden input; omit for client-only use
  candidates={[{ value: lot.id, title: "Coconut oil", detail: "lot L-2610-00001 · 25 kg on A-01",
                 code: "L-2610-00001", codes: ["L-2610-00001"], places?: [...], disabledReason? }]}
  candidatesLabel="Set aside for this batch"
  submit="value" | "code"            // send the id (default) or the number
  defaultValue / value / onChange={(value, candidate, via) => …}
  required onlyCandidates hideWhenSingle search={true} maxShown={6} error={fe.lotRef}
  multiple  /* several: one hidden input per choice, onChangeMany */
  viaName="lotVia"                   // also send "tap" | "scan" | "typed"
  showCandidates={false}             // candidates only match a scanned/typed code (the page lists them)
  notListed="That number is not on this order."  // refusal for a typed number not in the list (onlyCandidates)
  mode="emit" onEmit={(value, candidate, via) => …} allowTap alsoAccept={["container"]} pending done
/>
```

Server: `findPickCandidates(ctx, kind, text)` and `resolvePickRef(ctx, kind, raw)` in `src/modules/scan/pick.ts`
(through `src/app/(app)/scan-pick-actions.ts`). Pure rules: `src/lib/scan/pick.ts` (`classifyPickInput`,
`matchCandidate`, `filterCandidates`, `isScannerBurst`, messages). Lot candidates carry `places` (the shelves that
hold the lot at the current site) and `uom`, so a "which shelf?" field can follow without another call.

### Equipment (machines and scales), ADR-125

`kind="equipment"` accepts a `BC:EQP:<code>` label (the grammar has had `EQP` since ADR-017), the machine number typed
(any case, with or without dashes) and a tap. Server: `findPickCandidates` / `resolvePickRef` with kind `equipment`
look in the caller's organisation at the current site only, for people holding `masterdata.equipment.view`,
`production.equipment_use.create`, `production.dispense_record.create` or a maintenance work order or plan permission.
**Not built:** the app does not print equipment labels yet (no `equipment` dataset in `label-templates.ts`); until
then the number is typed from the machine's own plate or tapped. Equipment label printing is a follow-up; its content
is not invented here.

## Re-audit B (2026-11-01)

| Screen | Change |
|---|---|
| Scan › typed words | Lots in the finder order (`lotUseOrder` in `src/modules/scan/pick.ts`): with stock, usable, then waiting for QA, then expired / stopped / rejected / recalled marked "do not use"; each says its shelf by name |
| Boxes and sacks list | Search takes a scanned label (`BC:BOX:` / `BC:LOT:`), the item name or the shelf name ("Scan the label, or type what is inside"); no typed code needed |
| Shelf page | ⋯ More › Print a label (the label guide pointed there) |
| Boxing | Pack box and print label opens `/print/labels/pack/<id>` (print in place); no "print station" |
