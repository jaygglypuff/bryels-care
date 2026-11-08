/**
 * Which quick guide the frame's "?" opens for a screen (round 4, UX re-audit C #9: one Help button on every
 * screen). The most specific pattern wins (first match in this list); a screen without its own guide gets the
 * person's role guide ("your day in 5 steps"), and anyone else the everyday basics. Pure; unit tested
 * (tests/unit/frame-help.test.ts). Keys are the ones in GUIDE_FILES (src/ui/help/guides.ts).
 */
export const SCREEN_GUIDES: readonly (readonly [RegExp, string])[] = [
  [/^\/inventory\/receive\/put-away/, "inventory.putaway"],
  // ADR-110 C0: How work flows and the list behind each number
  [/^\/operations\/flow/, "operations.work_flow"],
  [/^\/inventory\/receive/, "inventory.receive"],
  [/^\/inventory\/receipts/, "inventory.receive"],
  [/^\/inventory\/move/, "inventory.move"],
  [/^\/inventory\/counts/, "inventory.count"],
  [/^\/labels/, "inventory.labels"],
  [/^\/production\/orders\/[^/]+\/materials/, "production.materials_list"],
  [/^\/production\/orders\/[^/]+\/weigh/, "production.weigh"],
  [/^\/production\/orders\/[^/]+\/step/, "production.step"],
  [/^\/production\/[^/]+\/finish/, "production.finish"],
  [/^\/production\/[^/]+\/closure/, "production.bmr"],
  [/^\/production/, "production.production_order"],
  [/^\/quality\/check/, "quality.check"],
  [/^\/quality\/complaints/, "quality.complaint"],
  [/^\/quality(\/batches|\/lots)?(\/|$)/, "quality.release"],
  [/^\/sales\/returns/, "sales.return"],
  [/^\/sales\/(picking|packing|dispatch|shipments)/, "sales.fulfilment"],
  [/^\/sales/, "sales.order"],
  // ADR-131: buying (what to buy → delivery problems) and money (invoices, payments, bills, month end)
  [/^\/procurement/, "procurement.buying"],
  [/^\/finance/, "finance.money"],
  [/^\/admin\/imports/, "platform.import"],
  [/^\/(analytics|reports)/, "analytics.reports"],
  [/^\/masterdata\/lists/, "masterdata.lists"],
];

/** Role code → role guide key (same split as ROLE_GUIDES on /help). */
const ROLE_GUIDE: Record<string, string> = {
  owner_director: "role.owner",
  production_operator: "role.operator",
  warehouse_operator: "role.warehouse",
  qa_qc: "role.qa",
};

export function guideKeyFor(pathname: string, roles: readonly string[]): string {
  const path = pathname.split("?")[0];
  for (const [re, key] of SCREEN_GUIDES) if (re.test(path)) return key;
  for (const r of roles) if (ROLE_GUIDE[r]) return ROLE_GUIDE[r];
  return roles.length ? "role.site_manager" : "start.everyday_basics";
}
