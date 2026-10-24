/**
 * Server start (Next.js `register`): wires the cross-module hooks once per process (src/modules/wiring.ts:
 * execution → QA deviations, in-process and finished-product inspections). Node runtime only.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Railway defaults (APP_ORIGIN from the public domain, client-IP header, demo-only secrets; ADR-044)
    // before the first request. scripts/self-check.ts already printed the same notes at start.
    const { applyRuntimeDefaults } = await import("@/lib/runtime-env");
    applyRuntimeDefaults(process.env);
    const { registerAppHooks } = await import("@/modules/wiring");
    registerAppHooks();
  }
}

/**
 * Next.js instrumentation hook (US-1-25 AC2): every uncaught server error (render, route handler,
 * server action) goes to the error-reporting adapter with the route pattern and kind only; the
 * request headers, cookies, body and query string are never forwarded.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  // The guard wraps the import so the edge bundle never includes the Node-only adapter.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportError } = await import("@/lib/log/error-reporter");
    const rid = request.headers["x-request-id"];
    await reportError(err, {
      requestId: typeof rid === "string" && /^[A-Za-z0-9._-]{8,100}$/.test(rid) ? rid : null,
      route: context.routePath,
      routeType: context.routeType,
      extra: { method: request.method },
    });
  }
}
