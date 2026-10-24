/**
 * Error-reporting adapter (US-1-25 AC2, docs/deployment-railway.md §8.1, A-DEP-12).
 *
 * `ERROR_REPORTING_DSN`:
 * - unset → reporting is disabled; one info line says so, the error is still logged (never a failure);
 * - `console` → the event is written as one structured `error_report` log line (development);
 * - a Sentry-compatible DSN `https://<public key>@<host>/<project id>` → the event is POSTed to the
 *   provider's envelope endpoint with a 2 s timeout; a delivery failure is logged, never thrown.
 *
 * Events carry release, environment, service, requestId, module, command and jobKind, and never
 * cookies, headers, request bodies or query strings. Expected failures (DomainError, ZodError: the
 * `err(...)` results of the services) are never reported.
 */
import { baseFields, currentLogContext, logger, redact } from "./index";

export type ErrorReportContext = {
  requestId?: string | null;
  module?: string | null;
  command?: string | null;
  jobKind?: string | null;
  jobId?: string | null;
  /** e.g. "action", "route", "render", "job" */
  routeType?: string | null;
  /** Route pattern without query string, e.g. /api/v1/inventory/movements. */
  route?: string | null;
  extra?: Record<string, unknown>;
};

export type ErrorEvent = {
  event_id: string;
  timestamp: number;
  platform: "node";
  level: "error";
  release: string;
  environment: string;
  server_name: string;
  exception: { values: { type: string; value: string; stacktrace?: { frames: { filename?: string; function?: string; lineno?: number }[] } }[] };
  tags: Record<string, string>;
  extra: Record<string, unknown>;
};

type Transport = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

let transport: Transport = (url, init) => fetch(url, init);
let disabledNoticeLogged = false;

/** Tests replace the HTTP transport; returns a restore function. */
export function setErrorReportTransport(t: Transport): () => void {
  const prev = transport;
  transport = t;
  return () => {
    transport = prev;
  };
}

/** True for the typed, expected failures of the service layer (never reported). */
export function isExpectedError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: unknown }).name;
  return name === "DomainError" || name === "ZodError";
}

function frames(stack: string | undefined) {
  if (!stack) return undefined;
  const out: { filename?: string; function?: string; lineno?: number }[] = [];
  for (const line of stack.split("\n").slice(1, 30)) {
    const m = /at (?:(.+?) \()?(.+?):(\d+):\d+\)?$/.exec(line.trim());
    if (m) out.push({ function: m[1] ?? "<anonymous>", filename: m[2].replace(process.cwd(), ""), lineno: Number(m[3]) });
  }
  // Sentry expects the innermost frame last.
  return out.length ? { frames: out.reverse() } : undefined;
}

/** Builds the event (exported for the unit test that proves no request data is included). */
export function buildErrorEvent(err: unknown, ctx: ErrorReportContext = {}): ErrorEvent {
  const base = baseFields();
  const log = currentLogContext();
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Non-error value thrown");
  const tags: Record<string, string> = {};
  const tag = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") tags[k] = String(v).slice(0, 200);
  };
  tag("requestId", ctx.requestId ?? log.requestId);
  tag("module", ctx.module ?? log.module);
  tag("command", ctx.command ?? log.command);
  tag("jobKind", ctx.jobKind ?? log.jobKind);
  tag("jobId", ctx.jobId ?? log.jobId);
  tag("routeType", ctx.routeType);
  tag("route", ctx.route?.split("?")[0]);
  tag("service", base.service);
  return {
    event_id: globalThis.crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    release: String(base.release),
    environment: String(base.appEnv),
    server_name: String(base.service),
    exception: { values: [{ type: e.name || "Error", value: String(redact(e.message)).slice(0, 2000), stacktrace: frames(e.stack) }] },
    tags,
    extra: (redact(ctx.extra ?? {}) as Record<string, unknown>) ?? {},
  };
}

/** Parses a Sentry-style DSN into the envelope endpoint and auth header, or null when malformed. */
export function parseDsn(dsn: string): { url: string; auth: string } | null {
  try {
    const u = new URL(dsn);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const key = decodeURIComponent(u.username);
    const parts = u.pathname.split("/").filter(Boolean);
    const project = parts.pop();
    if (!key || !project) return null;
    const prefix = parts.length ? `/${parts.join("/")}` : "";
    return { url: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`, auth: `Sentry sentry_version=7, sentry_key=${key}, sentry_client=bryels-care/1.0` };
  } catch {
    return null;
  }
}

/**
 * Reports an unexpected error. Never throws and never slows a request by more than the 2 s
 * transport timeout. Returns what happened (for tests and the worker's own log line).
 */
export async function reportError(err: unknown, ctx: ErrorReportContext = {}): Promise<{ reported: boolean; reason?: string }> {
  if (isExpectedError(err)) return { reported: false, reason: "expected" };
  const e = err instanceof Error ? err : new Error(String(err));
  logger.error("unexpected error", { error: { name: e.name, message: e.message }, stack: e.stack?.split("\n").slice(0, 8).join("\n"), ...(ctx.module ? { module: ctx.module } : {}), ...(ctx.command ? { command: ctx.command } : {}), ...(ctx.route ? { route: ctx.route.split("?")[0] } : {}) });
  const dsn = process.env.ERROR_REPORTING_DSN?.trim();
  if (!dsn) {
    if (!disabledNoticeLogged) {
      disabledNoticeLogged = true;
      logger.info("error reporting disabled: ERROR_REPORTING_DSN is not set");
    }
    return { reported: false, reason: "disabled" };
  }
  const event = buildErrorEvent(err, ctx);
  if (dsn === "console") {
    logger.error("error_report", { event });
    return { reported: true };
  }
  const target = parseDsn(dsn);
  if (!target) {
    logger.warn("error reporting misconfigured: ERROR_REPORTING_DSN is not a valid DSN");
    return { reported: false, reason: "invalid_dsn" };
  }
  const body = [JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
  try {
    const res = await transport(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": target.auth },
      body,
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      logger.warn("error report rejected by the provider", { httpStatus: res.status });
      return { reported: false, reason: `http_${res.status}` };
    }
    return { reported: true };
  } catch (x) {
    logger.warn("error report could not be delivered", { error: x instanceof Error ? x.message : String(x) });
    return { reported: false, reason: "delivery_failed" };
  }
}

/** Fire-and-forget variant for synchronous call sites. */
export function reportErrorInBackground(err: unknown, ctx: ErrorReportContext = {}) {
  void reportError(err, ctx).catch(() => undefined);
}
