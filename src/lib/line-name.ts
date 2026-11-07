/**
 * Names before codes on document lines (ADR-108, ADR-124 item 2). Invoice and supplier bill lines keep their stored
 * description snapshot as written at the time ("PRD-0002 · Aloe Hand Lotion"); only the display puts the name first
 * and the code after it, small and grey. Pure and client-safe; unit-tested in tests/unit/line-name.test.ts.
 */

/** A code as the system makes them: no spaces, at most 40 characters, at least one digit or capital. */
const CODE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,39}$/;

/**
 * "PRD-0002 · Aloe Hand Lotion" → { name: "Aloe Hand Lotion", code: "PRD-0002" }. A description that does not start
 * with a code and " · " (typed by hand, or already name first) is returned whole as the name.
 */
export function splitLineName(description: string | null | undefined): { name: string; code: string | null } {
  const d = (description ?? "").trim();
  const at = d.indexOf(" · ");
  if (at > 0) {
    const code = d.slice(0, at).trim();
    const name = d.slice(at + 3).trim();
    if (name && CODE.test(code) && /[0-9A-Z]/.test(code)) return { name, code };
  }
  return { name: d, code: null };
}

/** Plain text, name first: "Aloe Hand Lotion (PRD-0002)" (selects, CSV-free sentences). */
export function lineNameWords(description: string | null | undefined): string {
  const { name, code } = splitLineName(description);
  return code ? `${name} (${code})` : name;
}
