import "dotenv/config";
import postgres from "postgres";

/** Drops and recreates the public schema. Refuses to run unless ALLOW_DEMO_SEED=true. */
async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "true") throw new Error("Refusing to reset: ALLOW_DEMO_SEED is not true");
  const sql = postgres(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await sql.end();
  console.log("Database reset");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
