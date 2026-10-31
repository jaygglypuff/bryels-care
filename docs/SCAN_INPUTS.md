# Every place a lot, box, shelf, batch or item is identified (scan-or-pick audit)

Owner review 2026-10-31 (live app, phone): a field "Scan the packaging or label lot" with the placeholder
`BC:LOT:…`, a box "Location (if several) e.g. PKG-01", and the error "Lot BC not found in your sites" after the
placeholder was sent. "How would he scan it? Double-check all scanning and inputting of labels."

**The one way (all screens below marked ✓):** `src/ui/scan-or-pick.tsx` (`<ScanOrPick>`):

1. the **expected candidates** as big tap targets (the lots on this shelf, the shelves that hold this lot, the
   boxes still to take, what left on this delivery…); tapping fills the value;
2. a **Scan** button that opens the camera; a **handheld scanner** works any time without tapping anything (the
   burst goes to the first field on the page still waiting);
3. **find by name** (words such as "coconut oil", or a few digits) as the fallback; found lots list usable stock first and expired or stopped lots last (marked), each with amount, shelf name, use-by and lot number;
4. never a bare box asking to type a code; the placeholder can never be sent (the value is a hidden input that
   only a tap, scan or found item fills); a required field blocks its form with "Tap one of the lots above, or
   scan the lot label."; anything not found says "We couldn't find that. Tap one of the lots above or scan the
   lot label again.";
5. the server still accepts the label (`BC:LOT:…`), a plain number or a candidate id, and checks site and
   permission again (`resolveLotRef` / `resolveLocationRef` in `src/modules/inventory/holds.ts`, `findLotForCount`,
   `findContainerByNumber`, `resolvePickRef` in `src/modules/scan/pick.ts`). Since this change those resolvers
   also refuse the placeholder text and labels of another kind in plain words.

Legend for "How it works now": **tap** = expected candidates listed; **scan** = camera button + handheld
scanner; **words** = find by name (server search, current site) or **words (list)** = filter of the listed
candidates on the phone; **one → hidden** = a single candidate is chosen and shown as one line.

## Warehouse and inventory

| Route | Field | Identifies | How it worked | How it works now | ✓ |
|---|---|---|---|---|---|
| `/inventory/move` | 1 · What are you moving? | lot or box | Text box "Scan, or type a name" (wedge or typing), matches by words | tap (lots with stock here, earliest expiry first) · scan (lot **or** box label) · words | ✓ |
| `/inventory/move` | 2 · Take it from | shelf holding the lot | Drop-down of all shelves with stock | tap the shelves that hold the lot · scan · one → hidden | ✓ |
| `/inventory/move` | 3 · Which shelf does it go to? | shelf | Text box "Scan the shelf label" + drop-down | tap (allowed shelves only) · scan · words; wrong-kind shelf warns | ✓ |
| `/inventory/[lotId]/move` | From which shelf? | shelf holding the lot | Drop-down | tap · scan · one → hidden | ✓ |
| `/inventory/[lotId]/move` | To which shelf? | shelf | Drop-down | tap (allowed shelves) · scan · words (list) | ✓ |
| `/inventory/receive/put-away` | To put away / Another lot? | lot waiting to be put away | Task cards + text box "Scan, or type the item name" (searched every lot, expired too) | tap (only lots QA said OK that still wait) · scan · words (list, only those lots) → opens the lot | ✓ |
| `/inventory/receive/put-away?lot=` | Take it from which place? | place holding the lot | Drop-down | tap · one → hidden | ✓ |
| `/inventory/receive/put-away?lot=` | Where does it go? | shelf | Chips + text box "Scan the shelf label" + datalist | tap (suggested shelf preselected, allowed places only) · scan · words (list) | ✓ |
| `/inventory/counts/[id]` (count a shelf) | What are you counting? | lot | Buttons of expected lots + text box "Scan the label" + "find by name" | tap (lots that should be on the shelf) · scan · words; "No label" path unchanged | ✓ |
| `/inventory/adjustments/new` (Fix stock) | Which lot? (per row) | lot | Text box "Scan, or type a name" + Find | scan · words (with the shelves that hold it) | ✓ |
| `/inventory/adjustments/new` | Which shelf? (per row) | shelf holding the lot | Drop-down | tap · one → hidden | ✓ |
| `/inventory/containers/new` (Pack into a box) | What goes in? | lot | Drop-down (first lot preselected: a fake default) | tap (lots with loose stock) · scan · words (list); nothing preselected unless one lot | ✓ |
| `/inventory/containers/new` | From which shelf? | shelf | Drop-down "if several" | tap · one → hidden | ✓ |
| `/inventory/containers/[id]` Split / Repack | Which one? | lot in the box | Drop-down | tap · scan · one → hidden (hidden input) | ✓ |
| `/inventory/containers/[id]` Put together | Which boxes go together? | boxes (several) | Tick boxes + text box "Scan the box label" | tap (boxes on the same shelf, several) · scan · words | ✓ |
| `/inventory/containers/[id]` Repack | Into which box? | box (optional) | Drop-down | tap · scan · words; none = a new box | ✓ |
| `/inventory/containers` | Search | filter | Search box "Box or lot number" | unchanged: list filter, not a field that identifies one thing | n/a |
| `/inventory/availability`, stock search | Search | filter | Words or number | unchanged: list filter | n/a |
| `/inventory/scan` (Scan or search) | Scanner | anything | "Scan a label or type a number"; camera fallback "Type the lot number" | the universal look-up page: "Scan the label, or type what it is" (e.g. coconut oil); camera fallback offers the handheld scanner or a name; help says where each label is stuck | ✓ |
| `/inventory/receive` | Supplier's lot number, receiving place | supplier's own code (external) | Text from the supplier's label; destination shown as codes | supplier's lot stays typed (it exists only on their label; QA traces with it, A-SCAN-14); destination and "put it in" shown by shelf name | n/a |
| `/inventory/movements/[id]` reverse | Replacement from/to | shelf | Drop-downs (manager correction) | unchanged (rare manager form, pick list by name) | n/a |
| `/warehouse/packs/[packId]` Add a box | Which lot are you boxing? | the pack's lot (check) | Text box "Scan the lot label" | tap or scan the one expected lot (V-MAT check kept on the server) | ✓ |
| `/warehouse/packs/[packId]` Checker | Scan each box label | box (verification) | Scanner with typing | scan only (camera + handheld); no typing, no tap: the scan is the check | ✓ |
| `/warehouse/repack` | Which boxes? | boxes (several) | Text area "Scan the box labels" | tap (product boxes QA said OK) · scan · words | ✓ |
| `/offline` Count | Which lot? | lot (or shelf) | Scanner with placeholder `BC:LOT:L-2610-00001` | tap (lots on the shelf, phone data) · scan (lot or shelf) · words (list) — works offline | ✓ |
| `/offline` Weigh | Which container? | lot | Scanner with placeholder `BC:LOT:…` | tap (lots OK for the ingredient, phone data) · scan · words (list) | ✓ |

## Sales: picking, second check, dispatch, returns

| Route | Field | Identifies | How it worked | How it works now | ✓ |
|---|---|---|---|---|---|
| `/sales/picking/[pickId]` | Scan the box | box or lot (loose) | Scanner (camera, scanner, type) placeholder `BC:BOX:BX-00000012 · BC:LOT:…`; typed = manual with reason | scan · the boxes still to take are listed; a **tap** is saved as entered by hand (reason defaulted "Label would not scan: tapped in the list", audited) | ✓ |
| `/sales/packing/[shipmentId]` (second check) | Scan each box | box or lot | Scanner with typing | scan only (camera + handheld). Not tappable: the independent check must see the label | ✓ |
| `/sales/shipments/[shipmentId]` (dispatch) | driver, plate | — | Text | unchanged: no lot/box identified here | n/a |
| `/sales/returns/[returnId]` | Which box or lot came back? | box or lot on that delivery | Text box "Scan the box or lot label… or type the number" + "I typed it" tick box | tap (what left on this delivery) · scan · words (list); a tap is recorded as entered by hand | ✓ |

## Quality

| Route | Field | Identifies | How it worked | How it works now | ✓ |
|---|---|---|---|---|---|
| `/quality/holds/new` | Which lot? | lot | Drop-down + "Scan the label" text box under More details | tap · scan · words | ✓ |
| `/quality/holds/new` | Which place? | place | Drop-down | tap (stopped places greyed) · scan · words (list) | ✓ |
| `/quality/holds/issue` | Which lot? | lot | Drop-down + scan text box | tap · scan · words | ✓ |
| `/quality/holds/issue` | From which place? | place holding the lot | Drop-down of every place | tap the places that hold the chosen lot · one → hidden | ✓ |
| `/quality/inspections/[id]` sample | Taken from which place? | place holding the lot | Drop-down (first preselected) | tap · one → hidden | ✓ |
| `/quality/inspections/[id]` sample | Box it came from (optional) | box | Text box "scan the box label" | scan · words (optional) | ✓ |
| `/quality/deviations/[id]` stop the lot | Lot to stop / other lot | lot | Text box "scan the label" | scan · words | ✓ |
| `/quality/label-verification` | Scan a box or lot label | box/lot (verification) | Text box, typing allowed | scan only (the scan is the check) | ✓ |
| `/quality/trace` | Which material or product (lot)? | lot | Long drop-down + "Scan the label" text box | tap (lots at the site) · scan (lot or box) · words; supplier's lot number kept under "Only have the supplier's lot number?" (external code) | ✓ |
| `/quality/recall` | Which material or product (lot)? | lot / box | Long drop-down + "Scan a label or complaint number" text box | tap · scan · words; from a complaint use the complaint's "Who received it" button; supplier's lot number kept | ✓ |
| `/quality/complaints/new` | Which lot? (optional) | lot on the product | Text box "Number on the product label" | scan · words (the digits the customer reads out) | ✓ |
| `/quality/bulk` | Lot prefix | filter | Text | unchanged: list filter for QA | n/a |

## Maintenance and purchasing

| Route | Field | Identifies | How it worked | How it works now | ✓ |
|---|---|---|---|---|---|
| `/maintenance/work-orders/[id]` | Which part? | spare part lot + place | Drop-down | tap (parts OK to use here) · scan · words (list) | ✓ |
| `/maintenance/*` | Which machine? | equipment | Drop-down by name | unchanged (picked by name; no code typed). Equipment labels (`BC:EQP`) are not a ScanOrPick kind yet | n/a |
| `/procurement/returns/[id]` | Which lot? | rejected lot + place | Drop-down | tap · scan · words (list) | ✓ |

## Production (adopted by the production pass, one path for production work 2026-10-31)

The old batch workspace forms are gone (`/production/[batchId]` is a read-only batch record), so the packaging,
transfer and step fields of that page no longer exist. Production fields now:

| Route | Field | Identifies | Setup | Done |
|---|---|---|---|---|
| `/production/orders/[id]/step/[n]` packaging box (no packaging lines) | `lotRef` + `locationRef` | packaging lot, shelf | `kind="lot"` candidates = released packaging lots at the site (tap · scan · words); then `kind="location"` = places of the chosen lot, `hideWhenSingle`, `onlyCandidates` | ✓ |
| `/production/orders/[id]/step/[n]` packaging box (packaging lines) | — | — | the taken lot is shown; nothing to identify | ✓ |
| `/production/orders/[id]/weigh` | `lotConfirm` | lot | `kind="lot"`, `mode="emit"`, `allowTap={false}`, `onlyCandidates` (a tap is not a scan, A-SCAN-11; ADR-080 §3); typing the last 4 only for a damaged label | ✓ |
| `/production/orders/[id]/weigh/more` ("Other ways to weigh", exec-forms `WeighForm`) | `lotRef` + `locationRef` | lot, shelf | `kind="lot"` candidates = usable lots (FEFO) with `places`; `kind="location"` `hideWhenSingle` | ✓ |
| `/production/orders/[id]/materials` (setting scan_lots) | `lotCode` | lot | `kind="lot"`, `allowTap={false}`, `onlyCandidates`, candidates = the lot to take | ✓ |
| `/production/[batchId]/finish` | `locationRef` | hold area | `kind="location"`, candidates = hold areas, `onlyCandidates` | ✓ |
| `/production/staging/[batchId]` ("Lots and sheets") QA substitution | `substituteLotCode` | lot | `kind="lot"` scan · words | ✓ (scan-to-stage removed: Materials list) |
| step card equipment | `equipmentRef` | equipment | big radio cards (equipment kind not in ScanOrPick yet) | open |
| `/labels/**`, `/print/**` | reprint reason, copies | — | no lot/box identified by typing (labels pass to confirm) | — |

## Component API (for adopters)

```tsx
import { ScanOrPick, type PickCandidate } from "@/ui/scan-or-pick";

<ScanOrPick
  kind="lot" | "container" | "location" | "batch" | "item"
  label="Which lot?"                 // the question
  name="lotRef"                      // hidden input; omit for client-only use
  candidates={[{ value: lot.id, title: "Coconut oil", detail: "lot L-2610-00001 · 25 kg on A-01",
                 code: "L-2610-00001", codes: ["L-2610-00001"], places?: [...], disabledReason? }]}
  candidatesLabel="Set aside for this batch"
  submit="value" | "code"            // send the id (default) or the number
  defaultValue / value / onChange={(value, candidate, via) => …}
  required onlyCandidates hideWhenSingle search={true} maxShown={6} error={fe.lotRef}
  multiple  /* several: one hidden input per choice, onChangeMany */
  viaName="lotVia"                   // also send "tap" | "scan"
  mode="emit" onEmit={(value, candidate, via) => …} allowTap alsoAccept={["container"]} pending done
/>
```

Server: `findPickCandidates(ctx, kind, text)` and `resolvePickRef(ctx, kind, raw)` in `src/modules/scan/pick.ts`
(through `src/app/(app)/scan-pick-actions.ts`). Pure rules: `src/lib/scan/pick.ts` (`classifyPickInput`,
`matchCandidate`, `filterCandidates`, `isScannerBurst`, messages). Lot candidates carry `places` (the shelves that
hold the lot at the current site) and `uom`, so a "which shelf?" field can follow without another call.
