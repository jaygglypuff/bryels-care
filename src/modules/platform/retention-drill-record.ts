/**
 * Recording a restore drill (US-9-03): used by scripts/restore-drill.ts outside the Next.js server, so this
 * file has no `server-only` guard and no dependency on other modules; the screens use retention-drills.ts.
 */
import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import { restoreDrills, users } from "../../db/schema";
import { DomainError } from "../../lib/errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<PgQueryResultHKT, any, any>;

export const DrillRecordSchema = z
  .object({
    organizationId: z.uuid(),
    backupRunId: z.uuid().nullable(),
    performedAt: z.date(),
    performedBy: z.uuid(),
    witnessUserId: z.uuid().nullable().optional(),
    targetEnvironment: z.string().trim().min(1).max(60),
    sourceKey: z.string().max(500).nullable().optional(),
    durationSeconds: z.number().int().min(0),
    measuredRtoSeconds: z.number().int().min(0),
    dumpAgeSeconds: z.number().int().min(0).nullable(),
    checksumVerified: z.boolean(),
    decryptSucceeded: z.boolean(),
    rowCountsMatch: z.boolean().nullable(),
    migrationsCurrent: z.boolean().nullable(),
    reconciliationRows: z.number().int().min(0).nullable(),
    details: z.record(z.string(), z.unknown()).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict();

/** A drill passes only when every check passed (and the RTO/RPO targets, when given, were met). */
export function drillResult(r: z.infer<typeof DrillRecordSchema>, targets: { rtoSeconds?: number; rpoSeconds?: number } = {}): "passed" | "failed" {
  const ok =
    r.checksumVerified &&
    r.decryptSucceeded &&
    r.rowCountsMatch !== false &&
    r.migrationsCurrent !== false &&
    (r.reconciliationRows ?? 0) === 0 &&
    (targets.rtoSeconds === undefined || r.measuredRtoSeconds <= targets.rtoSeconds) &&
    (targets.rpoSeconds === undefined || r.dumpAgeSeconds === null || r.dumpAgeSeconds <= targets.rpoSeconds);
  return ok ? "passed" : "failed";
}

/** Called by the drill script (no session: the operator is named with --performed-by). */
export async function recordRestoreDrill(q: AnyDb, raw: z.input<typeof DrillRecordSchema>, targets: { rtoSeconds?: number; rpoSeconds?: number } = {}) {
  const input = DrillRecordSchema.parse(raw);
  const [u] = await q.select({ id: users.id }).from(users).where(and(eq(users.id, input.performedBy), eq(users.organizationId, input.organizationId)));
  if (!u) throw new DomainError("validation", "The person performing the drill must be a user of this organisation.");
  const result = drillResult(input, targets);
  const [row] = await q
    .insert(restoreDrills)
    .values({ ...input, witnessUserId: input.witnessUserId ?? null, sourceKey: input.sourceKey ?? null, details: input.details ?? null, notes: input.notes ?? null, result })
    .returning();
  return row;
}
