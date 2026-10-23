/**
 * `/api/v1` contract (US-2-22, ADR-018 groundwork, docs/architecture.md §6). Isomorphic: imports
 * only zod, so the typed client and the docs generator can use it without server code.
 *
 * Every command is `POST <path>` with a JSON envelope:
 *   { commandId: <client UUIDv7>, siteId, deviceId?, clientCreatedAt?, payload }
 * plus an `Idempotency-Key: <uuid>` header (required when `idempotent`). Responses are
 * `{ ok: true, data }` or `{ ok: false, error: { code, message, details } }` and echo `X-Request-Id`.
 *
 * Adding a command: add an entry here (payload schema, permission, idempotent flag, offline
 * eligibility from docs/process-maps.md §6), add its route file, run `pnpm api:contract` and commit
 * the regenerated `docs/api/v1-contract.json`; the contract test fails otherwise. Breaking changes
 * go to `/api/v2`.
 */
import { z } from "zod";
import type { Permission } from "@/lib/permissions";

export const API_VERSION = "v1";

const QTY = z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/, "Enter a quantity like 1500 or 12.5 (up to 6 decimals).");
const REASON = z.string().trim().min(3, "Give a reason of at least 3 characters.").max(500);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

/** Offline eligibility (docs/process-maps.md §6): queueable commands may be replayed from the Phase 7 outbox. */
export type OfflineEligibility = "queueable" | "online_only";

export type CommandContract<P extends z.ZodType = z.ZodType> = {
  kind: "command";
  name: string;
  method: "POST";
  path: string;
  summary: string;
  /** null = self-service (own records only). */
  permission: Permission | null;
  payload: P;
  idempotent: boolean;
  offline: OfflineEligibility;
};

export type QueryContract<Q extends z.ZodType = z.ZodType> = {
  kind: "query";
  name: string;
  method: "GET";
  path: string;
  summary: string;
  permission: Permission | null;
  query: Q;
  /** `file` = a CSV/XLSX download through the export layer. */
  response: "json" | "file";
};

/** The command envelope every POST carries. */
export function commandEnvelope<P extends z.ZodType>(payload: P) {
  return z
    .object({
      commandId: z.uuid({ version: "v7", message: "commandId must be a client-generated UUIDv7." }),
      siteId: z.uuid(),
      deviceId: z.string().trim().min(1).max(100).optional(),
      clientCreatedAt: z.iso.datetime({ offset: true }).optional(),
      payload,
    })
    .strict();
}

export const commands = {
  transferStock: {
    kind: "command",
    name: "inventory.movement.transfer",
    method: "POST",
    path: "/api/v1/inventory/movements/transfer",
    summary: "Move a quantity of one lot between two locations of its site (scan-to-move).",
    permission: "inventory.movement.post",
    payload: z.object({ lotId: z.uuid(), fromLocationId: z.uuid(), toLocationId: z.uuid(), qty: QTY, reason: REASON }).strict(),
    idempotent: true,
    offline: "queueable",
  },
  reverseMovement: {
    kind: "command",
    name: "inventory.movement.reverse",
    method: "POST",
    path: "/api/v1/inventory/movements/reverse",
    summary: "Reverse a posted movement with a reason, optionally posting a corrected replacement transfer.",
    permission: "inventory.movement.void",
    payload: z
      .object({
        movementId: z.uuid(),
        reason: REASON,
        confirmation: z.string().trim().min(1),
        replacement: z.object({ fromLocationId: z.uuid(), toLocationId: z.uuid(), qty: QTY }).strict().nullable().optional(),
      })
      .strict(),
    idempotent: true,
    offline: "online_only",
  },
  runReconciliation: {
    kind: "command",
    name: "inventory.reconciliation.run",
    method: "POST",
    path: "/api/v1/inventory/reconciliation/run",
    summary: "Enqueue an on-demand ledger reconciliation for the site.",
    permission: "inventory.balance.admin",
    payload: z.object({}).strict(),
    idempotent: true,
    offline: "online_only",
  },
  rebuildBalances: {
    kind: "command",
    name: "inventory.balance.rebuild",
    method: "POST",
    path: "/api/v1/inventory/balances/rebuild",
    summary: "Enqueue a projection rebuild from the ledger for the site (optionally the lots of a reconciliation run).",
    permission: "inventory.balance.admin",
    payload: z.object({ reconciliationRunId: z.uuid().nullable().optional(), lotIds: z.array(z.uuid()).max(5000).nullable().optional(), reason: REASON }).strict(),
    idempotent: true,
    offline: "online_only",
  },
  retryJob: {
    kind: "command",
    name: "platform.job.retry",
    method: "POST",
    path: "/api/v1/platform/jobs/retry",
    summary: "Put a failed or cancelled background job back in the queue.",
    permission: "platform.job.admin",
    payload: z.object({ jobId: z.uuid(), reason: z.string().trim().max(500).optional() }).strict(),
    idempotent: true,
    offline: "online_only",
  },
  cancelJob: {
    kind: "command",
    name: "platform.job.cancel",
    method: "POST",
    path: "/api/v1/platform/jobs/cancel",
    summary: "Cancel a queued (or failed) background job.",
    permission: "platform.job.admin",
    payload: z.object({ jobId: z.uuid(), reason: z.string().trim().max(500).optional() }).strict(),
    idempotent: true,
    offline: "online_only",
  },
  acknowledgeNotification: {
    kind: "command",
    name: "platform.notification.acknowledge",
    method: "POST",
    path: "/api/v1/platform/notifications/acknowledge",
    summary: "Acknowledge one of your own notifications.",
    permission: null,
    payload: z.object({ notificationId: z.uuid() }).strict(),
    idempotent: true,
    offline: "queueable",
  },
} as const satisfies Record<string, CommandContract>;

export const queries = {
  availability: {
    kind: "query",
    name: "inventory.availability.list",
    method: "GET",
    path: "/api/v1/inventory/availability",
    summary: "On hand, reserved, allocated, blocked and available per lot and location of a site.",
    permission: "inventory.balance.view",
    query: z
      .object({ siteId: z.uuid(), asOf: DATE.optional(), locationId: z.uuid().optional(), itemKind: z.enum(["material", "product"]).optional(), q: z.string().max(100).optional() })
      .strict(),
    response: "json",
  },
  availabilityExport: {
    kind: "query",
    name: "inventory.availability.export",
    method: "GET",
    path: "/api/v1/inventory/availability/export",
    summary: "CSV/XLSX of the availability rows (same scope as the screen; audited).",
    permission: "inventory.balance.export",
    query: z
      .object({
        siteId: z.uuid(),
        asOf: DATE.optional(),
        locationId: z.uuid().optional(),
        itemKind: z.enum(["material", "product"]).optional(),
        q: z.string().max(100).optional(),
        format: z.enum(["csv", "xlsx"]).default("csv"),
      })
      .strict(),
    response: "file",
  },
  stockCard: {
    kind: "query",
    name: "inventory.stock_card.get",
    method: "GET",
    path: "/api/v1/inventory/lots/{lotId}/stock-card",
    summary: "Stock card of a lot for a date range: opening, movements, running balance, closing and projection check.",
    permission: "inventory.movement.view",
    query: z.object({ lotId: z.uuid(), from: DATE, to: DATE, locationId: z.uuid().optional() }).strict(),
    response: "json",
  },
  stockCardExport: {
    kind: "query",
    name: "inventory.stock_card.export",
    method: "GET",
    path: "/api/v1/inventory/lots/{lotId}/stock-card/export",
    summary: "CSV/XLSX of the stock card (audited).",
    permission: "inventory.movement.export",
    query: z.object({ lotId: z.uuid(), from: DATE, to: DATE, locationId: z.uuid().optional(), format: z.enum(["csv", "xlsx"]).default("csv") }).strict(),
    response: "file",
  },
  jobs: {
    kind: "query",
    name: "platform.job.list",
    method: "GET",
    path: "/api/v1/platform/jobs",
    summary: "Background jobs visible to the caller (payload summaries never contain secrets).",
    permission: "platform.job.view",
    query: z.object({ status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]).optional() }).strict(),
    response: "json",
  },
  notifications: {
    kind: "query",
    name: "platform.notification.list",
    method: "GET",
    path: "/api/v1/platform/notifications",
    summary: "Your own notifications (open by default).",
    permission: null,
    query: z.object({ show: z.enum(["open", "all"]).optional() }).strict(),
    response: "json",
  },
} as const satisfies Record<string, QueryContract>;

export type Commands = typeof commands;
export type Queries = typeof queries;

/** Machine-readable contract (OpenAPI-style summary) written to docs/api/v1-contract.json. */
export function contractDocument() {
  const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "input", unrepresentable: "any" });
  return {
    api: `/api/${API_VERSION}`,
    conventions: {
      envelope: schema(commandEnvelope(z.object({}).passthrough())),
      idempotencyHeader: "Idempotency-Key (UUID); required on every command marked idempotent; a repeat returns the stored response; same key with a different body or user → 422 IDEMPOTENCY_KEY_REUSED",
      correlationHeader: "X-Request-Id (accepted or generated, echoed)",
      success: "{ ok: true, data }",
      error: "{ ok: false, error: { code, message, details } }",
      versioning: "breaking changes create /api/v2 routes",
    },
    commands: Object.values(commands).map((c) => ({
      name: c.name,
      method: c.method,
      path: c.path,
      summary: c.summary,
      permission: c.permission,
      idempotent: c.idempotent,
      offline: c.offline,
      payload: schema(c.payload),
    })),
    queries: Object.values(queries).map((q) => ({
      name: q.name,
      method: q.method,
      path: q.path,
      summary: q.summary,
      permission: q.permission,
      response: q.response,
      query: schema(q.query),
    })),
  };
}
