/**
 * Minimal escaping HTML builder for the code-defined renderers (A-RPT-01).
 *
 * Every interpolated value is escaped unless it is a `SafeHtml` produced by this module or by
 * the barcode generators. Renderers are pure functions of a frozen dataset, framework-free so
 * they run identically in a request, in the worker and in tests (React's static renderer is not
 * available in the RSC layer of Next.js, so it is not used here).
 */

export class SafeHtml {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

type Part = SafeHtml | string | number | null | undefined | false | Part[];

function renderPart(p: Part): string {
  if (p === null || p === undefined || p === false) return "";
  if (p instanceof SafeHtml) return p.value;
  if (Array.isArray(p)) return p.map(renderPart).join("");
  return escapeHtml(p);
}

/** Tagged template: html`<p>${userText}</p>` escapes userText. */
export function html(strings: TemplateStringsArray, ...values: Part[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderPart(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Marks trusted markup (only for output of our own generators, never for data). */
export function trusted(markup: string): SafeHtml {
  return new SafeHtml(markup);
}
