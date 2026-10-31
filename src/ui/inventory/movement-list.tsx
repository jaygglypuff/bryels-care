import { fmtDateTime } from "@/lib/qty";
import { EmptyState } from "@/ui/core";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { MovementChip, fmtLotQty, placeWords } from "./bits";

/** One stock change as the shared list needs it (site ledger, lot page, box page, correction rows). */
export type MovementRowData = {
  id: string;
  movementType: string;
  qtyBase: string;
  baseUom: string;
  postedAt: Date | string;
  postedBy?: string | null;
  reason?: string | null;
  fromCode?: string | null;
  toCode?: string | null;
  fromName?: string | null;
  toName?: string | null;
  lotNumber?: string | null;
  itemName?: string | null;
  productName?: string | null;
  reversed?: boolean;
};

/**
 * Stock changes as a grade-5 list (ADR-088), the same on a 390 px phone and on a desktop: what (item or
 * type) first, the change type as a chip with an icon, the shelves in words, who and when; the amount on
 * the right in friendly units; the lot number small and grey. The whole row opens the stock change.
 * Replaces the eight-column ledger table that only showed WHEN and TYPE on a phone.
 */
export function MovementList({ rows, showItem = true, label = "Stock changes", empty }: { rows: MovementRowData[]; showItem?: boolean; label?: string; empty?: { title: string; text?: string } }) {
  if (rows.length === 0) return <EmptyState title={empty?.title ?? "No stock changes yet"}>{empty?.text}</EmptyState>;
  return (
    <PlainList label={label}>
      {rows.map((m) => {
        const item = m.itemName ?? m.productName;
        const where = placeWords(m.fromName ?? m.fromCode, m.toName ?? m.toCode);
        return (
          <PlainRow
            key={m.id}
            testId="movement-row"
            href={`/inventory/movements/${m.id}`}
            title={showItem && item ? item : <span className="sr-only">Stock change</span>}
            status={
              <>
                <MovementChip type={m.movementType} />
                {m.reversed && <span className="text-[12px] text-muted">(undone)</span>}
              </>
            }
            facts={
              <>
                {where && <span>{where} · </span>}
                {m.postedBy ? `${m.postedBy} · ` : ""}
                {fmtDateTime(m.postedAt)}
                {m.reason && <span className="block text-[12px] text-muted">“{m.reason}”</span>}
              </>
            }
            code={m.lotNumber ?? undefined}
            aside={<span className="font-semibold tabular text-[15px] text-fg">{fmtLotQty(m.qtyBase, m.baseUom)}</span>}
          />
        );
      })}
    </PlainList>
  );
}
