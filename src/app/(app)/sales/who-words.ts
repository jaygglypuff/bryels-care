/**
 * Pure sentence part for `whoDoes` (unit-tested, re-audit B N5): the people who can do a step, by name, with
 * the people of the team that normally does it first ("Lito Pascual (Warehouse Operator) or Dino Reyes (Site
 * Manager)"). When more than two can, the rest is said in team words ("or another warehouse person") only if
 * one of them really is from that team; a single extra person is named; otherwise "or someone else who may do it".
 */
export type WhoPerson = { name: string; role: string };
export type Team = { prefer: readonly string[]; others: string };

export const WAREHOUSE_TEAM: Team = { prefer: ["warehouse"], others: "another warehouse person" };
export const PURCHASING_TEAM: Team = { prefer: ["procurement", "purchasing"], others: "someone else from purchasing" };

/** Steps done by a team: the people of that team are named first. */
export const TEAM_OF_PERMISSION: Record<string, Team> = {
  "inventory.pack.approve": WAREHOUSE_TEAM,
  "inventory.allocation.create": WAREHOUSE_TEAM,
  "sales.pick.create": WAREHOUSE_TEAM,
  "sales.shipment.post": WAREHOUSE_TEAM,
};

const inTeam = (p: WhoPerson, team: Team) => team.prefer.some((w) => p.role.toLowerCase().includes(w));
const named = (p: WhoPerson) => `${p.name} (${p.role})`;

/** The same people, those of `team` first (stable: otherwise the directory's order, by name). */
export function teamFirst<P extends WhoPerson>(people: readonly P[], team: Team | null | undefined): P[] {
  return team ? [...people].sort((a, b) => Number(inTeam(b, team)) - Number(inTeam(a, team))) : [...people];
}

export function whoWords(people: readonly WhoPerson[], roles: readonly string[], fallback: string, team?: Team | null): string {
  if (people.length > 0) {
    const sorted = teamFirst(people, team);
    if (sorted.length <= 2) return sorted.map(named).join(" or ");
    const shown = sorted.slice(0, 2).map(named);
    const rest = sorted.slice(2);
    const tail = rest.length === 1 ? named(rest[0]) : team && rest.some((p) => inTeam(p, team)) ? team.others : "someone else who may do it";
    return `${shown.join(", ")} or ${tail}`;
  }
  if (roles.length > 0) return `the ${roles.slice(0, 2).join(" or ")}`;
  return fallback;
}
