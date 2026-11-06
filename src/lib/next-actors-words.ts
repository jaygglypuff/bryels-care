/**
 * "Who approves next" in plain words (owner request 2026-11-01: "Every approval must indicate who approves next").
 * Pure and client-safe: the server helper `nextActors` (src/modules/governance/next-actors.ts) finds the people, these
 * functions phrase them, and `<NextApprover>` (src/ui/next-approver.tsx) shows them. Unit-tested in
 * tests/unit/next-actors-words.test.ts.
 */

export type NextPerson = { userId: string; name: string; /** Role word as people say it ("site manager", "operator"). */ role: string };

export type NextActors = {
  kind: string;
  /** Third person, after the names: "checks this weighing", "approves it". */
  does: string;
  /** Base form, after "You can": "check this weighing", "approve it". */
  doBase: string;
  /** Where the next people find it: "on their Home", "in To approve", "on Check quality". */
  where: string;
  /** Everyone who can do the next step, best match first; never the viewer, never a person the rules exclude. */
  people: NextPerson[];
  /** Role words when nobody holds the role yet ("a site manager", "QA"). */
  roleWords: string;
  /** The signed-in person may do it too (`selfApproval`: only because ADR-091 lets a top role approve their own record). */
  viewer: { can: boolean; selfApproval: boolean; note: string | null };
  /** Step position of a record with approval steps ("step 2 of 2"); null when there is one step. */
  stepNo: number | null;
  stepsTotal: number | null;
};

/** Role code → the word people use for a colleague's job ("Rhea (operator)"). Custom roles keep their name in lower case. */
export const PERSON_ROLE: Record<string, string> = {
  owner_director: "owner",
  site_manager: "site manager",
  production_operator: "operator",
  warehouse_operator: "warehouse",
  qa_qc: "QA",
  sales_cs: "sales",
  finance: "finance",
  procurement: "purchasing",
  production_planner: "planner",
  system_admin: "IT",
  auditor: "auditor",
  floor_display: "production TV",
};

/** Role code → words for "nobody holds it yet": "a site manager", "the owner", "QA". */
export const ROLE_PHRASE: Record<string, string> = {
  owner_director: "the owner",
  site_manager: "a site manager",
  production_operator: "an operator",
  warehouse_operator: "the warehouse",
  qa_qc: "QA",
  sales_cs: "sales",
  finance: "finance",
  procurement: "purchasing",
  production_planner: "a planner",
  system_admin: "the IT person",
};

export function personRole(code: string, name?: string | null): string {
  return PERSON_ROLE[code] ?? (name ? name.toLowerCase() : code.replace(/_/g, " "));
}

/** "a site manager or the owner" from role codes (empty → `fallback`). */
export function roleCodesWords(codes: readonly string[], fallback: string): string {
  const words = [...new Set(codes.map((c) => ROLE_PHRASE[c] ?? c.replace(/_/g, " ")))];
  return words.length ? joinOr(words) : fallback;
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;

/** "A, B or C". */
export function joinOr(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}

/**
 * "Rhea (operator), Jun (operator) or Dino (site manager)"; more than `max` people: the first `max` and "or 2 others".
 * First names; two shown people with the same first name keep their full names.
 */
export function peopleWords(people: readonly NextPerson[], max = 3): string {
  const shown = people.slice(0, max);
  const firsts = shown.map((p) => firstName(p.name));
  const label = shown.map((p, i) => `${firsts.filter((f) => f === firsts[i]).length > 1 ? p.name.trim() : firsts[i]} (${p.role})`);
  const rest = people.length - shown.length;
  if (rest > 0) return `${label.join(", ")} or ${rest === 1 ? "1 other" : `${rest} others`}`;
  return joinOr(label);
}

function stepSuffix(n: Pick<NextActors, "stepNo" | "stepsTotal">): string {
  return n.stepsTotal && n.stepsTotal > 1 && n.stepNo ? ` (step ${n.stepNo} of ${n.stepsTotal})` : "";
}

export const NOBODY_YET = "Nobody can do it yet: an administrator gives the role under Management › People & access › People who use the app.";

/**
 * The one sentence about the next person:
 * - "Next: Rhea (operator) or Dino (site manager) checks this weighing — they will see it on their Home."
 * - "You can approve this yourself because you are the owner." (ADR-091)
 * - "You can check this weighing now. So can Jun (operator)."
 * - "Next: a site manager approves it. Nobody can do it yet: …"
 */
export function nextActorsSentence(n: NextActors): string {
  const step = stepSuffix(n);
  if (n.viewer.selfApproval && n.viewer.note) return n.people.length ? `${n.viewer.note} ${capital(peopleWords(n.people))} can do it too.` : n.viewer.note;
  if (n.viewer.can) return `You can ${n.doBase}${step} now.${n.people.length ? ` So can ${peopleWords(n.people)}.` : ""}`;
  if (n.people.length) return `Next: ${peopleWords(n.people)} ${n.does}${step} — they will see it ${n.where}.`;
  return `Next: ${n.roleWords} ${n.does}${step}. ${NOBODY_YET}`;
}

/** The short form for cards ("Waiting for Rhea or Dino"): first names only, max 3. */
export function waitingForNames(n: NextActors): string | null {
  if (!n.people.length) return null;
  const names = [...new Set(n.people.map((p) => firstName(p.name)))];
  const shown = names.slice(0, 3);
  return names.length > 3 ? `${shown.join(", ")} or ${names.length - 3 === 1 ? "1 other" : `${names.length - 3} others`}` : joinOr(shown);
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
