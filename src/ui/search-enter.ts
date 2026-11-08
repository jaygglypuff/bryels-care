/**
 * What Enter opens in the master search (round 5, ADR-129; A report bug B14: "0003" + Enter opened the QA test
 * INS-26-00003 instead of batch B-26-0003, and "acapulco" + Enter opened the ingredient's set-up page). Pure, no React,
 * unit-tested in tests/unit/search-enter.test.ts.
 *
 * In this order:
 * 1. the record whose whole number was typed (one exact match: `exactHref`, or the one row marked exact);
 * 2. the row the person highlighted (arrow keys or the mouse), never a row highlighted only by default;
 * 3. the one thing to do whose words were typed exactly ("new customer");
 * 4. the only row there is.
 * Otherwise nothing opens: the list stays, with a line saying to choose one. Never the first hit of an unrelated type.
 */
export type EnterRow = { href: string; /** A record whose number was typed, or an action whose words were typed. */ exact?: boolean; /** A recent search (puts its words back in the box). */ query?: string; kind?: "record" | "action" | "screen" | "recent" };

export function enterChoice<R extends EnterRow>(rows: readonly R[], o: { exactHref: string | null; active: number; moved: boolean }): R | null {
  if (o.exactHref) {
    const hit = rows.find((r) => r.href === o.exactHref);
    if (hit) return hit;
  }
  const exactRecords = rows.filter((r) => r.exact && r.kind === "record");
  if (exactRecords.length === 1) return exactRecords[0];
  if (o.moved && o.active >= 0 && o.active < rows.length) return rows[o.active];
  const exactActions = rows.filter((r) => r.exact && r.kind === "action");
  if (exactActions.length === 1) return exactActions[0];
  if (rows.length === 1) return rows[0];
  return null;
}
