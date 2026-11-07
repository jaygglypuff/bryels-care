/**
 * Hand-over of a label from the search box (top bar, Ctrl/⌘+K, Scan or search) to the Scan or search screen
 * (ADR-125). The link carries the label and a request number `n`: entering the same label again makes a new link,
 * so the screen looks the card up again instead of keeping the first answer (the page only reacts to a change of
 * its search params). Pure: used by client components and the server page.
 */

export const SCAN_CODE_MAX = 200;

/** `/inventory/scan?code=<label>&n=<request>`; `request` must change per hand-over (a counter or the click time). */
export function scanCodeHref(raw: string, request: number): string {
  return `/inventory/scan?code=${encodeURIComponent(raw)}&n=${Math.max(0, Math.trunc(request))}`;
}

/** The label to look up and a key that changes per hand-over (`n` + code), or null when no label was handed over. */
export function scanRequestOf(sp: { code?: string; n?: string }): { code: string; key: string } | null {
  const code = (sp.code ?? "").slice(0, SCAN_CODE_MAX);
  if (!code.trim()) return null;
  const n = /^\d{1,16}$/.test(sp.n ?? "") ? sp.n! : "0";
  return { code, key: `${n}:${code}` };
}
