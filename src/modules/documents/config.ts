/**
 * Rendering configuration (ADR-016 as implemented in Phase 2; docs/deployment-railway.md §2).
 *
 * Phase 2 output is `html`: documents and labels are generated, numbered, hashed and audited, and
 * printed through the browser print dialog from the frozen dataset (A4 or label-sized `@page`;
 * every browser's dialog can also "Save as PDF"). No PDF file is stored, so "Download PDF"
 * shows the setup-required state instead of a fake file.
 *
 * PDF_RENDERER
 *   - `disabled` (default): as above.
 *   - `chromium`: reserved for the worker image built with WITH_CHROMIUM=1 (Phase 3, ADR-016 final
 *     call). This stream ships no Chromium adapter, so stored PDFs stay unavailable and the UI
 *     says so; nothing pretends a PDF exists.
 */
export type PdfRenderer = "disabled" | "chromium";

export function pdfRenderer(): PdfRenderer {
  return process.env.PDF_RENDERER === "chromium" ? "chromium" : "disabled";
}

/** Whether a PDF engine is installed in this build. False until the Chromium adapter ships. */
export const PDF_ENGINE_INSTALLED = false;

/** True when stored PDF files can be produced and downloaded. */
export function pdfFilesAvailable(): boolean {
  return PDF_ENGINE_INSTALLED && pdfRenderer() === "chromium";
}

export function pdfSetupMessage(): string {
  return pdfRenderer() === "chromium"
    ? "PDF_RENDERER is set to chromium, but this build has no PDF engine yet. Print from the preview instead (your browser can save it as PDF)."
    : "PDF rendering isn't set up. Print from the preview instead (your browser can save it as PDF). Ask an administrator if you need stored PDF files.";
}
