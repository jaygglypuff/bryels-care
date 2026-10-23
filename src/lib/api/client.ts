/**
 * Typed `/api/v1` client derived from the contract (no hand-written request types). Browser or
 * server. Every command gets a client UUIDv7 `commandId` and an `Idempotency-Key`; a caller that
 * retries (or the Phase 7 outbox that replays) passes the same key so the server returns the stored
 * response instead of posting again.
 */
import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import { type Commands, type Queries, commands, queries } from "./contract";

export type ApiError = { code: string; message: string; details?: Record<string, unknown> };
export type ApiResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: ApiError };

export type CommandName = keyof Commands;
export type CommandPayload<N extends CommandName> = z.input<Commands[N]["payload"]>;
export type QueryName = keyof Queries;
export type QueryInput<N extends QueryName> = z.input<Queries[N]["query"]>;

export type SendOptions = { siteId: string; idempotencyKey?: string; commandId?: string; deviceId?: string; clientCreatedAt?: string; baseUrl?: string; fetchImpl?: typeof fetch };

/** Builds the request a command sends (exposed so the offline outbox can store it verbatim). */
export function buildCommandRequest<N extends CommandName>(name: N, payload: CommandPayload<N>, o: SendOptions) {
  const c = commands[name];
  const idempotencyKey = o.idempotencyKey ?? crypto.randomUUID();
  const body = { commandId: o.commandId ?? uuidv7(), siteId: o.siteId, deviceId: o.deviceId, clientCreatedAt: o.clientCreatedAt ?? new Date().toISOString(), payload };
  return { url: `${o.baseUrl ?? ""}${c.path}`, method: c.method, idempotencyKey, body };
}

export async function sendCommand<N extends CommandName, T = unknown>(name: N, payload: CommandPayload<N>, o: SendOptions): Promise<ApiResponse<T> & { idempotencyKey: string }> {
  const r = buildCommandRequest(name, payload, o);
  const res = await (o.fetchImpl ?? fetch)(r.url, {
    method: r.method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": r.idempotencyKey },
    body: JSON.stringify(r.body),
    credentials: "same-origin",
  });
  const json = (await res.json().catch(() => ({ ok: false, error: { code: "BAD_RESPONSE", message: `HTTP ${res.status}` } }))) as ApiResponse<T>;
  return { ...json, idempotencyKey: r.idempotencyKey };
}

/** URL of a query (path parameters such as {lotId} are filled from the input). */
export function queryUrl<N extends QueryName>(name: N, input: QueryInput<N>, baseUrl = ""): string {
  const q = queries[name];
  const rest: Record<string, string> = {};
  let path: string = q.path;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === undefined || v === null || v === "") continue;
    if (path.includes(`{${k}}`)) path = path.replace(`{${k}}`, encodeURIComponent(String(v)));
    else rest[k] = String(v);
  }
  const qs = new URLSearchParams(rest).toString();
  return `${baseUrl}${path}${qs ? `?${qs}` : ""}`;
}

export async function runQuery<N extends QueryName, T = unknown>(name: N, input: QueryInput<N>, o: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): Promise<ApiResponse<T>> {
  const res = await (o.fetchImpl ?? fetch)(queryUrl(name, input, o.baseUrl), { credentials: "same-origin" });
  return (await res.json()) as ApiResponse<T>;
}
