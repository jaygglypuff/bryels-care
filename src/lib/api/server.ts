import "server-only";
import { uuidv7 } from "uuidv7";
import { ZodError, type z } from "zod";
import { AuthContext, getContext } from "@/lib/auth/context";
import { DomainError, HTTP_STATUS, type ErrorCode } from "@/lib/errors";
import { completeIdempotencyKey, releaseIdempotencyKey, requestHash, reserveIdempotencyKey } from "@/lib/idempotency";
import { acceptableRequestId, logger, withLogContext } from "@/lib/log";
import { reportError } from "@/lib/log/error-reporter";
import { READ_ONLY_MESSAGE } from "@/lib/maintenance";
import { limitApi } from "@/lib/rate-limit";
import { type CommandContract, type QueryContract, commandEnvelope } from "./contract";

/**
 * Server side of the `/api/v1` contract: one pipeline for every command (architecture §5):
 * authenticate → parse envelope → idempotency key → authorize (permission + site in the envelope)
 * → reserve key → run the module service → store and return the response envelope.
 * Route handlers stay thin: `export const POST = commandRoute(commands.x, (ctx, payload, meta) => service(ctx, ...))`.
 */
export type ApiError = { code: string; message: string; details?: Record<string, unknown> };
export type ApiResponseBody<T = unknown> = { ok: true; data: T } | { ok: false; error: ApiError };
export type ApiResult = { status: number; body: ApiResponseBody; headers?: Record<string, string> };

export type CommandMeta = {
  idempotencyKey: string;
  commandId: string;
  deviceId: string | null;
  clientCreatedAt: string | null;
  requestId: string;
};

/** Public error codes (docs/permissions-matrix.md §8 naming). */
const API_CODE: Partial<Record<ErrorCode, string>> = {
  forbidden: "PERMISSION_DENIED",
  insufficient_stock: "STOCK_INSUFFICIENT",
  separation_of_duties: "SEPARATION_OF_DUTIES",
  blocked_lot: "STOCK_NOT_ELIGIBLE",
  state: "INVALID_STATE",
  unauthenticated: "UNAUTHENTICATED",
  reauth_required: "REAUTH_REQUIRED",
  too_large: "EXPORT_TOO_LARGE",
  read_only: "READ_ONLY_MODE",
  rate_limited: "RATE_LIMITED",
};

export function errorResult(status: number, code: string, message: string, details?: Record<string, unknown>): ApiResult {
  return { status, body: { ok: false, error: { code, message, ...(details ? { details } : {}) } } };
}

export function fromError(e: unknown): ApiResult | null {
  if (e instanceof DomainError) return errorResult(HTTP_STATUS[e.code], API_CODE[e.code] ?? e.code.toUpperCase(), e.message, e.details);
  if (e instanceof ZodError) {
    return errorResult(422, "VALIDATION", "Check the highlighted fields.", {
      fields: Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "body", i.message])),
    });
  }
  return null;
}

/** The context narrowed to the envelope's site (never inferred from a cookie: architecture §6). */
function scoped(ctx: AuthContext, siteId: string, requestId: string) {
  ctx.requireSite(siteId);
  return new AuthContext(ctx.userId, ctx.organizationId, ctx.displayName, ctx.email, ctx.roleCodes, ctx.permissions, ctx.allowedSites, siteId, {
    ...ctx.options,
    correlationId: requestId,
  });
}

/**
 * Runs one command. `ctx` null → 401. Exposed for tests (which call it with a constructed
 * context); routes use `commandRoute`.
 */
export async function executeCommand<P extends z.ZodType>(
  contract: CommandContract<P>,
  ctx: AuthContext | null,
  req: { body: unknown; idempotencyKey: string | null; requestId?: string },
  handler: (ctx: AuthContext, payload: z.output<P>, meta: CommandMeta) => Promise<unknown>,
): Promise<ApiResult> {
  const requestId = req.requestId ?? uuidv7();
  if (!ctx) return errorResult(401, "UNAUTHENTICATED", "Sign in again to continue.");
  // US-2-30: refused before the idempotency key is reserved, so a retry after the window succeeds.
  if (ctx.readOnly) return errorResult(503, "READ_ONLY_MODE", READ_ONLY_MESSAGE);
  const key = req.idempotencyKey?.trim() || null;
  if (contract.idempotent && !key) return errorResult(422, "IDEMPOTENCY_KEY_REQUIRED", "This command needs an Idempotency-Key header (a UUID).");
  if (key && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return errorResult(422, "IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must be a UUID.");
  const parsed = commandEnvelope(contract.payload).safeParse(req.body);
  if (!parsed.success) return fromError(parsed.error)!;
  const env = parsed.data as { commandId: string; siteId: string; deviceId?: string; clientCreatedAt?: string; payload: z.output<P> };

  let sctx: AuthContext;
  try {
    if (contract.permission) ctx.require(contract.permission);
    sctx = scoped(ctx, env.siteId, requestId);
  } catch (e) {
    return fromError(e)!;
  }

  let reservationId: string | null = null;
  if (key) {
    const r = await reserveIdempotencyKey({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      key,
      command: contract.name,
      hash: requestHash({ command: contract.name, siteId: env.siteId, payload: env.payload }),
      clientCommandId: env.commandId,
      deviceId: env.deviceId ?? null,
      clientCreatedAt: env.clientCreatedAt ? new Date(env.clientCreatedAt) : null,
    });
    if (r.kind === "replay") return { status: r.response.status, body: r.response.body as ApiResponseBody, headers: { "Idempotent-Replayed": "true" } };
    if (r.kind === "reused") return errorResult(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different request.");
    if (r.kind === "in_progress") return errorResult(409, "IDEMPOTENCY_IN_PROGRESS", "The same request is still being processed; retry shortly with the same key.");
    reservationId = r.id;
  }

  const meta: CommandMeta = { idempotencyKey: key ?? uuidv7(), commandId: env.commandId, deviceId: env.deviceId ?? null, clientCreatedAt: env.clientCreatedAt ?? null, requestId };
  let result: ApiResult;
  try {
    const data = await handler(sctx, env.payload, meta);
    result = { status: 200, body: { ok: true, data: data ?? null } };
  } catch (e) {
    const mapped = fromError(e);
    if (!mapped) {
      if (reservationId) await releaseIdempotencyKey(reservationId);
      await reportError(e, { requestId, command: contract.name, routeType: "command" });
      return errorResult(500, "INTERNAL", "Something went wrong. Nothing was saved; try again with the same Idempotency-Key.");
    }
    result = mapped;
  }
  if (reservationId) await completeIdempotencyKey(reservationId, { status: result.status, body: result.body });
  return result;
}

function json(result: ApiResult, requestId: string) {
  return Response.json(result.body, { status: result.status, headers: { "X-Request-Id": requestId, "Cache-Control": "no-store", ...(result.headers ?? {}) } });
}

/** Mutating requests must come from the app's own origin when APP_ORIGIN is configured (CSRF, ADR-004). */
function originAllowed(req: Request) {
  const expected = process.env.APP_ORIGIN;
  if (!expected) return true;
  const origin = req.headers.get("origin");
  return origin === expected.replace(/\/$/, "");
}

const requestIdOf = (req: Request) => acceptableRequestId(req.headers.get("x-request-id")) ?? uuidv7();

/** US-1-25 AC3: authenticated API limit per user (setting `platform.rate_limits`); null = allowed. */
async function rateLimited(ctx: AuthContext | null): Promise<ApiResult | null> {
  if (!ctx) return null;
  const r = await limitApi(ctx.organizationId, ctx.userId);
  if (r.allowed) return null;
  return { ...errorResult(429, "RATE_LIMITED", "Too many requests. Wait a moment, then try again."), headers: { "Retry-After": String(r.retryAfterSeconds) } };
}

/** One structured line per API call (docs/deployment-railway.md §7 fields). */
function logCall(kind: "command" | "query", name: string, ctx: AuthContext | null, started: number, status: number) {
  const fields = { module: name.split(".")[0], command: name, userId: ctx?.userId ?? null, siteId: ctx?.currentSiteId ?? null, durationMs: Date.now() - started, httpStatus: status, outcome: status < 400 ? "ok" : status >= 500 ? "error" : "rejected" };
  if (status >= 500) logger.warn(`api ${kind}`, fields);
  else logger.info(`api ${kind}`, fields);
}

export function commandRoute<P extends z.ZodType>(contract: CommandContract<P>, handler: (ctx: AuthContext, payload: z.output<P>, meta: CommandMeta) => Promise<unknown>) {
  return async function POST(req: Request): Promise<Response> {
    const requestId = requestIdOf(req);
    if (!originAllowed(req)) return json(errorResult(403, "ORIGIN_REJECTED", "Request origin not allowed."), requestId);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(errorResult(422, "VALIDATION", "The request body must be JSON."), requestId);
    }
    return withLogContext({ requestId, module: contract.name.split(".")[0], command: contract.name }, async () => {
      const started = Date.now();
      const ctx = await getContext();
      const result = (await rateLimited(ctx)) ?? (await executeCommand(contract, ctx, { body, idempotencyKey: req.headers.get("idempotency-key"), requestId }, handler));
      logCall("command", contract.name, ctx, started, result.status);
      return json(result, requestId);
    });
  };
}

type RouteParams = { params: Promise<Record<string, string | string[] | undefined>> };

/** Runs a query with the caller's context; the handler returns data (JSON envelope) or a Response (file download). */
export async function executeQuery<Q extends z.ZodType>(
  contract: QueryContract<Q>,
  ctx: AuthContext | null,
  input: Record<string, unknown>,
  handler: (ctx: AuthContext, query: z.output<Q>) => Promise<unknown>,
): Promise<ApiResult | Response> {
  if (!ctx) return errorResult(401, "UNAUTHENTICATED", "Sign in again to continue.");
  try {
    if (contract.permission) ctx.require(contract.permission);
    const q = contract.query.parse(input);
    const out = await handler(ctx, q);
    if (out instanceof Response) return out;
    return { status: 200, body: { ok: true, data: out ?? null } };
  } catch (e) {
    const mapped = fromError(e);
    if (mapped) return mapped;
    await reportError(e, { command: contract.name, routeType: "query" });
    return errorResult(500, "INTERNAL", "Something went wrong.");
  }
}

export function queryRoute<Q extends z.ZodType>(contract: QueryContract<Q>, handler: (ctx: AuthContext, query: z.output<Q>) => Promise<unknown>) {
  return async function GET(req: Request, route: RouteParams): Promise<Response> {
    const requestId = requestIdOf(req);
    const url = new URL(req.url);
    const input: Record<string, unknown> = Object.fromEntries(url.searchParams.entries());
    const params = (await route?.params) ?? {};
    for (const [k, v] of Object.entries(params)) if (v !== undefined) input[k] = Array.isArray(v) ? v.join("/") : v;
    return withLogContext({ requestId, module: contract.name.split(".")[0], command: contract.name }, async () => {
      const started = Date.now();
      const ctx = await getContext();
      const limited = await rateLimited(ctx);
      const out = limited ?? (await executeQuery(contract, ctx, input, handler));
      if (out instanceof Response) {
        out.headers.set("X-Request-Id", requestId);
        logCall("query", contract.name, ctx, started, out.status);
        return out;
      }
      logCall("query", contract.name, ctx, started, out.status);
      return json(out, requestId);
    });
  };
}
