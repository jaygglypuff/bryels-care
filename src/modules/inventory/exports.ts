import "server-only";
import type { ExportDefinition } from "@/lib/export";
import { type AvailabilityFilter, type AvailabilityRow, availabilityRows, manilaToday } from "./availability";
import { getStockCard } from "./stock-card";

/** Availability export (inventory.balance.export): the same rows as the screen, same scope. */
export const availabilityExport: ExportDefinition<AvailabilityFilter & Record<string, unknown>, AvailabilityRow> = {
  code: "inventory.availability",
  title: "Stock availability",
  permission: "inventory.balance.export",
  sensitivity: "N",
  siteScope: (_ctx, f) => [f.siteId],
  fileName: (f) => `availability-${f.asOf ?? manilaToday()}`,
  fetch: (ctx, f, limit) => availabilityRows(ctx, { ...f, asOf: f.asOf ?? manilaToday() }, limit),
  columns: [
    { header: "Lot", value: (r) => r.lotNumber },
    { header: "Item code", value: (r) => r.itemCode },
    { header: "Item", value: (r) => r.itemName },
    { header: "Status", value: (r) => r.qualityStatus },
    { header: "Bucket", value: (r) => r.bucket },
    { header: "Expires on", value: (r) => r.expiresOn },
    { header: "Location", value: (r) => r.locationCode },
    { header: "Unit", value: (r) => r.baseUom },
    { header: "On hand", value: (r) => r.onHand, numeric: true },
    { header: "Reserved", value: (r) => r.reserved, numeric: true },
    { header: "Allocated", value: (r) => r.allocated, numeric: true },
    { header: "Quarantined", value: (r) => r.quarantined, numeric: true },
    { header: "On hold", value: (r) => r.onHold, numeric: true },
    { header: "Expired", value: (r) => r.expired, numeric: true },
    { header: "Recalled", value: (r) => r.recalled, numeric: true },
    { header: "Rejected", value: (r) => r.rejected, numeric: true },
    { header: "Available", value: (r) => r.available, numeric: true },
    { header: "Allocated on blocked stock", value: (r) => r.allocatedBlocked, numeric: true },
  ],
};

type CardRow = {
  when: string;
  number: string;
  type: string;
  from: string;
  to: string;
  container: string;
  qtyIn: string;
  qtyOut: string;
  qtyMoved: string;
  running: string;
  status: string;
  source: string;
  postedBy: string;
  reason: string;
  reversal: string;
};

export type StockCardFilter = { lotId: string; from: string; to: string; locationId?: string | null };

/** Stock card export (inventory.movement.export): opening, movements, closing and projection check. */
export const stockCardExport: ExportDefinition<StockCardFilter & Record<string, unknown>, CardRow> = {
  code: "inventory.stock_card",
  title: "Stock card",
  permission: "inventory.movement.export",
  sensitivity: "N",
  // The lot's site is enforced by getStockCard; the audit records the current scope of the card.
  siteScope: () => [],
  fileName: (f) => `stock-card-${f.from}-${f.to}`,
  fetch: async (ctx, f, limit) => {
    const card = await getStockCard(ctx, f);
    const blank = { when: "", number: "", type: "", from: "", to: "", container: "", qtyIn: "", qtyOut: "", qtyMoved: "", status: "", source: "", postedBy: "", reason: "", reversal: "" };
    const rows: CardRow[] = [
      { ...blank, type: `Opening balance ${card.lot.lotNumber}${card.location ? ` at ${card.location.code}` : ""} (${card.lot.baseUom})`, when: card.from, running: card.opening },
      ...card.lines.map((l) => ({
        when: l.postedAt.toISOString(),
        number: l.number,
        type: l.movementType,
        from: l.fromCode ?? "",
        to: l.toCode ?? "",
        container: l.container ?? "",
        qtyIn: l.qtyIn ?? "",
        qtyOut: l.qtyOut ?? "",
        qtyMoved: l.qtyMoved ?? "",
        running: l.running,
        status: l.statusAtPosting ?? "",
        source: [l.sourceDocumentType, l.sourceDocumentNumber].filter(Boolean).join(" "),
        postedBy: l.postedBy,
        reason: l.reason ?? "",
        reversal: l.reversalOf ? `reversal of ${l.reversalOf}` : l.reversedBy ? `reversed by ${l.reversedBy}` : "",
      })),
      { ...blank, type: "Closing balance", when: card.to, running: card.closing },
      {
        ...blank,
        type: card.check.flagged ? "PROJECTION DIFFERENCE" : "Projection check",
        reason: `Ledger now ${card.check.ledgerNow}, projection ${card.check.projection}, difference ${card.check.difference}`,
        running: card.check.projection,
      },
    ];
    return rows.slice(0, limit);
  },
  columns: [
    { header: "When", value: (r) => r.when },
    { header: "Number", value: (r) => r.number },
    { header: "Type", value: (r) => r.type },
    { header: "From", value: (r) => r.from },
    { header: "To", value: (r) => r.to },
    { header: "Container", value: (r) => r.container },
    { header: "In", value: (r) => r.qtyIn, numeric: true },
    { header: "Out", value: (r) => r.qtyOut, numeric: true },
    { header: "Moved", value: (r) => r.qtyMoved, numeric: true },
    { header: "Running balance", value: (r) => r.running, numeric: true },
    { header: "Status at posting", value: (r) => r.status },
    { header: "Source document", value: (r) => r.source },
    { header: "Posted by", value: (r) => r.postedBy, personalData: true },
    { header: "Reason", value: (r) => r.reason },
    { header: "Reversal", value: (r) => r.reversal },
  ],
};
