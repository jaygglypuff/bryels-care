/** Typed domain errors mapped to HTTP codes and form messages (architecture §5). */
export type ErrorCode =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "state"
  | "separation_of_duties"
  | "insufficient_stock"
  | "blocked_lot"
  | "out_of_tolerance"
  | "setup_required";

export class DomainError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  validation: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  state: 409,
  separation_of_duties: 409,
  insufficient_stock: 409,
  blocked_lot: 409,
  out_of_tolerance: 422,
  setup_required: 503,
};

export type ActionState = { ok: boolean; message?: string; fieldErrors?: Record<string, string> } | null;

/** Converts thrown errors into a form-friendly state for server actions. */
export function toActionState(e: unknown): ActionState {
  if (e instanceof DomainError) {
    // Validation errors may name the field (details.field) or carry every issue (details.issues).
    const fieldErrors: Record<string, string> = {};
    const issues = Array.isArray(e.details?.issues) ? (e.details.issues as { path: string; message: string }[]) : [];
    for (const i of issues) fieldErrors[i.path || "form"] ??= i.message;
    if (typeof e.details?.field === "string") fieldErrors[e.details.field] ??= e.message;
    return { ok: false, message: issues.length > 1 ? "Check the highlighted fields." : e.message, ...(Object.keys(fieldErrors).length ? { fieldErrors } : {}) };
  }
  if (e && typeof e === "object" && "issues" in e) {
    const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues;
    const fieldErrors: Record<string, string> = {};
    for (const i of issues) fieldErrors[String(i.path[0] ?? "form")] = i.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  console.error(e);
  return { ok: false, message: "Something went wrong. The change was not saved." };
}
