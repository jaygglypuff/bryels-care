import type { LabelData } from "./renderers/label-v1";

/**
 * One label "face" ready for the screen and for printing (ADR-099). Built only from the label renderer's own
 * output (its stylesheet and body, v1 or v2), so the preview on a task screen and the printed page are the
 * same markup and the same styles; only the wrapper differs.
 *
 * The renderers' stylesheets use global class names (`.lbl`), which clash when two label sizes are on one
 * page (a delivery with 100 × 50 mm and 50 × 30 mm labels). Here every face rule is prefixed with a size
 * class and each size gets a named `@page`, so mixed sizes print each on their own paper size.
 */
export type LabelFaceData = {
  /** CSS class of this size, e.g. `lf-100x50`. */
  sizeKey: string;
  widthMm: number;
  heightMm: number;
  /** Scoped face rules plus the named page rule of this size. */
  css: string;
  /** Rendered label markup (one `<article class="lbl">` per copy), escaped by the renderer. */
  body: string;
  /** What the QR / barcode encodes, e.g. `BC:LOT:L-2610-00001`. */
  payload: string;
  copies: number;
};

const num = (v: number) => String(Math.round(v * 10) / 10).replace(".", "_");

export function sizeKeyOf(w: number, h: number): string {
  return `lf-${num(w)}x${num(h)}`;
}

/** Prefixes every selector of a flat stylesheet (no at-rules) with `.scope `. */
export function scopeCss(css: string, scope: string): string {
  return css.replace(/(^|[}\n])(\s*)([^{}@\n][^{}]*?)\s*\{/g, (_m, lead: string, ws: string, sel: string) => {
    const scoped = sel
      .split(",")
      .map((s) => `.${scope} ${s.trim()}`)
      .join(", ");
    return `${lead}${ws}${scoped} {`;
  });
}

/**
 * The face rules of a label stylesheet: the renderer's CSS without its `@page` rule and its trailing
 * `@media print { … }` block (both renderers emit `@page …` first and `@media print` last).
 */
export function faceRulesOf(fullCss: string): string {
  const noPage = fullCss.replace(/@page\s*\{[^}]*\}/, "");
  const i = noPage.indexOf("@media print");
  return (i >= 0 ? noPage.slice(0, i) : noPage).trim();
}

export function labelFace(data: LabelData, body: string, fullCss: string): LabelFaceData {
  const w = data.label.mediaWidthMm;
  const h = data.label.mediaHeightMm;
  const key = sizeKeyOf(w, h);
  const page = key.replace(/-/g, "_");
  const mm = (v: number) => `${Math.round(v * 10) / 10}mm`;
  // On paper the label is 0.6 mm shorter than the page: browsers round the page size down a little, and a label
  // exactly as tall as the page spills onto a blank extra page (seen in Chrome's PDF: 40 mm → 39.88 mm page).
  const css = `${scopeCss(faceRulesOf(fullCss), key)}\n@page ${page} { size: ${mm(w)} ${mm(h)}; margin: 0; }\n@media print { .lf-face.${key} { page: ${page}; } .lf-face.${key} .lbl { height: ${mm(h - 0.6)}; } }`;
  return { sizeKey: key, widthMm: w, heightMm: h, css, body, payload: `BC:${data.entity.payloadType}:${data.entity.value}`, copies: data.copies };
}
