/**
 * Records one logical-dump run in `backup_runs` (docs/deployment-railway.md §9 steps 1 and 9) so
 * the diagnostics Backups card (BACKUP_STATUS_SOURCE=table) and the backup-age alert can read it.
 * Called by the backup service after each dump; it never runs a dump itself.
 *
 *   pnpm backup:record --status succeeded --kind scheduled --label nightly \
 *     --bucket-key backups/production/2026/10/db-....dump.age --offsite-key ... \
 *     --size 123456 --sha256 <hex> --started 2026-10-23T18:17:00Z --finished 2026-10-23T18:29:10Z
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const status = arg("status");
  if (!status || !["running", "succeeded", "failed"].includes(status)) throw new Error("--status must be running, succeeded or failed");
  const kind = arg("kind") ?? "scheduled";
  if (!["scheduled", "manual"].includes(kind)) throw new Error("--kind must be scheduled or manual");
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client, { schema: s });
  const [org] = await db.select({ id: s.organizations.id }).from(s.organizations).limit(1);
  if (!org) throw new Error("No organization in this database.");
  const [row] = await db
    .insert(s.backupRuns)
    .values({
      organizationId: org.id,
      kind,
      status,
      label: arg("label") ?? null,
      startedAt: arg("started") ? new Date(arg("started")!) : new Date(),
      finishedAt: arg("finished") ? new Date(arg("finished")!) : status === "running" ? null : new Date(),
      bucketKey: arg("bucket-key") ?? null,
      offsiteBucketKey: arg("offsite-key") ?? null,
      sizeBytes: arg("size") ? Number(arg("size")) : null,
      checksumSha256: arg("sha256") ?? null,
      releaseTag: process.env.RELEASE ?? null,
      errorMessage: arg("error")?.slice(0, 2000) ?? null,
      hold: process.argv.includes("--hold"),
    })
    .returning({ id: s.backupRuns.id });
  console.log(JSON.stringify({ level: "info", msg: "backup run recorded", id: row.id, status }));
  await client.end();
}

main().catch((e) => {
  console.error(JSON.stringify({ level: "error", msg: "backup run not recorded", error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
