import "server-only";
import { z } from "zod";
import { DomainError } from "@/lib/errors";

/**
 * Shared helpers for master data administration (W2G, US-1-20..US-1-24): scan-safe code schema,
 * optional-field coercion for form input, before/after diffs for audit, and the generic "is this
 * row referenced anywhere?" check that makes codes immutable after use.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(id: string, what: string): void {
  if (!UUID_RE.test(id)) throw new DomainError("not_found", `${what} not found.`);
}

/** Scan grammar (src/lib/scan): BC:<TYPE>:<code>; the code part is this pattern. */
export const SCAN_CODE_RE = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
export const scanCode = (label: string, example: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(SCAN_CODE_RE, `${label}: use capital letters, digits, dot, dash or underscore (max 64), e.g. ${example}.`);

/**
 * A code the user may leave blank on create (ADR-075): blank becomes null and the service assigns
 * the next number (MAT-0001...). A typed code still has to match `schema`.
 */
export const optionalCode = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v), schema.nullable()) as unknown as z.ZodType<z.output<T> | null, z.input<T> | null | undefined>;

export const reqText =(label: string, max: number) => z.string().trim().min(1, `Enter ${label}.`).max(max, `Use at most ${max} characters.`);
export const optText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v ?? "").trim())
    .refine((v) => v.length <= max, `Use at most ${max} characters.`)
    .transform((v) => (v ? v : null));
/** Whole number from a form ("" = null). */
export const optInt = (label: string, min: number, max: number) =>
  z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v, c) => {
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        c.addIssue({ code: "custom", message: `${label} must be a whole number from ${min} to ${max}.` });
        return z.NEVER;
      }
      return n;
    });
export const optUuid = z
  .union([z.string().uuid("Choose a valid option."), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));
/** Checkbox / boolean from a form or JSON. */
export const bool = (dflt: boolean) =>
  z
    .union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false"), z.literal(""), z.null(), z.undefined()])
    .transform((v) => (v === undefined || v === null ? dflt : v === true || v === "on" || v === "true"));

/** Fields that changed between two rows, as { before, after } for the audit trail. */
export function diff<T extends Record<string, unknown>>(before: T, after: T, keys: readonly (keyof T)[]) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of keys) {
    const x = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const y = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
    if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) {
      b[k as string] = x ?? null;
      a[k as string] = y ?? null;
    }
  }
  return { before: b, after: a, changed: Object.keys(a) };
}

/** "Is this row referenced anywhere?" (moved to src/lib/references.ts for ADR-075 draft deletes). */
export { isReferenced } from "@/lib/references";

/** Maps a unique-violation from Postgres to a 409 naming the field. */
export function uniqueConflict(e: unknown, message: string, field = "code"): never {
  const code = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  if (code === "23505") throw new DomainError("conflict", message, { field });
  throw e;
}

/** Explicit state machine helper: throws a 409 `state` error when the move is not in the table. */
export function assertTransition<S extends string>(table: Record<S, readonly S[]>, from: S, to: S, what: string): void {
  if (!(table[from] ?? []).includes(to)) throw new DomainError("state", `${what} cannot go from ${from.replace(/_/g, " ")} to ${to.replace(/_/g, " ")}.`, { field: "status" });
}
