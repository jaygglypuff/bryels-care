import "server-only";
import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { idempotencyKeys } from "@/db/schema";

/**
 * API-level idempotency (docs/data-model.md §11.4, ADR-006/018). The key is unique per
 * organization; the first request reserves it, the response (success or a business error) is
 * stored and a repeat returns it verbatim. Same key with another user or another body → reuse
 * error. Ledger tables keep their own idempotency keys as a second line of defence, so a retry
 * after a crash mid-command still cannot post twice.
 */
export type StoredResponse = { status: number; body: unknown };

export type Reservation =
  | { kind: "reserved"; id: string }
  | { kind: "replay"; response: StoredResponse }
  | { kind: "reused" }
  | { kind: "in_progress" };

/** Canonical JSON (sorted keys) so the same logical request always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(v as object)
    .sort()
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

export const requestHash = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");

/** A reservation older than this without a response is treated as abandoned (crash) and may be taken over. */
const ABANDONED_MS = 2 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // A-SEC-21

export async function reserveIdempotencyKey(r: {
  organizationId: string;
  userId: string;
  key: string;
  command: string;
  hash: string;
  clientCommandId?: string | null;
  deviceId?: string | null;
  clientCreatedAt?: Date | null;
}): Promise<Reservation> {
  const now = new Date();
  const inserted = await db
    .insert(idempotencyKeys)
    .values({
      organizationId: r.organizationId,
      key: r.key,
      command: r.command,
      userId: r.userId,
      requestHash: r.hash,
      clientCommandId: r.clientCommandId ?? null,
      deviceId: r.deviceId ?? null,
      clientCreatedAt: r.clientCreatedAt ?? null,
      expiresAt: new Date(now.getTime() + RETENTION_MS),
    })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });
  if (inserted[0]) return { kind: "reserved", id: inserted[0].id };
  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.organizationId, r.organizationId), eq(idempotencyKeys.key, r.key)))
    .limit(1);
  if (!row) return { kind: "in_progress" };
  if (row.command !== r.command || row.userId !== r.userId || row.requestHash !== r.hash) return { kind: "reused" };
  if (row.result !== null && row.responseCode !== null) return { kind: "replay", response: { status: row.responseCode, body: row.result } };
  // No response yet: either a concurrent duplicate (answer "in progress") or an abandoned reservation (take it over;
  // the command's own ledger idempotency makes the re-run safe).
  const taken = await db
    .update(idempotencyKeys)
    .set({ createdAt: now })
    .where(and(eq(idempotencyKeys.id, row.id), lt(idempotencyKeys.createdAt, new Date(now.getTime() - ABANDONED_MS))))
    .returning({ id: idempotencyKeys.id });
  return taken[0] ? { kind: "reserved", id: taken[0].id } : { kind: "in_progress" };
}

export async function completeIdempotencyKey(id: string, response: StoredResponse) {
  await db
    .update(idempotencyKeys)
    .set({ result: response.body as object, responseCode: response.status, completedAt: new Date() })
    .where(eq(idempotencyKeys.id, id));
}

/** Unexpected failures release the key so the client can retry with the same key. */
export async function releaseIdempotencyKey(id: string) {
  await db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id));
}
