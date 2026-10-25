import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { OFFLINE_COMMANDS, type AuthSnapshot, type OfflineWorkflow } from "../protocol";
import { deviceInfo, findDeviceByKey, touchDevice } from "./devices";

/** Permissions the device needs to know offline (commands it may queue plus the reads of its cache). */
const OFFLINE_PERMISSIONS: Permission[] = [
  ...new Set<Permission>([...Object.values(OFFLINE_COMMANDS).map((c) => c.permission), "inventory.lot.view", "masterdata.material.view", "masterdata.location.view", "production.batch.view", "inventory.stock_count.view"]),
];

/** Offline policy for the organization (settings `offline.*`, A-OFF-01/02/05/08/09). */
export async function offlinePolicy(organizationId: string) {
  const [snapshotMaxAgeHours, retryScheduleSeconds, maxAttempts, queue, fullRefreshAfterHours, clockSkewFlagMinutes] = await Promise.all([
    getSetting(db, organizationId, "offline.auth_snapshot_max_age_hours"),
    getSetting(db, organizationId, "offline.retry_schedule_seconds"),
    getSetting(db, organizationId, "offline.max_attempts"),
    getSetting(db, organizationId, "offline.max_queue_age_hours"),
    getSetting(db, organizationId, "offline.full_refresh_after_hours"),
    getSetting(db, organizationId, "offline.clock_skew_flag_minutes"),
  ]);
  // docs/offline-sync.md §4.1: max_queue_age_hours must be ≥ the snapshot validity; the larger value applies.
  return { snapshotMaxAgeHours, retryScheduleSeconds, maxAttempts, maxQueueAgeHours: Math.max(queue, snapshotMaxAgeHours), fullRefreshAfterHours, clockSkewFlagMinutes };
}

/**
 * The authorization snapshot (US-7-03, docs/offline-sync.md §2 "Auth"): who is signed in, at which
 * sites, with which offline-relevant permissions, which device and policy, and until when the device
 * may queue work without a server round trip. Refreshed on every sync. Contains no secret: the
 * session id identifies the session, the HttpOnly cookie still authenticates it.
 */
export async function buildAuthSnapshot(ctx: AuthContext, deviceKey: string | null, now = new Date()): Promise<AuthSnapshot> {
  const policy = await offlinePolicy(ctx.organizationId);
  const sessionId = ctx.sessionId;
  const [s] = sessionId ? await db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, sessionId)).limit(1) : [];
  const validity = new Date(now.getTime() + policy.snapshotMaxAgeHours * 3_600_000);
  const expiresAt = s && s.expiresAt < validity ? s.expiresAt : validity;
  const permissions: Record<string, string[]> = {};
  const siteWorkflows: Record<string, OfflineWorkflow[]> = {};
  const anonymousMovementRequests: Record<string, boolean> = {};
  for (const site of ctx.allowedSites) {
    permissions[site.id] = OFFLINE_PERMISSIONS.filter((p) => ctx.canAt(p, site.id));
    siteWorkflows[site.id] = (await getSetting(db, ctx.organizationId, "offline.workflows", site.id)) as OfflineWorkflow[];
    anonymousMovementRequests[site.id] = await getSetting(db, ctx.organizationId, "offline.anonymous_movement_requests", site.id);
  }
  const device = await findDeviceByKey(ctx.organizationId, deviceKey);
  if (device && device.status !== "removed") await touchDevice(device.id, {});
  return {
    userId: ctx.userId,
    displayName: ctx.displayName,
    organizationId: ctx.organizationId,
    sessionId,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sessionExpiresAt: s?.expiresAt.toISOString() ?? null,
    currentSiteId: ctx.currentSiteId,
    sites: ctx.allowedSites.map((x) => ({ id: x.id, code: x.code, name: x.name })),
    permissions,
    siteWorkflows,
    anonymousMovementRequests,
    device: device ? await deviceInfo(device) : null,
    policy,
    serverTime: now.toISOString(),
  };
}
