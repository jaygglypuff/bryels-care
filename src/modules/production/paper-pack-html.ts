/**
 * ADR-134: the paper batch record pack as one printable HTML file (isomorphic, pure). The pages are the recorded
 * `bmr_paper_page` documents, unchanged (each keeps its DOC number, QR and page reference in its body); this file only
 * puts them one after another, each starting on a new sheet. The page margins name the batch instead of one page's
 * reference, because the recorded pages' `@page` rules would otherwise all show the last page's reference.
 *
 * The device stores this text (IndexedDB, the person's own offline store, deleted at sign-out) and prints it in a
 * frame with Chrome's print dialog, with or without internet. No script is ever part of it.
 */

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** CSS string literal for `content:` (quotes and backslashes escaped, no new lines). */
const cssText = (v: string) => `"${v.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, " ")}"`;

export type PaperPackPage = { css: string; body: string };

export function composePaperPack(input: { batchNumber: string; productName: string; pages: PaperPackPage[]; madeAtText?: string | null }): string {
  const css = [...new Set(input.pages.map((p) => p.css))].join("\n");
  const ident = `Batch ${input.batchNumber} · paper batch record`;
  const override = `@page { @top-right { content: ${cssText(ident)}; } @bottom-right { content: ${cssText(`Batch ${input.batchNumber} · sheet `)} counter(page) " of " counter(pages); } }
html, body { margin: 0; background: #fff; }
.paper-pack-page + .paper-pack-page { break-before: page; page-break-before: always; }
.paper-pack-page table { display: table; }
@media screen { body { background: #f3f2ef; padding: 12px 0; } }`;
  const pages = input.pages.map((p) => `<section class="paper-pack-page">${p.body}</section>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(`Paper batch record ${input.batchNumber} · ${input.productName}`)}</title>
<style>${css}</style>
<style>${override}</style>
</head><body>
${pages}
</body></html>`;
}
