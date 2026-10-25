/**
 * Restore drill (US-9-03, AC-23, docs/deployment-railway.md §10, runbook §13.6). Restores a logical dump
 * into a NEW scratch database, checks it and records the evidence in `restore_drills` of the database
 * the dump came from. It never writes to the source database's tables except that evidence row.
 *
 *   pnpm restore:drill --performed-by <email> [--witness <email>] [--backup-run <id>] [--from offsite|primary]
 *                      [--file <path to .dump or .dump.age>] [--identity <age key file>]
 *                      [--target-admin-url postgres://…/postgres] [--environment staging] [--keep]
 *                      [--rto-hours 4] [--rpo-hours 24]
 *
 *   DATABASE_URL        the source database (reads backup_runs, writes restore_drills)
 *   DRILL_ADMIN_URL     a server where the scratch database may be created (default: the source server's
 *                       `postgres` database). In production drills this is the STAGING server (§10 step 4).
 *   BACKUP_AGE_IDENTITY_FILE  path of the offline private key (or --identity); never stored in Railway.
 *
 * Measured RTO = download start → checks finished; measured RPO = dump age when the drill starts.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { recordRestoreDrill } from "../src/modules/platform/retention-drill-record";
import { RECONCILIATION_SQL, arg, flag, getObject, log, run, sha256File, targets } from "./backup-lib";

function withDb(url: string, name: string) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function main() {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL (the source database) is not set");
  const performer = arg("performed-by");
  if (!performer) throw new Error("--performed-by <email> is required (the person doing the drill).");
  const adminUrl = arg("target-admin-url") || process.env.DRILL_ADMIN_URL || withDb(sourceUrl, "postgres");
  const identity = arg("identity") || process.env.BACKUP_AGE_IDENTITY_FILE || null;
  const environment = arg("environment") || process.env.APP_ENV || "development";
  const rtoSeconds = Number(arg("rto-hours") ?? 4) * 3600;
  const rpoSeconds = Number(arg("rpo-hours") ?? 24) * 3600;

  const src = postgres(sourceUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(src, { schema: s });
  const [org] = await db.select({ id: s.organizations.id }).from(s.organizations).limit(1);
  const [person] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, performer.toLowerCase()));
  const witnessEmail = arg("witness");
  const [witness] = witnessEmail ? await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, witnessEmail.toLowerCase())) : [];
  if (!org || !person) throw new Error("Unknown organization or --performed-by user in the source database.");

  const t0 = Date.now();
  const startedAt = new Date(t0);
  const file = arg("file");
  const runId = arg("backup-run");
  const [backup] = file
    ? [null]
    : await db
        .select()
        .from(s.backupRuns)
        .where(runId ? eq(s.backupRuns.id, runId) : and(eq(s.backupRuns.organizationId, org.id), eq(s.backupRuns.status, "succeeded")))
        .orderBy(desc(s.backupRuns.finishedAt))
        .limit(1);
  if (!file && !backup) throw new Error("No succeeded backup run found (or --backup-run is unknown). Use --file for a dump outside backup_runs.");

  const work = await mkdtemp(path.join(tmpdir(), "bc-drill-"));
  const scratch = `restore_drill_${startedAt.toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
  const details: Record<string, unknown> = { scratchDatabase: scratch };
  let checksumVerified = false;
  let decryptSucceeded = false;
  let rowCountsMatch: boolean | null = null;
  let migrationsCurrent: boolean | null = null;
  let reconciliationRows: number | null = null;
  let notes: string | null = null;
  let restoreStarted = 0;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  let created = false;
  try {
    // 1–2. Fetch (offsite by default, to prove the offsite copy) and verify the checksum.
    let fetched = path.join(work, backup?.bucketKey?.endsWith(".age") || file?.endsWith(".age") ? "db.dump.age" : "db.dump");
    if (file) {
      fetched = path.resolve(file);
      checksumVerified = arg("sha256") ? (await sha256File(fetched)) === arg("sha256") : true;
      details.source = "file";
    } else {
      const from = arg("from") === "primary" ? "primary" : "offsite";
      const t = targets();
      const target = from === "offsite" ? t.offsite : t.primary;
      const key = from === "offsite" ? backup!.offsiteBucketKey : backup!.bucketKey;
      if (!target || !key) throw new Error(`The ${from} copy is not available for this backup run (configure BACKUP_${from === "offsite" ? "OFFSITE_" : ""}… or use --from primary).`);
      await getObject(target, key, fetched);
      checksumVerified = (await sha256File(fetched)) === backup!.checksumSha256;
      details.source = from;
      details.key = key;
      if (!checksumVerified) throw new Error("Checksum mismatch: the downloaded dump is not the one recorded in backup_runs.");
    }
    // 3. Decrypt with the offline key.
    let dump = fetched;
    if (fetched.endsWith(".age")) {
      if (!identity) throw new Error("The dump is encrypted: pass --identity <key file> (the offline private key).");
      dump = path.join(work, "db.dump");
      await run("age", ["-d", "-i", identity, "-o", dump, fetched]);
    }
    decryptSucceeded = true;
    // 4. Scratch database and pg_restore.
    await admin.unsafe(`create database "${scratch}"`);
    created = true;
    const scratchUrl = withDb(adminUrl, scratch);
    restoreStarted = Date.now();
    await run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${scratchUrl}`, dump], { redact: [scratchUrl, adminUrl] });
    details.restoreSeconds = Math.round((Date.now() - restoreStarted) / 1000);
    const r = postgres(scratchUrl, { max: 1, onnotice: () => {} });
    try {
      // 5. Migrations: the restored database has every migration this release bundles.
      const journal = JSON.parse(readFileSync(path.resolve("src/db/migrations/meta/_journal.json"), "utf8")) as { entries: { when: number }[] };
      const [m] = await r<{ n: number; last: string | null }[]>`select count(*)::int as n, max(created_at)::text as last from drizzle.__drizzle_migrations`;
      migrationsCurrent = m.n === journal.entries.length && Number(m.last) === journal.entries[journal.entries.length - 1].when;
      details.migrations = { applied: m.n, bundled: journal.entries.length };
      // 6. Exact row counts against the dump-time counts.
      const expected = (backup?.rowCounts ?? null) as Record<string, number> | null;
      if (expected) {
        const diff: Record<string, { expected: number; restored: number }> = {};
        for (const [t, n] of Object.entries(expected)) {
          if (t === "toc_entries") continue;
          const [c] = await r.unsafe<{ n: string }[]>(`select count(*)::text as n from "${t.replace(/"/g, "")}"`);
          if (Number(c.n) !== n) diff[t] = { expected: n, restored: Number(c.n) };
        }
        rowCountsMatch = Object.keys(diff).length === 0;
        details.rowCountDifferences = diff;
      }
      // Reconciliation of the restored ledger (must be zero).
      const [rec] = await r.unsafe<{ n: number }[]>(RECONCILIATION_SQL);
      reconciliationRows = rec.n;
      // Smoke reads: audit trail, a lot, a batch.
      const [smoke] = await r<{ audit: string; lots: string; batches: string }[]>`select (select count(*) from audit_events)::text as audit, (select count(*) from inventory_lots)::text as lots, (select count(*) from batches)::text as batches`;
      details.smoke = smoke;
    } finally {
      await r.end();
    }
  } catch (e) {
    notes = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
    log("error", "restore drill check failed", { error: notes });
  } finally {
    if (created && !flag("keep")) await admin.unsafe(`drop database if exists "${scratch}"`).catch(() => undefined);
    await admin.end();
    await rm(work, { recursive: true, force: true });
  }
  const finished = Date.now();
  const measuredRtoSeconds = Math.round((finished - t0) / 1000);
  const dumpAgeSeconds = backup?.finishedAt ? Math.max(0, Math.round((t0 - backup.finishedAt.getTime()) / 1000)) : null;
  const drill = await recordRestoreDrill(
    db,
    {
      organizationId: org.id,
      backupRunId: backup?.id ?? null,
      performedAt: startedAt,
      performedBy: person.id,
      witnessUserId: witness?.id ?? null,
      targetEnvironment: environment,
      sourceKey: (details.key as string | undefined) ?? file ?? null,
      durationSeconds: restoreStarted ? Math.round((finished - restoreStarted) / 1000) : 0,
      measuredRtoSeconds,
      dumpAgeSeconds,
      checksumVerified,
      decryptSucceeded,
      rowCountsMatch,
      migrationsCurrent,
      reconciliationRows,
      details,
      notes,
    },
    { rtoSeconds, rpoSeconds },
  );
  log(drill.result === "passed" ? "info" : "error", `restore drill ${drill.result}`, { restoreDrillId: drill.id, measuredRtoSeconds, dumpAgeSeconds, checksumVerified, decryptSucceeded, rowCountsMatch, migrationsCurrent, reconciliationRows, kept: flag("keep") ? scratch : null, ...details });
  await src.end();
  if (drill.result !== "passed") process.exitCode = 1;
}

main().catch((e) => {
  log("error", "restore drill could not start", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
