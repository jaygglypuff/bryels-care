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
