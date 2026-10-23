import { execSync } from "node:child_process";
import postgres from "postgres";

/** Recreates the test database schema from the committed migrations and loads the demo seed. */
export async function resetTestDatabase() {
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;");
  await sql.end();
  const env = { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url, ALLOW_DEMO_SEED: "true" };
  execSync("pnpm -s tsx src/db/migrate.ts && pnpm -s tsx src/db/seed.ts", { env, stdio: "pipe" });
}
