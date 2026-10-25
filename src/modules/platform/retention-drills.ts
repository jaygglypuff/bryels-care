import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/db/client";
import { backupRuns, restoreDrills, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { auditDenied, requireReauthentication } from "@/modules/governance";

export { DrillRecordSchema, drillResult, recordRestoreDrill } from "./retention-drill-record";

/**
 * Restore drills (US-9-03, AC-23, docs/deployment-railway.md §10). The drill script
 * (`pnpm restore:drill`, scripts/restore-drill.ts) records one row per drill with the measured RTO
 * (start of download to the end of the checks) and RPO (age of the dump when the drill started);
 * the owner signs off on screen. The signer is never the person who performed the drill.
 */

export type RestoreDrillView = typeof restoreDrills.$inferSelect & { performedByName: string | null; signedOffByName: string | null; backupLabel: string | null; backupFinishedAt: Date | null };

export async function listRestoreDrills(ctx: AuthContext, limit = 20): Promise<RestoreDrillView[]> {
  ctx.require("platform.restore_drill.view");
  const performer = alias(users, "performer");
  const signer = alias(users, "signer");
  const rows = await db
    .select({ d: restoreDrills, performedByName: performer.displayName, signedOffByName: signer.displayName, backupLabel: backupRuns.label, backupFinishedAt: backupRuns.finishedAt })
    .from(restoreDrills)
    .leftJoin(performer, eq(performer.id, restoreDrills.performedBy))
    .leftJoin(signer, eq(signer.id, restoreDrills.signedOffBy))
    .leftJoin(backupRuns, eq(backupRuns.id, restoreDrills.backupRunId))
    .where(eq(restoreDrills.organizationId, ctx.organizationId))
    .orderBy(desc(restoreDrills.performedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.d, performedByName: r.performedByName, signedOffByName: r.signedOffByName, backupLabel: r.backupLabel, backupFinishedAt: r.backupFinishedAt }));
}

/** The newest drill (diagnostics Backups card; alert "restore drill overdue"). */
export async function latestRestoreDrill(organizationId: string) {
  const [r] = await db.select().from(restoreDrills).where(eq(restoreDrills.organizationId, organizationId)).orderBy(desc(restoreDrills.performedAt)).limit(1);
  return r ?? null;
}

/** Owner sign-off (restricted): re-authentication, a note, and never the performer. */
export async function signOffRestoreDrill(ctx: AuthContext, input: { id: string; note: string }, password: string | null) {
  ctx.require("platform.restore_drill.approve");
  ctx.assertWritable();
  const note = input.note.trim();
  if (note.length < 3) throw new DomainError("validation", "Add a short sign-off note (at least 3 characters).", { field: "note" });
  const id = z.uuid().safeParse(input.id);
  if (!id.success) throw new DomainError("not_found", "Restore drill not found.");
  const [drill] = await db.select().from(restoreDrills).where(and(eq(restoreDrills.id, id.data), eq(restoreDrills.organizationId, ctx.organizationId)));
  if (!drill) throw new DomainError("not_found", "Restore drill not found.");
  if (ctx.sodBlocks(drill.performedBy === ctx.userId, "You performed this drill; a different person must sign it off.")) {
    await auditDenied(ctx, { permission: "platform.restore_drill.approve", entityType: "restore_drills", entityId: drill.id, siteId: null, rule: "signer_is_performer" });
    throw new DomainError("separation_of_duties", "You performed this drill; a different person must sign it off.", ctx.refusalDetails());
  }
  if (drill.signedOffBy) throw new DomainError("conflict", "This drill is already signed off.");
  await requireReauthentication(ctx, password, "sign off a restore drill");
  return db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx.update(restoreDrills).set({ signedOffBy: ctx.userId, signedOffAt: now, signOffNote: note }).where(and(eq(restoreDrills.id, drill.id))).returning();
    await audit(tx, ctx, { action: "platform.restore_drill.signed_off", entityType: "restore_drills", entityId: row.id, siteId: null, reason: note, after: { result: row.result, measuredRtoSeconds: row.measuredRtoSeconds, dumpAgeSeconds: row.dumpAgeSeconds } });
    return row;
  });
}
