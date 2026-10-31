/** Only same-site paths are followed back (never `//host` or a full URL). */
export function safeBack(v: string | undefined | null): string | null {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\") || v.length > 300) return null;
  return v;
}

/** The record a label belongs to, used as the back link when the task screen did not pass one. */
export function recordHref(entityType: string, entityId: string): string {
  if (entityType === "inventory_lot") return `/inventory/${entityId}`;
  if (entityType === "location") return `/inventory/locations/${entityId}`;
  if (entityType === "container") return `/inventory/containers/${entityId}`;
  if (entityType === "batch") return `/production/${entityId}`;
  return "/labels";
}
