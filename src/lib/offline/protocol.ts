/**
 * Offline sync protocol (ADR-018, docs/offline-sync.md §3, §4). Isomorphic: imports only zod, so the
 * device outbox, the service worker pages and the server replay share one definition.
 *
 * A queued command is `{ id (client UUIDv7), idempotencyKey (UUID), type, payload, siteId,
 * clientCreatedAt, clientSequence, dependsOn?, authSnapshot* }`; a flush sends up to 50 of them to
 * `POST /api/v1/sync/commands` with the device key in the `X-Device-Key` header.
 */
import { z } from "zod";
import type { Permission } from "@/lib/permissions";

export const DEVICE_KEY_HEADER = "x-device-key";
export const SYNC_BATCH_MAX = 50;

/** Same values as src/db/schema/offline.ts (a unit test keeps them equal). */
export const OFFLINE_WORKFLOWS = ["movement_request", "dispensing", "process_steps", "stock_count", "receiving", "pick_pack"] as const;
export type OfflineWorkflow = (typeof OFFLINE_WORKFLOWS)[number];
export const WORKFLOW_LABEL: Record<OfflineWorkflow, string> = {
  movement_request: "Stock moves",
  dispensing: "Weighing (dispensing)",
  process_steps: "Process step checklists",
  stock_count: "Stock counts",
  receiving: "Receiving",
  pick_pack: "Pick and pack scans",
};
/** Workflows that have an offline capture screen and a replay handler in this release (A-W4D-01). */
export const BUILT_OFFLINE_WORKFLOWS: readonly OfflineWorkflow[] = ["movement_request", "dispensing", "stock_count"];

export const SYNC_CONFLICT_REASONS = [
  "validation_failed",
  "permission_denied",
  "site_not_allowed",
  "state_changed",
  "stock_not_eligible",
  "insufficient_stock",
  "out_of_tolerance",
  "wrong_lot",
  "duplicate_key_mismatch",
  "dependency_failed",
  "auth_snapshot_expired",
  "session_revoked",
  "count_closed",
  "other",
] as const;
export type SyncConflictReason = (typeof SYNC_CONFLICT_REASONS)[number];
export const REASON_LABEL: Record<SyncConflictReason, string> = {
  validation_failed: "Not valid",
  permission_denied: "Not allowed",
  site_not_allowed: "Site not allowed",
  state_changed: "Record changed meanwhile",
  stock_not_eligible: "Stock not usable",
  insufficient_stock: "Not enough stock",
  out_of_tolerance: "Out of tolerance",
  wrong_lot: "Wrong lot",
  duplicate_key_mismatch: "Duplicate request",
  dependency_failed: "Earlier change failed",
  auth_snapshot_expired: "Offline sign-in too old",
  session_revoked: "Sign-in ended",
  count_closed: "Count closed",
  other: "Other",
};

const QTY = z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/, "Enter a quantity like 1500 or 12.5 (up to 6 decimals).");
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * Commands a device may queue (docs/offline-sync.md §3). Everything else is online-only: the server
 * rejects it with `ONLINE_ONLY` and the UI shows "Needs a connection".
 */
export const OFFLINE_COMMANDS = {
  "inventory.movement.transfer": {
    workflow: "movement_request",
    permission: "inventory.movement.post",
    label: "Stock move",
    payload: z.object({ lotId: z.uuid(), fromLocationId: z.uuid(), toLocationId: z.uuid(), qty: QTY, reason: z.string().trim().min(3, "Give a reason of at least 3 characters.").max(500) }).strict(),
  },
  "inventory.stock_count.record": {
    workflow: "stock_count",
    permission: "inventory.stock_count.submit",
    label: "Count entry",
    payload: z
      .object({
        countId: z.uuid(),
        locationId: z.uuid(),
        lotId: z.uuid().nullable().optional(),
        unlabelledDescription: optText(500),
        qty: QTY,
        note: optText(500),
      })
      .strict(),
  },
  "production.dispense_record.create": {
    workflow: "dispensing",
    permission: "production.dispense_record.create",
    label: "Weighing",
    payload: z
      .object({
        batchId: z.uuid(),
        batchMaterialId: z.uuid(),
        lotRef: z.string().trim().min(1, "Scan the lot.").max(120),
        locationRef: optText(120),
        qty: z.string().trim().min(1, "Enter the weight.").max(30),
        uom: z.string().trim().max(10).optional(),
        equipmentRef: optText(120),
        partial: z.boolean().optional(),
      })
      .strict(),
  },
} as const satisfies Record<string, { workflow: OfflineWorkflow; permission: Permission; label: string; payload: z.ZodType }>;

export type OfflineCommandType = keyof typeof OFFLINE_COMMANDS;
export type OfflinePayload<T extends OfflineCommandType> = z.input<(typeof OFFLINE_COMMANDS)[T]["payload"]>;
export const isOfflineCommandType = (t: string): t is OfflineCommandType => Object.prototype.hasOwnProperty.call(OFFLINE_COMMANDS, t);
export const commandLabel = (t: string) => (isOfflineCommandType(t) ? OFFLINE_COMMANDS[t].label : t);

const isoTime = z.iso.datetime({ offset: true });

/** One command on the wire (client camelCase → `sync_commands` columns, docs/offline-sync.md §4). */
export const SyncCommandWire = z
  .object({
    id: z.uuid({ version: "v7", message: "id must be a client-generated UUIDv7." }),
    idempotencyKey: z.uuid(),
    type: z.string().regex(/^[a-z]+\.[a-z_]+\.[a-z_]+$/, "Unknown command type.").max(100),
    payload: z.record(z.string(), z.unknown()),
    siteId: z.uuid(),
    clientCreatedAt: isoTime,
    clientSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    dependsOn: z.uuid().nullable().optional(),
    authSnapshotIssuedAt: isoTime,
    authSnapshotSessionId: z.uuid().nullable().optional(),
    authSnapshotUserId: z.uuid(),
  })
  .strict();
export type SyncCommandWire = z.infer<typeof SyncCommandWire>;

export const SyncBatchWire = z
  .object({
    /** The device clock when the batch was sent: the server compares it with its own clock (skew, A-OFF-05). */
    deviceSentAt: isoTime,
    commands: z.array(SyncCommandWire).min(1).max(SYNC_BATCH_MAX),
  })
  .strict();
export type SyncBatchWire = z.infer<typeof SyncBatchWire>;

/** Per-command answer. `retry` = transient on the server (read-only window, overload): resend later with the same id. */
export type SyncItemStatus = "applied" | "rejected" | "conflict" | "superseded" | "retry";
export type SyncItemResult = {
  id: string;
  status: SyncItemStatus;
  reasonCode?: SyncConflictReason | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  serverResult?: unknown;
  conflictId?: string | null;
  appliedEntityNumber?: string | null;
};

export type DeviceInfo = {
  id: string;
  status: "pending" | "active" | "suspended" | "removed";
  label: string;
  siteId: string;
  siteCode: string;
  allowedWorkflows: OfflineWorkflow[];
};

/** What the device keeps to decide offline whether a new command may be queued (A-OFF-02). */
export type AuthSnapshot = {
  userId: string;
  displayName: string;
  organizationId: string;
  sessionId: string | null;
  issuedAt: string;
  /** issuedAt + snapshot validity, capped by the session's absolute expiry. */
  expiresAt: string;
  sessionExpiresAt: string | null;
  currentSiteId: string;
  sites: { id: string; code: string; name: string }[];
  /** siteId → offline-relevant permissions held at that site. */
  permissions: Record<string, string[]>;
  /** siteId → workflows the site policy allows offline. */
  siteWorkflows: Record<string, OfflineWorkflow[]>;
  anonymousMovementRequests: Record<string, boolean>;
  device: DeviceInfo | null;
  policy: { retryScheduleSeconds: number[]; maxAttempts: number; maxQueueAgeHours: number; snapshotMaxAgeHours: number; fullRefreshAfterHours: number; clockSkewFlagMinutes: number };
  serverTime: string;
};

/** Reference data cached on the device (docs/offline-sync.md §7). DTO allow-list: no prices, costs, payroll or personal data. */
export type ReferenceMaterial = { id: string; code: string; name: string; baseUom: string; materialKind: string };
export type ReferenceLocation = { id: string; siteId: string; code: string; name: string; kind: string; isActive: boolean };
export type ReferenceLot = {
  id: string;
  siteId: string;
  lotNumber: string;
  itemKind: string;
  materialId: string | null;
  itemCode: string | null;
  itemName: string | null;
  qualityStatus: string;
  expiresOn: string | null;
  baseUom: string;
  balances: { locationId: string; qty: string }[];
};
export type ReferenceCount = { id: string; siteId: string; countNumber: string; status: string; isBlind: boolean; locationIds: string[] };
export type ReferenceBatchLine = {
  id: string;
  lineNo: number;
  materialId: string;
  materialCode: string;
  materialName: string;
  baseUom: string;
  theoreticalQtyG: string;
  tolerancePct: string;
  toleranceAbsG: string | null;
  dispensedQtyG: string;
  status: string;
  reservedLotIds: string[];
};
export type ReferenceBatch = {
  id: string;
  siteId: string;
  batchNumber: string;
  status: string;
  productName: string;
  weighing: { stepNo: number; name: string; requiresEquipment: boolean; equipmentKind: string | null } | null;
  lines: ReferenceBatchLine[];
  scales: { id: string; code: string; name: string }[];
};
export type ReferencePayload = {
  siteId: string;
  generatedAt: string;
  full: true;
  cursor: string;
  materials: ReferenceMaterial[] | null;
  locations: ReferenceLocation[] | null;
  lots: ReferenceLot[] | null;
  counts: ReferenceCount[] | null;
  batches: ReferenceBatch[] | null;
};
