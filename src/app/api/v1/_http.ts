import "server-only";
import { DomainError, HTTP_STATUS } from "@/lib/errors";

/** JSON error envelope for /api/v1 route handlers (architecture §6); never leaks stack traces. */
export function errorResponse(e: unknown): Response {
  if (e instanceof DomainError) {
    const field = typeof e.details?.field === "string" ? e.details.field : undefined;
    return Response.json({ ok: false, code: e.code, message: e.message, ...(field ? { field } : {}) }, { status: HTTP_STATUS[e.code] });
  }
  console.error(e);
  return Response.json({ ok: false, code: "internal", message: "Something went wrong. Nothing was saved." }, { status: 500 });
}

/** CSRF defence for mutating requests (docs/security.md §4.2): the Origin must match APP_ORIGIN when set. */
export function assertSameOrigin(req: Request) {
  const allowed = process.env.APP_ORIGIN;
  const origin = req.headers.get("origin");
  if (allowed && origin !== allowed) throw new DomainError("forbidden", "Request origin not allowed.");
  if (!allowed && origin && new URL(origin).host !== req.headers.get("host")) throw new DomainError("forbidden", "Request origin not allowed.");
}

export function csvResponse(csv: string, fileName: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
