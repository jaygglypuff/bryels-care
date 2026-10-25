/**
 * The logical backup (`platform.backup_dump`, docs/deployment-railway.md §9): one run = one encrypted
 * pg_dump in the bucket and the offsite copy, recorded in `backup_runs`. Runs as the Railway `backup`
 * cron service (APP_ROLE=backup in scripts/start.sh) and exits; also used by hand before destructive
 * migrations and at cutover (`--manual --label pre-load-<date> --hold`).
 *
 *   pnpm backup:dump [--manual] [--label <text>] [--hold] [--allow-unencrypted]
 *
 * Environment (names only; values live in Railway variables, never in the repository):
 *   DATABASE_BACKUP_URL   read-only dump role (bc_backup); falls back to DATABASE_URL
 *   DATABASE_URL          application role that writes the backup_runs row
 *   BACKUP_ENCRYPTION_PUBLIC_KEY  age recipient (age1…); the private key is offline (key custody, runbook §13.7)
 *   BACKUP_PREFIX         object prefix, default backups/<APP_ENV>
 *   BACKUP_S3_* / S3_*    primary bucket; BACKUP_OFFSITE_S3_* offsite bucket (another provider)
 *   BACKUP_LOCAL_DIR / BACKUP_OFFSITE_LOCAL_DIR  development drills without buckets
 *
 * Steps: (1) backup_runs row `running`; (2) exact row counts and pg_dump in ONE snapshot (so the drill
 * can compare them); (3) `pg_restore --list` proves the archive is valid; (4) `age -r` encrypts;
 * (5) SHA-256; (6) upload to the primary target, re-download and compare the checksum; (7) copy to the
 * offsite target; (8) prune beyond 35 daily + 12 monthly, never a held run; (9) row `succeeded` or
 * `failed`; (10) exit 0 or 1.
 */
import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { COUNTED_TABLES, arg, deleteObject, dumpKey, fileSize, flag, getObject, log, pruneCandidates, putObject, run, sha256File, targets } from "./backup-lib";

async function main() {
  const appUrl = process.env.DATABASE_URL;
  if (!appUrl) throw new Error("DATABASE_URL is not set");
  const dumpUrl = process.env.DATABASE_BACKUP_URL || appUrl;
  const appEnv = process.env.APP_ENV || "development";
  const recipient = process.env.BACKUP_ENCRYPTION_PUBLIC_KEY?.trim() || null;
  if (!recipient && (!flag("allow-unencrypted") || appEnv === "production")) {
    throw new Error("BACKUP_ENCRYPTION_PUBLIC_KEY is not set. Dumps are always encrypted outside development (--allow-unencrypted is refused in production).");
  }
  const { primary, offsite } = targets();
  if (!primary) throw new Error("No backup target: set BACKUP_S3_* (or the app bucket S3_*), or BACKUP_LOCAL_DIR for a development drill.");
  const prefix = process.env.BACKUP_PREFIX || `backups/${appEnv}`;

  const client = postgres(appUrl, { max: 2, onnotice: () => {}, connection: { application_name: "bc-backup" } });
  const db = drizzle(client, { schema: s });
  const [org] = await db.select({ id: s.organizations.id }).from(s.organizations).limit(1);
  if (!org) throw new Error("No organization in this database.");
  const startedAt = new Date();
  const [row] = await db
    .insert(s.backupRuns)
    .values({ organizationId: org.id, kind: flag("manual") ? "manual" : "scheduled", label: arg("label") ?? null, status: "running", startedAt, releaseTag: process.env.RELEASE ?? null, hold: flag("hold") })
    .returning({ id: s.backupRuns.id });
  log("info", "backup started", { backupRunId: row.id, kind: flag("manual") ? "manual" : "scheduled" });

  const work = await mkdtemp(path.join(tmpdir(), "bc-backup-"));
  try {
    const plain = path.join(work, "db.dump");
    // (2) Counts and dump share one exported snapshot.
    const dumpClient = postgres(dumpUrl, { max: 1, onnotice: () => {}, connection: { application_name: "bc-backup-dump" } });
    let rowCounts: Record<string, number> = {};
    let pgVersion = "";
    try {
      await dumpClient.begin("isolation level repeatable read read only", async (tx) => {
        const [{ snap }] = await tx<{ snap: string }[]>`select pg_export_snapshot() as snap`;
        const [{ v }] = await tx<{ v: string }[]>`select current_setting('server_version') as v`;
        pgVersion = v;
        const existing = await tx<{ t: string }[]>`select tablename as t from pg_tables where schemaname = 'public'`;
        const names = new Set(existing.map((e) => e.t));
        for (const t of COUNTED_TABLES) if (names.has(t)) rowCounts[t] = Number((await tx.unsafe<{ n: string }[]>(`select count(*)::text as n from "${t}"`))[0].n);
        await run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--exclude-schema=pgboss", `--snapshot=${snap}`, "--file", plain, `--dbname=${dumpUrl}`], { redact: [dumpUrl] });
      });
    } finally {
      await dumpClient.end();
    }
    // (3) A valid custom-format archive lists its table of contents.
    const toc = await run("pg_restore", ["--list", plain]);
    const tocEntries = toc.stdout.split("\n").filter((l) => l && !l.startsWith(";")).length;
    // (4) Encrypt to the offline key's public half.
    let final = plain;
    if (recipient) {
      final = `${plain}.age`;
      await run("age", ["-r", recipient, "-o", final, plain]);
      await rm(plain);
    }
    // (5) Checksum and size of what is stored.
    const sha256 = await sha256File(final);
    const size = await fileSize(final);
    const key = dumpKey(prefix, startedAt, !!recipient);
    // (6) Upload and verify the stored object.
    await putObject(primary, key, final, { sha256 });
    const check = path.join(work, "check");
    await getObject(primary, key, check);
    if ((await sha256File(check)) !== sha256) throw new Error("The uploaded object does not match the local checksum.");
    await rm(check);
    // (7) Offsite copy (A-DEP-08). Missing offsite configuration is recorded, not hidden: the Backups card shows "No offsite copy".
    let offsiteKey: string | null = null;
    if (offsite) {
      await putObject(offsite, key, final, { sha256 });
      offsiteKey = key;
    } else log("warn", "no offsite target configured; the backup-age alert reports the missing offsite copy", { backupRunId: row.id });
    // (9) Record success before pruning, so a prune problem never hides a good dump.
    await db
      .update(s.backupRuns)
      .set({ status: "succeeded", finishedAt: new Date(), bucketKey: key, offsiteBucketKey: offsiteKey, sizeBytes: size, checksumSha256: sha256, pgVersion, rowCounts: { ...rowCounts, toc_entries: tocEntries } })
      .where(eq(s.backupRuns.id, row.id));
    log("info", "backup succeeded", { backupRunId: row.id, key, sizeBytes: size, sha256, seconds: Math.round((Date.now() - startedAt.getTime()) / 1000), offsite: !!offsiteKey });
    // (8) Prune beyond retention; the pruning is recorded as an audit event per run (backup_runs rows stay, A-DM-33).
    const done = await db
      .select({ id: s.backupRuns.id, finishedAt: s.backupRuns.finishedAt, hold: s.backupRuns.hold, bucketKey: s.backupRuns.bucketKey, offsiteBucketKey: s.backupRuns.offsiteBucketKey })
      .from(s.backupRuns)
      .where(and(eq(s.backupRuns.organizationId, org.id), eq(s.backupRuns.status, "succeeded")))
      .orderBy(desc(s.backupRuns.finishedAt));
    const pruned = await db.select({ id: s.auditEvents.entityId }).from(s.auditEvents).where(and(eq(s.auditEvents.organizationId, org.id), eq(s.auditEvents.action, "platform.backup_run.pruned")));
    const prunedIds = new Set(pruned.map((p) => p.id));
    const candidates = pruneCandidates(
      done.filter((d) => d.finishedAt && d.bucketKey && !prunedIds.has(d.id)).map((d) => ({ ...d, finishedAt: d.finishedAt! })),
      new Date(),
    );
    for (const c of candidates) {
      if (c.bucketKey) await deleteObject(primary, c.bucketKey);
      if (c.offsiteBucketKey && offsite) await deleteObject(offsite, c.offsiteBucketKey);
      await db.insert(s.auditEvents).values({ organizationId: org.id, actorLabel: "system:platform.backup_dump", action: "platform.backup_run.pruned", entityType: "backup_runs", entityId: c.id, after: { bucketKey: c.bucketKey, offsiteBucketKey: c.offsiteBucketKey } });
    }
    if (candidates.length) log("info", "old dumps pruned", { count: candidates.length });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).split(dumpUrl).join("[redacted]").split(appUrl).join("[redacted]").slice(0, 2000);
    await db.update(s.backupRuns).set({ status: "failed", finishedAt: new Date(), errorMessage: message }).where(eq(s.backupRuns.id, row.id));
    log("error", "backup failed", { backupRunId: row.id, error: message });
    process.exitCode = 1;
  } finally {
    await rm(work, { recursive: true, force: true });
    await client.end();
  }
}

main().catch((e) => {
  log("error", "backup could not start", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
