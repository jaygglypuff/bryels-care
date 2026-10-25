/**
 * Device-side offline rules (docs/offline-sync.md §1 rule 5, §4.1). Pure functions: no IndexedDB,
 * no fetch, no clock of their own, so the unit tests drive them with fixed times.
 */
import { BUILT_OFFLINE_WORKFLOWS, OFFLINE_COMMANDS, type AuthSnapshot, type OfflineCommandType, type OfflineWorkflow } from "./protocol";

export const DEFAULT_RETRY_SCHEDULE_SECONDS = [5, 30, 120, 600, 1800];
export const TRANSPORT_TIMEOUT_MS = 30_000;
const HOUR = 3_600_000;

/**
 * Wait before the next send after `attempts` failed attempts (A-OFF-08): the schedule's entry for
 * this attempt, the last entry repeating, jittered ±20 %. `random` in [0, 1).
 */
export function retryDelayMs(attempts: number, scheduleSeconds: readonly number[] = DEFAULT_RETRY_SCHEDULE_SECONDS, random: number = Math.random()): number {
  const schedule = scheduleSeconds.length ? scheduleSeconds : DEFAULT_RETRY_SCHEDULE_SECONDS;
  const base = schedule[Math.min(Math.max(attempts, 1), schedule.length) - 1] * 1000;
  const jitter = 0.8 + 0.4 * Math.min(Math.max(random, 0), 0.999999);
  return Math.round(base * jitter);
}

/** HTTP answers that mean "the server did not decide": resend the same batch later (§4.1). */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export type QueueDecision = { ok: true } | { ok: false; code: "no_snapshot" | "snapshot_expired" | "session_expired" | "workflow_not_allowed" | "device_not_registered" | "permission_missing" | "site_not_allowed" | "not_offline_capable"; message: string };

/**
 * May a new offline command be queued now? Mirrors what the server re-checks on replay; a "no"
 * here only prevents work the server would park anyway (A-OFF-02 snapshot age, expired session,
 * device grant, site policy, permission at the site).
 */
export function canQueueOffline(snapshot: AuthSnapshot | null, type: string, siteId: string, now: Date): QueueDecision {
  if (!snapshot) return { ok: false, code: "no_snapshot", message: "This device has no offline sign-in yet. Connect, sign in and open Sync once." };
  if (!(type in OFFLINE_COMMANDS)) return { ok: false, code: "not_offline_capable", message: "Needs a connection: this action is online-only." };
  const def = OFFLINE_COMMANDS[type as OfflineCommandType];
  if (now.getTime() > new Date(snapshot.expiresAt).getTime()) {
    return { ok: false, code: "snapshot_expired", message: `Offline sign-in is older than ${snapshot.policy.snapshotMaxAgeHours} h. Connect to the network to continue; your queued changes are kept.` };
  }
  if (snapshot.sessionExpiresAt && now.getTime() > new Date(snapshot.sessionExpiresAt).getTime()) {
    return { ok: false, code: "session_expired", message: "Your sign-in has expired. Connect and sign in to continue; your queued changes are kept." };
  }
  if (!snapshot.sites.some((s) => s.id === siteId)) return { ok: false, code: "site_not_allowed", message: "This site is not one of your sites." };
  const workflow: OfflineWorkflow = def.workflow;
  if (!BUILT_OFFLINE_WORKFLOWS.includes(workflow) || !(snapshot.siteWorkflows[siteId] ?? []).includes(workflow)) {
    return { ok: false, code: "workflow_not_allowed", message: "Needs a connection: this workflow is not allowed offline at this site." };
  }
  const device = snapshot.device;
  const deviceGrants = device && device.status === "active" && device.siteId === siteId ? device.allowedWorkflows : null;
  if (device && (device.status === "suspended" || device.status === "removed")) {
    return { ok: false, code: "device_not_registered", message: "This device was suspended or removed by an administrator. Connect to continue." };
  }
  if (workflow === "movement_request") {
    if (!(deviceGrants?.includes(workflow) || (!deviceGrants && snapshot.anonymousMovementRequests[siteId]))) {
      return { ok: false, code: "device_not_registered", message: "Needs a connection: stock moves offline need a registered device here." };
    }
  } else if (!deviceGrants?.includes(workflow)) {
    return { ok: false, code: "device_not_registered", message: "Needs a connection: this device is not registered for this workflow offline." };
  }
  if (!(snapshot.permissions[siteId] ?? []).includes(def.permission)) {
    return { ok: false, code: "permission_missing", message: "You do not have permission for this action at this site." };
  }
  return { ok: true };
}

/**
 * Hours left before a queued command needs review (A-OFF-09), or null when far away. The device
 * warns from the last quarter of the window (at least 12 h before).
 */
export function queueAgeWarning(clientCreatedAt: string, now: Date, maxQueueAgeHours: number): { hoursLeft: number; expired: boolean } | null {
  const age = now.getTime() - new Date(clientCreatedAt).getTime();
  const limit = maxQueueAgeHours * HOUR;
  const left = limit - age;
  if (left <= 0) return { hoursLeft: 0, expired: true };
  if (left <= Math.max(limit / 4, 12 * HOUR)) return { hoursLeft: Math.ceil(left / HOUR), expired: false };
  return null;
}

/** True when cached reference data is older than the full-refresh window (A-OFF-01). */
export function isReferenceStale(refreshedAt: string | null | undefined, now: Date, fullRefreshAfterHours: number): boolean {
  if (!refreshedAt) return true;
  return now.getTime() - new Date(refreshedAt).getTime() > fullRefreshAfterHours * HOUR;
}
