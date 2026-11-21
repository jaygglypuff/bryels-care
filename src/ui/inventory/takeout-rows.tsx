import Link from "next/link";
import { plainDate } from "@/lib/plain-date";
import type { TakeoutLineRow } from "@/modules/inventory";
import { Chip } from "@/ui/status";

/**
 * ADR-138: take-outs as plain rows (lot page, trace, customer page): pieces, product, why (shop, sample's customer),
 * who and when, the lot, and "Undone" when it was reversed. Server component; the caller loads the rows (scoped).
 */
export function TakeoutRows({ rows, showLot = true, showProduct = true, testId }: { rows: TakeoutLineRow[]; showLot?: boolean; showProduct?: boolean; testId?: string }) {
  return (
    <ul className="flex flex-col divide-y divide-line text-[14px]" data-testid={testId}>
      {rows.map((r) => (
        <li key={`${r.takeoutId}:${r.lineNo}`} className="flex flex-col gap-0.5 py-2">
          <span className="font-medium">
            {r.pieces} {showProduct ? r.productName : r.pieces === "1" ? "piece" : "pieces"} · {r.sentence} {r.status === "reversed" && <Chip tone="neu">Undone</Chip>}
          </span>
          <span className="text-fg-2">
            {r.personName} · {plainDate(r.at)} · from {r.boxNumber ? `box ${r.boxNumber}` : "loose pieces"} on {r.placeCode}
          </span>
          <span className="text-[12px] text-muted">
            <Link className="text-primary-text hover:underline" href={`/inventory/take-outs/${r.takeoutId}`}>
              {r.takeoutNumber}
            </Link>
            {showLot && (
              <>
                {" "}
                · lot{" "}
                <Link className="font-mono text-primary-text hover:underline" href={`/inventory/${r.lotId}`}>
                  {r.lotNumber}
                </Link>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
