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
