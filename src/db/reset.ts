import "dotenv/config";
import postgres from "postgres";
import { NON_DEMO_USER_PREDICATE, demoModeState, realAccountsRefusal } from "../lib/demo";

/**
 * Development reset (`pnpm db:reset`): drops and recreates the public schema. Refuses unless demo mode
 * is on (DEMO_MODE=true or the older ALLOW_DEMO_SEED=true; never with APP_ENV=production) and while any
 * account exists whose email is not a demo address (ADR-044). On Railway the in-app "Reset demo data"
 * uses `pnpm db:demo reset` instead, which keeps the schema so the worker keeps running.
 */
async function main() {
  const demo = demoModeState(process.env);
  if (!demo.on) throw new Error(demo.blockedByProduction ? "Refusing to reset: APP_ENV=production" : "Refusing to reset: demo mode is off (DEMO_MODE / ALLOW_DEMO_SEED is not true)");
  const sql = postgres(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const [exists] = await sql<{ ok: boolean }[]>`select to_regclass('public.users') is not null as ok`;
  if (exists?.ok) {
    const [real] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from users where ${NON_DEMO_USER_PREDICATE}`);
    if (Number(real?.n ?? 0) > 0) {
      await sql.end();
      throw new Error(realAccountsRefusal(Number(real.n)));
    }
  }
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;");
  await sql.end();
  console.log("Database reset");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
