/**
 * Browser calls to `/api/v1/sync/*`. Connectivity is judged by request success, not only
 * `navigator.onLine` (docs/offline-sync.md §2): a timeout (30 s), a network error, 5xx, 408 or 429
 * is transient; 401 keeps the queue and asks the person to sign in; other 4xx refuse the batch.
 */
import { TRANSPORT_TIMEOUT_MS, isTransientStatus } from "./policy";
import { DEVICE_KEY_HEADER, type AuthSnapshot, type ReferencePayload, type SyncCommandWire, type SyncItemResult } from "./protocol";
import type { Transport, TransportResult } from "./outbox";

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function call<T>(url: string, init: RequestInit & { deviceKey?: string | null; timeoutMs?: number }): Promise<{ status: number; body: Envelope<T> | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? TRANSPORT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(init.deviceKey ? { [DEVICE_KEY_HEADER]: init.deviceKey } : {}), ...(init.headers ?? {}) },
    });
    const body = (await res.json().catch(() => null)) as Envelope<T> | null;
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export class TransportError extends Error {
  constructor(
    public kind: "network" | "unauthenticated" | "refused",
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function get<T>(url: string, deviceKey: string | null): Promise<T> {
  let r: Awaited<ReturnType<typeof call<T>>>;
  try {
    r = await call<T>(url, { method: "GET", deviceKey });
  } catch (e) {
    throw new TransportError("network", e instanceof Error && e.name === "AbortError" ? "The request timed out." : "No connection to the server.");
  }
  if (r.status === 401) throw new TransportError("unauthenticated", "Sign in again to continue.", 401);
  if (!r.body || !r.body.ok) {
    const msg = r.body && !r.body.ok ? r.body.error.message : `HTTP ${r.status}`;
    throw new TransportError(isTransientStatus(r.status) ? "network" : "refused", msg, r.status);
  }
  return r.body.data;
}

async function post<T>(url: string, body: unknown, deviceKey: string | null): Promise<T> {
  let r: Awaited<ReturnType<typeof call<T>>>;
  try {
    r = await call<T>(url, { method: "POST", body: JSON.stringify(body), deviceKey });
  } catch {
    throw new TransportError("network", "No connection to the server.");
  }
  if (r.status === 401) throw new TransportError("unauthenticated", "Sign in again to continue.", 401);
  if (!r.body || !r.body.ok) throw new TransportError(isTransientStatus(r.status) ? "network" : "refused", r.body && !r.body.ok ? r.body.error.message : `HTTP ${r.status}`, r.status);
  return r.body.data;
}

export const fetchSnapshot = (deviceKey: string | null) => get<AuthSnapshot>("/api/v1/sync/snapshot", deviceKey);
export const fetchReference = (siteId: string, deviceKey: string | null) => get<ReferencePayload>(`/api/v1/sync/reference?siteId=${encodeURIComponent(siteId)}`, deviceKey);
export const requestRegistration = (body: { deviceKey: string; label: string; platform: string; browser: string | null; deviceClass: string; siteId: string }) =>
  post<{ deviceId: string; status: string }>("/api/v1/sync/device", body, body.deviceKey);
export const postDiscards = (body: { reason: "signed_out" | "removed_from_queue" | "device_reset"; commands: { id: string; type: string; siteId: string; clientCreatedAt: string; summary?: string; status?: string }[] }, deviceKey: string | null) =>
  post<{ discarded: number }>("/api/v1/sync/discards", body, deviceKey);

type ReplayData = { results: SyncItemResult[]; snapshot: AuthSnapshot; permissionsChanged: boolean };

/** The outbox transport: one POST per batch, mapped to the outbox's result kinds. */
export function httpTransport(deviceKey: () => string | null): Transport {
  return async (commands: SyncCommandWire[]): Promise<TransportResult> => {
    let r: { status: number; body: Envelope<ReplayData> | null };
    try {
      r = await call<ReplayData>("/api/v1/sync/commands", { method: "POST", body: JSON.stringify({ deviceSentAt: new Date().toISOString(), commands }), deviceKey: deviceKey() });
    } catch (e) {
      return { kind: "transient", message: e instanceof Error && e.name === "AbortError" ? "the request timed out" : "no connection" };
    }
    if (r.status === 401) return { kind: "unauthenticated" };
    if (isTransientStatus(r.status) || !r.body) return { kind: "transient", message: `HTTP ${r.status}` };
    if (!r.body.ok) return { kind: "refused", status: r.status, message: r.body.error.message };
    const data = r.body.data;
    return { kind: "ok", results: data.results, snapshot: data.snapshot, permissionsChanged: data.permissionsChanged };
  };
}
