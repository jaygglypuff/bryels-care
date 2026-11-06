/**
 * Whom to ask when a screen is refused (pure, unit-tested). Named colleagues first ("Ask Rosa Lim (Purchasing)
 * or Ana Villanueva (Owner)"); otherwise a role that is not the viewer's own: a site manager or owner is never
 * told to "ask your site manager".
 */
export function forbiddenAskLine(viewerRoles: readonly string[], people: readonly { name: string; role: string }[]): string {
  const named = people.slice(0, 3);
  if (named.length) return `Ask ${named.map((p) => `${p.name} (${p.role})`).join(" or ")} to do it, or to give you access.`;
  if (viewerRoles.includes("owner_director")) return "Ask your system administrator if you need it.";
  if (viewerRoles.includes("site_manager")) return "Ask the owner if you need it.";
  return "Ask your site manager if you need it.";
}

/** The actions that do the work on a record, in the order we look for one (live check 2026-11-06). */
const DOING_ACTIONS = ["create", "post", "approve", "edit", "submit"] as const;

/**
 * The permission whose holders a refused person should ask: the people who can DO the work, not the people who may
 * only look (live check 2026-11-06: a sales person refused a QA check was told to ask the owner, the planner and the
 * manager, who may view it, instead of the QA people). For `module.entity.view` the first of create, post, approve,
 * edit, submit that exists in `catalog` for the same entity; any other permission is returned unchanged.
 */
export function doingPermission(permission: string, catalog: readonly string[]): string {
  if (!permission.endsWith(".view")) return permission;
  const base = permission.slice(0, -".view".length);
  for (const a of DOING_ACTIONS) if (catalog.includes(`${base}.${a}`)) return `${base}.${a}`;
  return permission;
}
