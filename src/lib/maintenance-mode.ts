/**
 * Full maintenance switch for restores (ADR-115 §4, docs/operations-runbook.md §13 "Before any restore",
 * docs/deployment-railway.md §4). `MAINTENANCE_MODE=1` on the web service makes every request answer
 * 503 with a plain page, except the health checks, which keep answering and report `maintenance: true`.
 * Distinct from the read-only mode (`platform.maintenance.read_only`, src/lib/maintenance.ts), which
 * keeps the app open for reading.
 *
 * Edge-safe: no imports, no I/O (runs in src/middleware.ts). The caller passes
 * `process.env.MAINTENANCE_MODE` written out literally, so Next.js includes the variable in the
 * middleware's runtime environment.
 */

/** Paths that keep answering while the switch is on (monitors and the deploy health check). */
const MAINTENANCE_EXEMPT_PATHS: readonly string[] = ["/api/health", "/api/ready"];

/** Seconds a client is asked to wait before trying again. */
const MAINTENANCE_RETRY_AFTER_SECONDS = 300;

export const MAINTENANCE_MESSAGE = "We are restoring the system. Please try again in a few minutes.";

/** True only for the exact value "1" (anything else, including "true" or "0", leaves the app open). */
export function maintenanceModeOn(flag: string | undefined | null): boolean {
  return flag === "1";
}

/** Whether a request to `pathname` gets the 503 maintenance page. Trailing slashes are ignored for the exemptions. */
export function maintenanceBlocks(pathname: string, flag: string | undefined | null): boolean {
  if (!maintenanceModeOn(flag)) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return !MAINTENANCE_EXEMPT_PATHS.includes(path);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Bryel's Care: maintenance</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f7f5f0;color:#1c1b18}main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.4rem;margin:0 0 .75rem}p{font-size:1.05rem;line-height:1.5;margin:0}</style>
</head>
<body>
<main>
<h1>Bryel's Care is under maintenance</h1>
<p>${MAINTENANCE_MESSAGE}</p>
</main>
</body>
</html>
`;

/** The plain 503 page (no app code, no scripts, never cached). */
export function maintenanceResponse(): Response {
  return new Response(PAGE, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(MAINTENANCE_RETRY_AFTER_SECONDS),
      "Cache-Control": "no-store",
    },
  });
}
