import { eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { DomainError } from "@/lib/errors";
import { codeKey } from "./pick";

/**
 * Server-side match of a typed or scanned code against a record number column (owner decision 2026-11-08,
 * A-SCAN-TYPED-01): the exact number first (the label, index-friendly); when nothing has that exact number, the
 * same letters and digits ignoring case, dashes and spaces ("bx00000005" finds BX-00000005). Two records that
 * only differ by dashes are ambiguous and match nothing (the caller says "not found"). Last-digit typing is
 * resolved on the screen against the expected candidates, never here.
 *
 * `run(where)` runs the caller's own scoped query (organization, site, status …) with the code condition added,
 * and should `limit(2)` so an ambiguous loose match can be seen.
 */
export async function findByCode<T>(col: AnyColumn, value: string, run: (where: SQL) => Promise<T[]>): Promise<T[]> {
  const v = String(value ?? "").trim();
  if (!v) return [];
  const exact = await run(eq(col, v));
  if (exact.length) return exact.slice(0, 1);
  const k = codeKey(v);
  if (!k) return [];
  const loose = await run(sql`regexp_replace(upper(${col}::text), '[^A-Z0-9]', '', 'g') = ${k}`);
  return loose.length === 1 ? loose : [];
}

/** Plain refusal when a verification check (second check, boxing check, label check, lot confirmation) is tapped. */
export const TAP_IS_NOT_A_CHECK = "Tapping the list does not count as a check. Scan the label, or type the number printed on it.";

/** ADR-126: refusal of a typed verification check while `scan.typed_code_counts_as_check` is off. */
export const TYPING_IS_OFF = "This check needs the label scanned. Typing is turned off in Settings.";

/**
 * How a verification check was read (A-SCAN-TYPED-01): a scan or the printed number typed. A tap from a list is
 * refused (ADR-098, A-SCAN-11). Anything else (older screens that send nothing) is taken as a scan. With
 * `typedAllowed` false (setting `scan.typed_code_counts_as_check` off, ADR-126) a typed number is refused the same way
 * (`TYPED_NOT_A_CHECK`). Callers read the setting with `typedChecksAllowed` (src/lib/scan/typed-check.ts).
 */
export function checkEntryMode(via: string | null | undefined, field = "payload", typedAllowed = true): "scan" | "typed" {
  if (via === "tap") throw new DomainError("validation", TAP_IS_NOT_A_CHECK, { field, code: "TAP_NOT_A_CHECK" });
  if (via === "typed" && !typedAllowed) throw new DomainError("validation", TYPING_IS_OFF, { field, code: "TYPED_NOT_A_CHECK", fieldErrors: { [field]: "Scan the label." } });
  return via === "typed" ? "typed" : "scan";
}

/** Plain refusal for a typed number that is not one of the expected boxes or lots. */
export const TYPED_NOT_ON_ORDER = "That number is not on this order. Check the label and type it again.";
