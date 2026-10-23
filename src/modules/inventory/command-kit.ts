import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { idempotencyKeys } from "@/db/schema";
import { DomainError } from "@/lib/errors";

/**
 * Small shared kit for the W1C inventory commands: idempotency keys (data-model §1.10, §5.4 step 1)
 * and typed state machines (CLAUDE.md: no free-form status strings).
 */

const hashOf = (body: unknown) => createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");

/**
 * Claims an idempotency key as the first lock of a command transaction. A concurrent duplicate
 * blocks on the unique index until the first transaction commits, then sees the stored result.
 * Returns `{ replay }` when the key was used before (same command and body), or null to proceed.
 * The same key with another command or body is 422 IDEMPOTENCY_KEY_REUSED.
 */
export async function claimIdempotencyKey<T>(tx: Tx, organizationId: string, key: string, command: string, body: unknown): Promise<{ replay: T } | null> {
  const requestHash = hashOf(body);
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({ organizationId, key, command, result: { requestHash, response: null } })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });
  if (inserted.length) return null;
  const [row] = await tx
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.organizationId, organizationId), eq(idempotencyKeys.key, key)))
    .limit(1);
  const stored = (row?.result ?? {}) as { requestHash?: string; response?: T };
  if (!row || row.command !== command || stored.requestHash !== requestHash || stored.response == null) {
    throw new DomainError("validation", "IDEMPOTENCY_KEY_REUSED: this request id was already used for a different request. Reload the page and try again.", {
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  }
  return { replay: stored.response };
}

/** Stores the response for a claimed key in the same transaction. */
export async function storeIdempotentResult(tx: Tx, organizationId: string, key: string, body: unknown, response: unknown) {
  await tx
    .update(idempotencyKeys)
    .set({ result: { requestHash: hashOf(body), response } as object })
    .where(and(eq(idempotencyKeys.organizationId, organizationId), eq(idempotencyKeys.key, key)));
}

/** A typed transition table. `assert` throws 409 state with a plain-language message. */
export function stateMachine<S extends string>(name: string, transitions: Record<S, readonly S[]>, words?: Partial<Record<S, string>>) {
  const word = (s: S) => words?.[s] ?? s.replace(/_/g, " ");
  return {
    name,
    transitions,
    can(from: S, to: S) {
      return (transitions[from] ?? []).includes(to);
    },
    assert(from: string, to: S, label: string) {
      if (!(transitions[from as S] ?? []).includes(to)) {
        throw new DomainError("state", `${label} is ${word(from as S)}; it cannot become ${word(to)}.`, { machine: name, from, to });
      }
    },
  };
}
