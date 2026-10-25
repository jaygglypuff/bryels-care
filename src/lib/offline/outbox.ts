/**
 * The outbox (US-7-02, docs/offline-sync.md §4.1, §4.2). FIFO per device; a flush sends due
 * commands head-first in batches of up to 50 with their stored ids and idempotency keys, so a resend
 * after a lost response is harmless. Transport failures back off on the A-OFF-08 schedule and turn
 * into `failed` after `maxAttempts`; a server decision is final (`synced` or `conflict`) and is never
 * resent. Pure orchestration over the store and an injected transport, so it is unit-tested with
 * fake-indexeddb and a fake clock.
 */
import { uuidv7 } from "uuidv7";
import { canQueueOffline, retryDelayMs } from "./policy";
import { OFFLINE_COMMANDS, SYNC_BATCH_MAX, type AuthSnapshot, type OfflineCommandType, type SyncCommandWire, type SyncItemResult } from "./protocol";
import { type OfflineDb, type OutboxEntry, type OutboxStatus, META, getSnapshot, log, setMeta } from "./store";

export class OfflineRefused extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "OfflineRefused";
  }
}

export type EnqueueInput<T extends OfflineCommandType = OfflineCommandType> = { type: T; payload: Record<string, unknown>; siteId: string; summary: string; dependsOn?: string | null };

/**
 * Queues one command after the same local checks the server re-runs (snapshot age, session,
 * device grant, site policy, permission, payload shape). Throws OfflineRefused with the reason.
 */
export async function enqueue(db: OfflineDb, input: EnqueueInput, deps: { now: Date; sequence: () => number }): Promise<OutboxEntry> {
  const snapshot = await getSnapshot(db);
  const decision = canQueueOffline(snapshot, input.type, input.siteId, deps.now);
  if (!decision.ok) throw new OfflineRefused(decision.code, decision.message);
  const parsed = OFFLINE_COMMANDS[input.type].payload.safeParse(input.payload);
  if (!parsed.success) throw new OfflineRefused("validation", parsed.error.issues[0]?.message ?? "Check the entry.");
  const s = snapshot as AuthSnapshot;
  const now = deps.now.toISOString();
  const entry: OutboxEntry = {
    id: uuidv7(),
    idempotencyKey: crypto.randomUUID(),
    type: input.type,
    payload: parsed.data as Record<string, unknown>,
    siteId: input.siteId,
    summary: input.summary.slice(0, 300),
    createdAt: now,
    sequence: deps.sequence(),
    dependsOn: input.dependsOn ?? null,
    authSnapshotIssuedAt: s.issuedAt,
    authSnapshotSessionId: s.sessionId,
    authSnapshotUserId: s.userId,
    status: "pending",
    attempts: 0,
    nextAttemptAt: deps.now.getTime(),
    lastError: null,
    errorCode: null,
    reasonCode: null,
    conflictId: null,
    appliedEntityNumber: null,
    updatedAt: now,
  };
  await db.outbox.add(entry);
  return entry;
}

/** After a crash or a closed tab, commands that were in flight go back to pending (the server answers a resend from its stored result). */
export async function recoverInterrupted(db: OfflineDb) {
  await db.outbox.where("status").equals("syncing").modify({ status: "pending" });
}

export function toWire(e: OutboxEntry): SyncCommandWire {
  return {
    id: e.id,
    idempotencyKey: e.idempotencyKey,
    type: e.type,
    payload: e.payload,
    siteId: e.siteId,
    clientCreatedAt: e.createdAt,
    clientSequence: e.sequence,
    dependsOn: e.dependsOn,
    authSnapshotIssuedAt: e.authSnapshotIssuedAt,
    authSnapshotSessionId: e.authSnapshotSessionId,
    authSnapshotUserId: e.authSnapshotUserId,
  };
}

/** Due commands in device order. A command whose dependency already conflicted is closed locally as `dependency_failed` and not sent. */
export async function dueBatch(db: OfflineDb, now: Date, max = SYNC_BATCH_MAX): Promise<OutboxEntry[]> {
  const pending = (await db.outbox.where("status").equals("pending").toArray()).sort((a, b) => a.sequence - b.sequence);
  const out: OutboxEntry[] = [];
  for (const e of pending) {
    if (out.length >= max) break;
    if (e.nextAttemptAt > now.getTime()) continue;
    if (e.dependsOn) {
      const dep = await db.outbox.get(e.dependsOn);
      if (dep && dep.status === "conflict") {
        await db.outbox.update(e.id, { status: "conflict", reasonCode: "dependency_failed", errorCode: "DEPENDENCY_FAILED", lastError: "An earlier change this one depends on was not accepted.", updatedAt: now.toISOString() });
        continue;
      }
      // Hold back until the dependency is decided (it is sent first in this or an earlier batch).
      if (dep && dep.status !== "synced" && !out.some((x) => x.id === dep.id)) continue;
    }
    out.push(e);
  }
  return out;
}

export type Policy = AuthSnapshot["policy"];
export type TransportResult =
  | { kind: "ok"; results: SyncItemResult[]; snapshot: AuthSnapshot; permissionsChanged: boolean }
  | { kind: "unauthenticated" }
  | { kind: "transient"; message: string }
  | { kind: "refused"; status: number; message: string };
export type Transport = (commands: SyncCommandWire[]) => Promise<TransportResult>;

async function backoff(db: OfflineDb, ids: string[], now: Date, policy: Policy, message: string, random: () => number) {
  for (const id of ids) {
    const e = await db.outbox.get(id);
    if (!e) continue;
    const attempts = e.attempts + 1;
    const failed = attempts >= policy.maxAttempts;
    await db.outbox.update(id, {
      status: (failed ? "failed" : "pending") as OutboxStatus,
      attempts,
      nextAttemptAt: failed ? Number.MAX_SAFE_INTEGER : now.getTime() + retryDelayMs(attempts, policy.retryScheduleSeconds, random()),
      lastError: message,
      updatedAt: now.toISOString(),
    });
  }
}

export type FlushSummary = { sent: number; synced: number; conflicts: number; retrying: number; failed: number; needsSignIn: boolean; transportError: string | null; permissionsChanged: boolean };

/**
 * Sends due commands until none is due or the transport fails. Returns what happened, for the sync
 * chip and the sync log. Never removes a command: synced rows are pruned later, after the person saw them.
 */
export async function flush(db: OfflineDb, deps: { transport: Transport; now: () => Date; random?: () => number; maxBatches?: number }): Promise<FlushSummary> {
  const random = deps.random ?? Math.random;
  const sum: FlushSummary = { sent: 0, synced: 0, conflicts: 0, retrying: 0, failed: 0, needsSignIn: false, transportError: null, permissionsChanged: false };
  for (let i = 0; i < (deps.maxBatches ?? 20); i++) {
    const now = deps.now();
    const batch = await dueBatch(db, now);
    if (!batch.length) break;
    const snapshot = await getSnapshot(db);
    const policy: Policy = snapshot?.policy ?? { retryScheduleSeconds: [5, 30, 120, 600, 1800], maxAttempts: 20, maxQueueAgeHours: 72, snapshotMaxAgeHours: 12, fullRefreshAfterHours: 24, clockSkewFlagMinutes: 10 };
    const ids = batch.map((e) => e.id);
    await db.outbox.where("id").anyOf(ids).modify({ status: "syncing", updatedAt: now.toISOString() });
    sum.sent += batch.length;
    let res: TransportResult;
    try {
      res = await deps.transport(batch.map(toWire));
    } catch (e) {
      res = { kind: "transient", message: e instanceof Error ? e.message : "Network error" };
    }
    const at = deps.now();
    if (res.kind === "unauthenticated") {
      await db.outbox.where("id").anyOf(ids).modify({ status: "pending", lastError: "Sign in again to sync.", updatedAt: at.toISOString() });
      sum.needsSignIn = true;
      break;
    }
    if (res.kind === "transient") {
      await backoff(db, ids, at, policy, `Could not reach the server: ${res.message}`, random);
      sum.transportError = res.message;
      const after = await db.outbox.where("id").anyOf(ids).toArray();
      sum.failed += after.filter((e) => e.status === "failed").length;
      sum.retrying += after.filter((e) => e.status === "pending").length;
      break;
    }
    if (res.kind === "refused") {
      // HTTP 4xx (other than 401/429) for the whole batch: terminal on the device, never resent (§4.1).
      await db.outbox.where("id").anyOf(ids).modify({ status: "conflict", errorCode: `HTTP_${res.status}`, lastError: res.message, updatedAt: at.toISOString() });
      sum.conflicts += ids.length;
      break;
    }
    await setMeta(db, META.snapshot, res.snapshot);
    await setMeta(db, META.lastSyncAt, at.toISOString());
    if (res.permissionsChanged) {
      sum.permissionsChanged = true;
      await setMeta(db, META.permissionsChanged, at.toISOString());
    }
    const retry: string[] = [];
    for (const r of res.results) {
      const base = { errorCode: r.errorCode ?? null, lastError: r.errorMessage ?? null, reasonCode: r.reasonCode ?? null, conflictId: r.conflictId ?? null, updatedAt: at.toISOString() };
      if (r.status === "applied") {
        await db.outbox.update(r.id, { ...base, status: "synced", appliedEntityNumber: r.appliedEntityNumber ?? null, lastError: null });
        sum.synced++;
      } else if (r.status === "retry") {
        retry.push(r.id);
      } else {
        await db.outbox.update(r.id, { ...base, status: "conflict" });
        sum.conflicts++;
      }
    }
    // Commands the server did not answer stay pending (e.g. cut short); they are resent next time.
    const answered = new Set(res.results.map((r) => r.id));
    const unanswered = ids.filter((id) => !answered.has(id));
    if (retry.length) {
      await backoff(db, retry, at, policy, "The server asked to try again later.", random);
      sum.retrying += retry.length;
    }
    if (unanswered.length) await db.outbox.where("id").anyOf(unanswered).modify({ status: "pending", updatedAt: at.toISOString() });
  }
  if (sum.sent) await log(db, "flush", `sent ${sum.sent}, synced ${sum.synced}, conflicts ${sum.conflicts}, retrying ${sum.retrying}, failed ${sum.failed}${sum.transportError ? ` (${sum.transportError})` : ""}`, deps.now());
  return sum;
}

/** Manual "Sync now": failed commands get a fresh attempt budget once per tap; the schedule restarts from 5 s. */
export async function resetForSyncNow(db: OfflineDb, now: Date) {
  await db.outbox.where("status").equals("failed").modify({ status: "pending", attempts: 0, nextAttemptAt: now.getTime(), updatedAt: now.toISOString() });
  await db.outbox.where("status").equals("pending").modify({ nextAttemptAt: now.getTime() });
}

/** On an `online` event the schedule restarts from the first wait (§4.1) without resetting failed ones. */
export async function restartSchedule(db: OfflineDb, now: Date) {
  await db.outbox.where("status").equals("pending").modify({ nextAttemptAt: now.getTime() });
}

export type OutboxStats = Record<OutboxStatus, number> & { oldestPendingAt: string | null };
export async function outboxStats(db: OfflineDb): Promise<OutboxStats> {
  const all = await db.outbox.toArray();
  const s: OutboxStats = { pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0, oldestPendingAt: null };
  for (const e of all) {
    s[e.status]++;
    if ((e.status === "pending" || e.status === "failed" || e.status === "syncing") && (!s.oldestPendingAt || e.createdAt < s.oldestPendingAt)) s.oldestPendingAt = e.createdAt;
  }
  return s;
}

/** Commands the server has not decided yet (shown before sign-out, A-OFF-06). */
export async function unsentCommands(db: OfflineDb): Promise<OutboxEntry[]> {
  return (await db.outbox.where("status").anyOf(["pending", "syncing", "failed"]).toArray()).sort((a, b) => a.sequence - b.sequence);
}

/** Synced rows are kept for a day so the person can see them, then pruned. */
export async function pruneSynced(db: OfflineDb, now: Date, keepMs = 24 * 3_600_000) {
  const cutoff = new Date(now.getTime() - keepMs).toISOString();
  const old = await db.outbox.where("status").equals("synced").filter((e) => e.updatedAt < cutoff).primaryKeys();
  await db.outbox.bulkDelete(old);
}
