import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { idempotencyKeys } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";

/**
 * Idempotent command wrapper for masterdata commands (same contract as production's helper,
 * ADR-006 / data-model §11.4): the first call stores its result under (organization, key); a
 * repeat returns the stored result without re-running. Kept inside the module so masterdata does
 * not import production (dependency direction, docs/architecture.md §4).
 */
export async function idempotent<T extends object>(tx: Tx, ctx: AuthContext, key: string | null | undefined, command: string, fn: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
  if (!key) return { result: await fn(), replayed: false };
  const inserted = await tx.insert(idempotencyKeys).values({ organizationId: ctx.organizationId, key, command }).onConflictDoNothing().returning({ id: idempotencyKeys.id });
  if (inserted.length === 0) {
    const [row] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (!row || row.command !== command) throw new DomainError("conflict", "This request key was already used for a different action. Reload the page and try again.");
    if (!row.result) throw new DomainError("conflict", "This request is still being processed. Reload the page in a moment.");
    return { result: row.result as T, replayed: true };
  }
  const result = await fn();
  await tx
    .update(idempotencyKeys)
    .set({ result: sql`${JSON.stringify(result)}::jsonb` })
    .where(eq(idempotencyKeys.id, inserted[0].id));
  return { result, replayed: false };
}
