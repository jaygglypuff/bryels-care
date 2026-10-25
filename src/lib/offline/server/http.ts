import "server-only";
import { uuidv7 } from "uuidv7";
import { type ApiResult, errorResult, fromError } from "@/lib/api/server";
import { type AuthContext, getContext } from "@/lib/auth/context";
import { acceptableRequestId, logger, withLogContext } from "@/lib/log";
import { reportError } from "@/lib/log/error-reporter";
import { limitApi } from "@/lib/rate-limit";
import { DEVICE_KEY_HEADER } from "../protocol";

/**
 * Route plumbing for `/api/v1/sync/*` (same rules as the command pipeline in src/lib/api/server.ts):
 * same-origin check on writes, request id, per-user rate limit, JSON envelope `{ ok, data | error }`,
 * `Cache-Control: no-store` so neither the browser nor the service worker ever caches a response.
 */
function originAllowed(req: Request) {
  const expected = process.env.APP_ORIGIN;
  if (!expected) return true;
  return req.headers.get("origin") === expected.replace(/\/$/, "");
}

function json(result: ApiResult, requestId: string) {
  return Response.json(result.body, { status: result.status, headers: { "X-Request-Id": requestId, "Cache-Control": "no-store", ...(result.headers ?? {}) } });
}

export type SyncRequest = { ctx: AuthContext | null; body: unknown; deviceKey: string | null; requestId: string; url: URL };

export function syncRoute(name: string, method: "GET" | "POST", handler: (r: SyncRequest) => Promise<ApiResult>) {
  return async function route(req: Request): Promise<Response> {
    const requestId = acceptableRequestId(req.headers.get("x-request-id")) ?? uuidv7();
    if (method === "POST" && !originAllowed(req)) return json(errorResult(403, "ORIGIN_REJECTED", "Request origin not allowed."), requestId);
    let body: unknown = null;
    if (method === "POST") {
      try {
        body = await req.json();
      } catch {
        return json(errorResult(422, "VALIDATION", "The request body must be JSON."), requestId);
      }
    }
    return withLogContext({ requestId, module: "platform", command: name }, async () => {
      const started = Date.now();
      const ctx = await getContext();
      let result: ApiResult;
      if (ctx) {
        const r = await limitApi(ctx.organizationId, ctx.userId);
        if (!r.allowed) {
          result = { ...errorResult(429, "RATE_LIMITED", "Too many requests. Wait a moment, then try again."), headers: { "Retry-After": String(r.retryAfterSeconds) } };
          return json(result, requestId);
        }
      }
      try {
        result = await handler({ ctx, body, deviceKey: req.headers.get(DEVICE_KEY_HEADER), requestId, url: new URL(req.url) });
      } catch (e) {
        const mapped = fromError(e);
        if (!mapped) {
          await reportError(e, { requestId, command: name, routeType: "route" });
          result = errorResult(500, "INTERNAL", "Something went wrong. Your queued changes stay on the device; try again.");
        } else result = mapped;
      }
      const fields = { module: "platform", command: name, userId: ctx?.userId ?? null, durationMs: Date.now() - started, httpStatus: result.status };
      if (result.status >= 500) logger.warn("api sync", fields);
      else logger.info("api sync", fields);
      return json(result, requestId);
    });
  };
}

export const unauthenticated = () => errorResult(401, "UNAUTHENTICATED", "Sign in again to sync. Your queued changes stay on the device.");
