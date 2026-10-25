/**
 * Demo data lifecycle (ADR-055, docs/railway-for-dummies.md, docs/deployment-railway.md §2.4).
 *
 *   pnpm db:demo auto    start-up (scripts/start.sh): load the fictional demo data when the database
 *                        has no organization yet; otherwise do nothing. Safe on every restart.
 *   pnpm db:demo reset   wipe every row of the application tables and load the demo data again
 *                        (the owner's "Reset demo data" screen runs this).
 *
 * Both refuse unless demo mode is on (DEMO_MODE=true, or the older ALLOW_DEMO_SEED=true; never with
 * APP_ENV=production) and refuse while any account exists whose email is not a demo address, so a
 * real company database can never be wiped or mixed with demo data. The schema and the applied
 * migrations are kept (rows are truncated, tables are not dropped), so a running worker carries on.
 * One advisory lock serialises concurrent runs (two web replicas, a reset during a restart).
 *
 * Completeness: the seed's last step writes the audit event `platform.demo.seeded`. An organization
 * without it is an interrupted load (e.g. the container was stopped mid-seed) and is loaded again.
 *
 * Exit codes: 0 done or nothing to do, 1 error, 2 refused (demo mode off or real accounts present).
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { NON_DEMO_USER_PREDICATE, demoModeState, realAccountsRefusal } from "../lib/demo";

const LOCK_KEY = "bc_demo_data";
const say = (msg: string) => console.log(`[demo] ${msg}`);

type Sql = ReturnType<typeof postgres>;

async function tableExists(sql: Sql, name: string): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select to_regclass(${"public." + name}) is not null as ok`;
  return !!r?.ok;
}

async function nonDemoUserCount(sql: Sql): Promise<number> {
  if (!(await tableExists(sql, "users"))) return 0;
  const [r] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from users where ${NON_DEMO_USER_PREDICATE}`);
  return Number(r?.n ?? 0);
}

/** Empties every table of the application schema; keeps the tables, the migrations and pg-boss. */
async function wipe(sql: Sql) {
  const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public' order by tablename`;
  if (!tables.length) return;
  const list = tables.map((t) => `"public"."${t.tablename.replace(/"/g, '""')}"`).join(", ");
  await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

function run(file: string) {
  // node --import tsx: the same TypeScript runner as `pnpm db:seed`, without a nested pnpm.
  execFileSync(process.execPath, ["--import", "tsx", file], { stdio: "inherit", env: process.env, cwd: process.cwd() });
}

async function main(): Promise<number> {
  const mode = process.argv[2];
  if (mode !== "auto" && mode !== "reset") {
    console.error("Usage: pnpm db:demo auto|reset");
    return 1;
  }
  const state = demoModeState(process.env);
  if (!state.on) {
    if (mode === "auto") return 0; // demo mode off: start-up has nothing to do, silently
    say(state.blockedByProduction ? "Refusing to reset: APP_ENV=production. Demo data never runs on a production database." : "Refusing to reset: demo mode is off (set DEMO_MODE=true on a demo database only).");
    return 2;
  }
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!url) {
    say("DATABASE_URL is not set.");
    return 1;
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const started = Date.now();
  try {
    await sql`select pg_advisory_lock(hashtext(${LOCK_KEY}))`;
    const real = await nonDemoUserCount(sql);
    if (real > 0) {
      say(realAccountsRefusal(real));
      return 2;
    }
    if (!(await tableExists(sql, "organizations"))) {
      say("The database has no tables yet. Run the migrations first (pnpm db:migrate; scripts/start.sh does this).");
      return 1;
    }
    const [{ n: orgs }] = await sql<{ n: number }[]>`select count(*)::int as n from organizations`;
    const [{ ok: seeded }] = await sql<{ ok: boolean }[]>`select exists(select 1 from audit_events where action = 'platform.demo.seeded') as ok`;
    if (mode === "auto") {
      if (orgs > 0 && seeded) {
        say("Demo data is already loaded; nothing to do (use Reset demo data in the app to start over).");
        return 0;
      }
      if (orgs > 0) say("Found an interrupted demo load; clearing it and loading again.");
      else say("Empty database: loading the fictional demo data (about a minute)…");
    } else {
      say("Resetting: clearing every application table…");
    }
    await wipe(sql);
    try {
      run("src/db/seed.ts");
      run("scripts/install-reference-data.ts");
    } catch (e) {
      // Leave an empty database rather than half a demo; the next start or reset loads it again.
      await wipe(sql).catch(() => undefined);
      say("Loading the demo data failed; the database was left empty so the next start tries again.");
      throw e;
    }
    say(`Demo data loaded in ${Math.round((Date.now() - started) / 1000)} s. Sign in with any demo account (password demo1234).`);
    return 0;
  } finally {
    await sql`select pg_advisory_unlock(hashtext(${LOCK_KEY}))`.catch(() => undefined);
    await sql.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
