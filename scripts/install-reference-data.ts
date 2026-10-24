/**
 * Installs the W2G reference master data (units, SI conversions, default reason codes) for every
 * organization in DATABASE_URL that lacks them. Idempotent; never overwrites company edits.
 * Usage: pnpm db:reference. Runs automatically after migrations in scripts/start.sh (every deploy) and
 * from pnpm admin:bootstrap for a new organization (ADR-040), so a fresh database needs no manual step.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { installReferenceData } from "../src/modules/masterdata/org-reference";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });
  const orgs = await db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations);
  if (!orgs.length) console.log("Reference data: no organization yet (pnpm admin:bootstrap creates one and installs it).");
  for (const o of orgs) {
    const r = await installReferenceData(db, o.id);
    console.log(`${o.name}: +${r.uoms} units, +${r.conversions} conversions, +${r.reasonCodes} reason codes`);
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
