/** Presentation helpers for audit events (module.entity.event). */

import { plainModule } from "@/ui/permission-words";

/** Plain area names (ADR-088), shared with the roles and permission screens. */
export const moduleLabel = (m: string) => plainModule(m);

/** "inventory.goods_receipt.posted" → "Goods receipt posted". */
export function actionLabel(action: string): string {
  const [, entity = "", event = ""] = action.split(".");
  const s = `${entity.replace(/_/g, " ")} ${event.replace(/_/g, " ")}`.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const actionModule = (action: string) => action.split(".")[0] ?? "";

/** Route of the record an event points to, when that record has a detail page. */
export function entityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  switch (entityType) {
    case "inventory_lot":
    case "lot":
      return `/inventory/${entityId}`;
    case "batch":
      return `/production/${entityId}`;
    case "sales_order":
      return `/sales/${entityId}`;
    case "user":
      return `/admin/users/${entityId}`;
    case "role":
      return `/admin/roles/${entityId}`;
    case "stock_movement":
      return `/inventory/movements/${entityId}`;
    case "background_job":
      return `/admin/diagnostics?job=${entityId}#jobs`;
    case "reconciliation_run":
      return `/admin/diagnostics?run=${entityId}#reconciliation`;
    default:
      return null;
  }
}
