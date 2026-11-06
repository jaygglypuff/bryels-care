-- Wave 1 W1B data backfill (run ONCE after the receiving migration on a database that already holds
-- MVP receipts, e.g. a staging demo database; fresh databases get this from src/db/seeds/w1b.ts).
-- MVP receipts were posted in one step before receipts became documents; the migration gives them
-- status 'draft' by default, so mark them posted and copy line details from their lots.
-- Idempotent: only touches rows still in the pre-migration shape.

begin;

update goods_receipts g
set status = 'posted',
    posted_at = g.received_at,
    posted_by = g.received_by,
    created_by = coalesce(g.created_by, g.received_by),
    unplanned_reason_code = coalesce(g.unplanned_reason_code, 'no_purchase_order'),
    supplier_id = coalesce(g.supplier_id, (select s.id from suppliers s where s.organization_id = g.organization_id and lower(s.name) = lower(g.supplier_name) limit 1))
where g.status = 'draft'
  and g.receipt_number is not null
  and exists (select 1 from goods_receipt_lines l where l.goods_receipt_id = g.id and l.lot_id is not null);

update goods_receipt_lines l
set line_no = x.rn,
    supplier_lot_number = coalesce(l.supplier_lot_number, lot.supplier_lot_number),
    manufactured_on = coalesce(l.manufactured_on, lot.manufactured_on),
    expires_on = coalesce(l.expires_on, lot.expires_on),
    qty_entered = coalesce(l.qty_entered, l.qty_base),
    uom_entered = coalesce(l.uom_entered, lot.base_uom),
    created_by = coalesce(l.created_by, g.received_by),
    stock_movement_id = coalesce(l.stock_movement_id, (select m.id from stock_movements m where m.lot_id = l.lot_id and m.movement_type = 'receipt' order by m.posted_at limit 1))
from (select id, row_number() over (partition by goods_receipt_id order by created_at, id) as rn from goods_receipt_lines) x,
     inventory_lots lot,
     goods_receipts g
where x.id = l.id and lot.id = l.lot_id and g.id = l.goods_receipt_id and l.line_no is null;

commit;

-- Receipts whose supplier name matched no supplier stay unlinked: QA cannot release their quarantined
-- lots until procurement links them on the receipt page (procurement.goods_receipt.supplier_linked).
