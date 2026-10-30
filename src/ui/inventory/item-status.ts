import type { ItemState } from "@/modules/inventory/stock-by-item";

/**
 * Plain words for stock states (owner review 2026-10-30): no "Quarantined", no "FEFO". The codes come from
 * the server read model `stockByItem`; this file only names them. Colours and icons: stock-items.tsx.
 */
export const ITEM_STATE_LABEL: Record<ItemState, string> = {
  ok: "Ready to use",
  expiring: "Expiring soon",
  waiting: "Waiting for QA check",
  on_hold: "Stopped by QA",
  low: "Low stock",
  expired: "Expired – do not use",
  rejected: "Rejected – do not use",
  recalled: "Recalled – do not use",
};

export type StockChipKey = "" | "ok" | "waiting" | "on_hold" | "expiring" | "low";

/** The chips above the list, in the order the owner reads them. */
export const STATUS_CHIPS: { key: StockChipKey; label: string }[] = [
  { key: "", label: "All" },
  { key: "ok", label: "Ready to use" },
  { key: "waiting", label: "Waiting for QA check" },
  { key: "on_hold", label: "Stopped by QA" },
  { key: "expiring", label: "Expiring" },
  { key: "low", label: "Low stock" },
];

/** Older links (/inventory?status=quarantine …) keep working with the new chips. */
export function normaliseStockStatus(s: string | undefined): "ok" | "waiting" | "on_hold" | "expiring" | "low" | "do_not_use" | undefined {
  switch (s) {
    case "ok":
    case "released":
      return "ok";
    case "waiting":
    case "quarantine":
      return "waiting";
    case "on_hold":
      return "on_hold";
    case "expiring":
      return "expiring";
    case "low":
      return "low";
    case "do_not_use":
    case "expired":
    case "rejected":
    case "recalled":
      return "do_not_use";
    default:
      return undefined;
  }
}
