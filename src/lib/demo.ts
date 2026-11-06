/**
 * Demo mode (ADR-055, docs/railway-for-dummies.md, docs/deployment-railway.md §2.4).
 *
 * Pure helpers with no database or Next.js imports, so the seed scripts (tsx), the worker, the
 * Next.js server and the unit tests all read the same rules.
 *
 * - `DEMO_MODE=true` turns the demo on: the fictional seed loads itself into an empty database at
 *   start, the sign-in page offers one-click demo accounts, the app shows a "Demo environment" banner
 *   and the owner can reset the demo data.
 * - `ALLOW_DEMO_SEED=true` is the older name and is read as `DEMO_MODE=true` (kept so existing
 *   development `.env` files and the test harness keep working).
 * - `APP_ENV=production` always wins: demo mode is off there whatever else is set.
 * - Demo data and real data never mix: the seed and the reset refuse while any account exists whose
 *   email is not a demo address (`@bryels-care.test`, or the organization's system actor).
 */

export const DEMO_EMAIL_DOMAIN = "bryels-care.test";
/** The organization's system actor (src/lib/auth/system.ts SYSTEM_ACTOR_EMAIL); never signs in. */
export const DEMO_SYSTEM_EMAIL = "system@bryels-care.invalid";
/**
 * The empty sandbox company (ADR-072, src/db/sandbox.ts): a second organization next to the demo
 * company, with no business data, for practising from scratch. Its accounts are demo addresses too
 * (`sandbox.<role>@bryels-care.test`), so every demo-mode safety rule applies to them unchanged.
 */
export const SANDBOX_ORG_NAME = "Bryel's Care Sandbox (empty)";
export const SANDBOX_EMAIL_PREFIX = "sandbox.";
export const SANDBOX_OWNER_EMAIL = "sandbox.owner@bryels-care.test";
export const isSandboxEmail = (email: string | null | undefined) => (email ?? "").trim().toLowerCase().startsWith(SANDBOX_EMAIL_PREFIX) && isDemoEmail(email);

/** Password of every seeded demo account (src/db/seed.ts). Shown on the sign-in page in demo mode only. */
export const DEMO_PASSWORD = "demo1234";

/** An environment map (process.env, or a plain object in tests). */
export type Env = Record<string, string | undefined>;

const TRUE = new Set(["true", "1", "yes", "on"]);
const flag = (v: string | undefined) => TRUE.has((v ?? "").trim().toLowerCase());

export type DemoModeState = { on: boolean; source: "DEMO_MODE" | "ALLOW_DEMO_SEED" | null; blockedByProduction: boolean };

/** Whether demo mode is on, and which variable turned it on (for the start-up self-check). */
export function demoModeState(env: Env = process.env): DemoModeState {
  const source = flag(env.DEMO_MODE) ? "DEMO_MODE" : env.ALLOW_DEMO_SEED === "true" ? "ALLOW_DEMO_SEED" : null;
  const production = (env.APP_ENV ?? "").trim().toLowerCase() === "production";
  return { on: !!source && !production, source, blockedByProduction: !!source && production };
}

export function isDemoMode(env: Env = process.env): boolean {
  return demoModeState(env).on;
}

/** A demo address: `<anything>@bryels-care.test` or the system actor. Case-insensitive, trimmed. */
export function isDemoEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (e === DEMO_SYSTEM_EMAIL) return true;
  const at = e.lastIndexOf("@");
  return at > 0 && e.slice(at + 1) === DEMO_EMAIL_DOMAIN;
}

/**
 * SQL predicate (for raw postgres-js and drizzle `sql`) matching users whose email is NOT a demo
 * address. Kept as text so the seed scripts and the services share one definition.
 */
export const NON_DEMO_USER_PREDICATE = `not (lower(email) like '%@${DEMO_EMAIL_DOMAIN}' or lower(email) = '${DEMO_SYSTEM_EMAIL}')`;

/** Plain-language refusal used by the seed, the reset script and the reset screen. */
export function realAccountsRefusal(count: number): string {
  return (
    `Refusing to load or reset demo data: this database has ${count} account${count === 1 ? "" : "s"} that ` +
    `${count === 1 ? "is" : "are"} not a demo address (@${DEMO_EMAIL_DOMAIN}). Demo data is never mixed with ` +
    "or written over real data. Use a separate, empty database for the demo."
  );
}

/* ------------------------------------------------------------------ demo profiles and seed version */

/**
 * Demo profiles (owner request 2026-11-06, see docs/demo-script.md):
 * - `lite` (default): one site, two products (two recipes, two routings) and a small storyline made
 *   through the real services (src/db/seed-demo.ts, src/db/seeds/lite.ts);
 * - `full`: the older large seed (src/db/seed.ts), kept unchanged for the integration tests and for
 *   anyone who wants every screen filled.
 */
export const DEMO_PROFILES = ["lite", "full"] as const;
export type DemoProfile = (typeof DEMO_PROFILES)[number];

/**
 * Version of the lite demo data. Raise it whenever the lite seed changes: on the next start
 * (`pnpm db:demo auto`) a demo database that holds another version (or the old full seed) is wiped
 * and loaded again, so a deploy gives a fresh demo without anyone pressing "Reset demo data".
 */
export const DEMO_SEED_VERSION = "2026-11-06.2";

/** The profile `pnpm db:demo` loads: env `DEMO_PROFILE` (lite | full), default lite; anything else is an error. */
export function demoProfile(env: Env = process.env): { profile: DemoProfile; error: string | null } {
  const raw = (env.DEMO_PROFILE ?? "").trim().toLowerCase();
  if (!raw) return { profile: "lite", error: null };
  if ((DEMO_PROFILES as readonly string[]).includes(raw)) return { profile: raw as DemoProfile, error: null };
  return { profile: "lite", error: `DEMO_PROFILE must be lite or full (it is "${env.DEMO_PROFILE}").` };
}

/** The version a profile writes into its completeness marker (`platform.demo.seeded`). The full seed writes none. */
export const expectedSeedVersion = (profile: DemoProfile): string | null => (profile === "lite" ? DEMO_SEED_VERSION : null);

/** What the completeness marker says was loaded. A marker without a profile is the full seed (it never wrote one). */
export function loadedDemo(markerAfter: unknown): { profile: DemoProfile; version: string | null } {
  const a = (markerAfter ?? {}) as { profile?: unknown; seedVersion?: unknown };
  const profile = a.profile === "lite" ? "lite" : "full";
  return { profile, version: typeof a.seedVersion === "string" ? a.seedVersion : null };
}

export type DemoAutoDecision = { action: "nothing" | "load" | "reload"; reason: string };

/**
 * Start-up decision of `pnpm db:demo auto` (the guards — demo mode, APP_ENV, real accounts — are checked
 * before and always win):
 * - empty database → load;
 * - an organization without the completeness marker → reload (an interrupted load);
 * - a marker for another profile or another seed version → reload (a deploy with new demo data);
 * - otherwise nothing.
 */
export function demoAutoDecision(input: { organizations: number; marker: { after: unknown } | null; profile: DemoProfile }): DemoAutoDecision {
  if (input.organizations === 0) return { action: "load", reason: "Empty database: loading the fictional demo data." };
  if (!input.marker) return { action: "reload", reason: "Found an interrupted demo load; clearing it and loading again." };
  const loaded = loadedDemo(input.marker.after);
  const want = expectedSeedVersion(input.profile);
  if (loaded.profile !== input.profile) {
    return { action: "reload", reason: `The database holds the ${loaded.profile} demo data but DEMO_PROFILE is ${input.profile}: clearing everything and loading the ${input.profile} demo.` };
  }
  if (loaded.version !== want) {
    return { action: "reload", reason: `New demo data version (${loaded.version ?? "none"} → ${want ?? "none"}): clearing the old demo data and loading the new version.` };
  }
  return { action: "nothing", reason: `Demo data (${input.profile}${want ? `, version ${want}` : ""}) is already loaded; nothing to do (use Reset demo data in the app to start over).` };
}
