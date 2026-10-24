import "server-only";
import { db, type Tx } from "@/db/client";

/**
 * Lets a command run inside a caller's transaction (W3C, docs/data-migration-plan.md §9.3): with
 * `{ tx }` the command runs in a SAVEPOINT of that transaction, so a refused row rolls back only its
 * own writes while the import chunk continues; without it the command opens its own transaction as
 * before. The command's rules, permission checks and audit events are identical either way.
 */
export type InTx = { tx?: Tx };

export function runInTx<T>(opts: InTx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return opts?.tx ? opts.tx.transaction(fn) : db.transaction(fn);
}
