/**
 * The small ("lite") demo (owner request 2026-11-06; docs/demo-script.md): one organization, one site
 * (North Fields Plant), the demo accounts, TWO products with one approved recipe and one approved routing
 * each, only the materials those recipes need, and a short storyline at different steps — all made
 * through the real services (src/db/seeds/lite.ts). Fictional data only.
 *
 *   pnpm db:demo reset|auto   loads this profile by default (DEMO_PROFILE=lite; `full` = src/db/seed.ts)
 *   tsx src/db/seed-demo.ts   loads it into an empty database (refuses otherwise)
 *
 * Same guards as src/db/seed.ts: demo mode only (never APP_ENV=production) and never while an account
 * exists whose email is not a demo address. Exit codes: 0 done or skipped, 1 refused/failed, 2 real accounts.
 */
import "dotenv/config";
import postgres from "postgres";
import { NON_DEMO_USER_PREDICATE, demoModeState, realAccountsRefusal } from "../lib/demo";

/** Domain modules start with `import "server-only"`; a seed is a server process (as in src/db/seeds/r2p2.ts). */
function allowServerModules() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require("node:module") as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const empty = path.resolve(__dirname, "../../scripts/server-only-empty.cjs");
  const resolve = Module._resolveFilename;
  if ((resolve as { __lite?: boolean }).__lite) return;
  const patched = function (this: unknown, request: string, ...rest: unknown[]) {
    if (request === "server-only") return empty;
    return resolve.call(this, request, ...rest);
  } as typeof resolve & { __lite?: boolean };
  patched.__lite = true;
  Module._resolveFilename = patched;
}

async function main(): Promise<number> {
  const demo = demoModeState(process.env);
  if (!demo.on) {
    console.error(
      demo.blockedByProduction
        ? "Refusing to seed: APP_ENV=production. Demo data must never reach production."
        : "Refusing to seed: demo mode is off (set DEMO_MODE=true on a demo database only). Demo data must never reach production.",
    );
    return 1;
  }
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    return 1;
  }
  // The services use src/db/client.ts (DATABASE_URL); keep both on the same database.
  process.env.DATABASE_URL = url;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [real] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from users where ${NON_DEMO_USER_PREDICATE}`);
    if (Number(real?.n ?? 0) > 0) {
      console.error(realAccountsRefusal(Number(real.n)));
      return 2;
    }
    const [{ n: orgs }] = await sql<{ n: number }[]>`select count(*)::int as n from organizations`;
    if (orgs > 0) {
      console.log("Seed skipped: data already present. Use pnpm db:demo reset to start over.");
      return 0;
    }
  } finally {
    await sql.end();
  }
  allowServerModules();
  const { seedLiteDemo } = await import("./seeds/lite");
  const { db } = await import("./client");
  try {
    const notes = await seedLiteDemo();
    for (const n of notes) console.log(`[lite] ${n}`);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
