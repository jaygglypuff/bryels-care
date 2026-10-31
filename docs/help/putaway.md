---
key: inventory.putaway
title: Put away a received lot
version: 4
updated_at: 2026-10-31
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

Move goods out of the hold area or the dock to the shelf they belong on. When QA releases a lot you get a message (the bell at the top), for example "Coconut Oil lot L-2610-00024 is ready — put it on A-01". The **To put away** list shows every lot QA has released that is still waiting. The **Put away** tile on Home shows how many.

## The To put away list

1. Open **Put away**. At the top you see **To put away (3)**: one card per lot, the oldest release first.
2. Each card shows the item, the lot number, how much (for example **60 kg** or **118 pcs**), where it is now and the suggested shelf, for example "from QUA-01 → **A-01** (Raw materials)".
3. Tap the card. The lot, where it is now and the suggested shelf are filled in for you.
4. **It is in boxes**: the card opens the Move screen. Scan each box there.
5. **Nothing to put away**: QA has not released anything that is still in the hold area.

## Find a lot without the list

1. Scan the square code on the sack's label, or type the lot number. No label on the sack? Open the lot, then **⋯ More › Print a label** (see [Labels](labels.md)).
2. You can also type only the last digits (for example **0012**) or the supplier's lot number. If more than one lot fits, the screen asks **Which lot do you mean?**. Tap the right one.
3. A lot that is still waiting for QA can only move between quarantine and hold areas.

## Where it goes

1. The suggested shelf is already chosen. To use another place, tap its button, or scan the shelf label (the label on the front edge of the shelf). A shelf without a label: open the shelf, then **⋯ More › Print a label**.
2. Released stock goes to storage. Quarantine stock only to quarantine or hold areas.
3. **No allowed location**: there is no open place of the right type. Tell your site manager.

## How much

1. Leave **How much?** empty to move everything from that place.
2. To move a part, type it in kg (or g, pcs, L as shown next to the field).

## Confirm

1. Press **Put away to A-01** once. The lot leaves the list.
2. Pressing it twice does not move the goods twice.
3. If you made a mistake, use **Undo** on the move screen within the time shown. After that, ask a site manager to reverse it.
