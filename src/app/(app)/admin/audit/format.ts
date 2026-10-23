/** Presentation helpers for audit events (module.entity.event). */

const MODULE_LABEL: Record<string, string> = {
  identity: "Identity",
  platform: "Platform",
  masterdata: "Master data",
  inventory: "Inventory",
  production: "Production",
  quality: "Quality",
  sales: "Sales",
  analytics: "Analytics",
};

export const moduleLabel = (m: string) => MODULE_LABEL[m] ?? m.charAt(0).toUpperCase() + m.slice(1);

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
    default:
      return null;
  }
}
