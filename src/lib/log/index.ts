/**
 * Structured logging (US-1-25, docs/deployment-railway.md §7). JSON lines on stdout with the
 * request context (requestId, userId, siteId, module, command) taken from an AsyncLocalStorage
 * scope, plus service, release, appEnv and the RAILWAY_* fields on every line.
 *
 * Dependency-free on purpose (pino-compatible field names: `time`, `level`, `msg`): adding a
 * logging package is a lockfile change for the integrator to approve (A-W2F-05). Redaction runs on
 * every field before a line is written (see `redact`).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type LogContext = {
  requestId?: string | null;
  correlationId?: string | null;
  userId?: string | null;
  siteId?: string | null;
  module?: string | null;
  command?: string | null;
  jobId?: string | null;
  jobKind?: string | null;
};

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const store = new AsyncLocalStorage<LogContext>();

/** Runs `fn` with a log context; nested scopes inherit and extend the outer one. */
export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  return store.run({ ...(store.getStore() ?? {}), ...ctx }, fn);
}

export function currentLogContext(): LogContext {
  return store.getStore() ?? {};
}

/** Fields present on every line (docs/deployment-railway.md §7). Read at call time so tests can change env. */
export function baseFields(): LogFields {
  const env = process.env;
  return {
    service: env.RAILWAY_SERVICE_NAME ?? env.SERVICE_NAME ?? "web",
    release: env.RELEASE ?? env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev",
    appEnv: env.APP_ENV ?? env.NODE_ENV ?? "development",
    ...(env.RAILWAY_REPLICA_ID ? { replica: env.RAILWAY_REPLICA_ID } : {}),
    ...(env.RAILWAY_ENVIRONMENT ? { railwayEnvironment: env.RAILWAY_ENVIRONMENT } : {}),
  };
}

/* ------------------------------------------------------------------ redaction */

/** Keys whose values never reach a log line (docs/deployment-railway.md §7, docs/security.md §3.8). */
const SECRET_KEY = /(password|passwd|passphrase|secret|token|authorization|cookie|api[-_]?key|access[-_]?key|private[-_]?key|dsn|credential|otp|totp|recovery[-_]?code|session)/i;
/** base64url runs of 20+ characters inside URLs or messages (tokens in query strings, signed links). */
const LONG_TOKEN = /([?&][A-Za-z0-9_.-]*=)[A-Za-z0-9_-]{20,}/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const CONN_STRING = /\b(postgres(ql)?|mysql|redis|amqp|https?):\/\/[^\s:@/]+:[^\s@/]+@/gi;

export const REDACTED = "[redacted]";

function redactString(s: string): string {
  return s.replace(CONN_STRING, (m, proto: string) => `${proto}://${REDACTED}@`).replace(BEARER, (_m, kind: string) => `${kind} ${REDACTED}`).replace(LONG_TOKEN, `$1${REDACTED}`);
}

/** Deep-copies `value` with secret-like keys masked and token-like substrings removed. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;
  if (depth > 6) return "[truncated]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

/* ------------------------------------------------------------------ writer */

type Sink = (line: string, level: LogLevel) => void;
let sink: Sink = (line, level) => {
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};

/** Tests capture lines with this; returns a restore function. */
export function setLogSink(next: Sink): () => void {
  const prev = sink;
  sink = next;
  return () => {
    sink = prev;
  };
}

function threshold(): number {
  const l = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "warn" : "info")).toLowerCase() as LogLevel;
  return LEVELS[l] ?? LEVELS.info;
}

function format(): "json" | "pretty" {
  return process.env.LOG_FORMAT === "pretty" ? "pretty" : "json";
}

/** Builds the full record for one line (exported for the field unit tests). */
export function buildRecord(level: LogLevel, msg: string, fields: LogFields = {}, bound: LogFields = {}): Record<string, unknown> {
  const ctx = currentLogContext();
  const contextFields = Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== undefined && v !== null));
  return redact({ time: new Date().toISOString(), level, msg: msg, ...baseFields(), ...contextFields, ...bound, ...fields }) as Record<string, unknown>;
}

function write(level: LogLevel, msg: string, fields: LogFields, bound: LogFields) {
  if (LEVELS[level] < threshold()) return;
  const rec = buildRecord(level, msg, fields, bound);
  if (format() === "pretty") {
    const { time, level: lv, msg: m, ...rest } = rec;
    sink(`${String(time).slice(11, 23)} ${String(lv).toUpperCase().padEnd(5)} ${m} ${JSON.stringify(rest)}`, level);
  } else {
    sink(JSON.stringify(rec), level);
  }
}

export type Logger = {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
};

function makeLogger(bound: LogFields): Logger {
  return {
    debug: (m, f = {}) => write("debug", m, f, bound),
    info: (m, f = {}) => write("info", m, f, bound),
    warn: (m, f = {}) => write("warn", m, f, bound),
    error: (m, f = {}) => write("error", m, f, bound),
    child: (f) => makeLogger({ ...bound, ...f }),
  };
}

export const logger: Logger = makeLogger({});

/** A request id accepted from a client header: UUID-like or a short safe token; otherwise null. */
export function acceptableRequestId(v: string | null | undefined): string | null {
  return v && /^[A-Za-z0-9._-]{8,100}$/.test(v) ? v : null;
}
