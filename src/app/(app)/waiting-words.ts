import { USERS_MENU_PATH } from "@/lib/menu-paths";

/** Pure sentence builder for `waitingFor` (unit-tested): up to three named people, else the role words. */
export function waitingLine(people: readonly { name: string; role: string }[], verb: string, fallbackRole: string): string {
  const named = people.slice(0, 3);
  if (named.length) return `Waiting for ${named.map((p) => `${p.name} (${p.role})`).join(" or ")} ${verb}.`;
  return `Waiting for ${fallbackRole} ${verb}. Nobody at this site can do it yet: an administrator can give the role under ${USERS_MENU_PATH}.`;
}
