import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies the committed migrations (scripts/start.sh on the `web` service only; the worker waits for
 * them). An advisory lock makes concurrent runs (two web replicas, a manual run during a deploy) apply
 * one after the other; the second finds nothing left to do.
 */
async function main() {
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // max 1: the lock, the migrations and the unlock share one session.
  const client = postgres(url, { max: 1, onnotice: () => {}, connection: { application_name: "bc-migrate" } });
  await client`select pg_advisory_lock(hashtext('bc_migrate'))`;
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/db/migrations" });
  } finally {
    await client`select pg_advisory_unlock(hashtext('bc_migrate'))`.catch(() => undefined);
    await client.end();
  }
  console.log("Migrations applied");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
