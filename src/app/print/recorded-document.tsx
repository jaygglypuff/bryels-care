/**
 * Shows a recorded (hash-checked) document body with its own stylesheet, shielded from the app's
 * utility classes (2026-11 print audit). The renderers' markup and CSS are frozen and checksummed, so the
 * fix lives here, outside the checksum: Tailwind's `.grid { display: grid }` utility also matched the
 * renderers' `<table class="grid">` and broke every table of the dispensing sheet, traveler, pick list,
 * packing list and delivery receipt (header row narrower than the body, columns not lined up) on screen
 * and in Chrome's print preview. `RECORDED_DOC_RESET` restores table display inside `.recorded-doc` only.
 */
export const RECORDED_DOC_RESET = `.recorded-doc table, .recorded-doc table.grid { display: table; }
.recorded-doc table > thead { display: table-header-group; }
.recorded-doc table > tbody { display: table-row-group; }
.recorded-doc table > tfoot { display: table-footer-group; }
.recorded-doc table tr { display: table-row; }
.recorded-doc table th, .recorded-doc table td { display: table-cell; }
.recorded-doc h2, .recorded-doc h3 { break-after: avoid; page-break-after: avoid; }
@media print { .recorded-doc, .recorded-doc-scroll { overflow: visible !important; } }`;

export function RecordedDocument({ css, body, className }: { css: string; body: string; className?: string }) {
  return (
    <div className={`recorded-doc${className ? ` ${className}` : ""}`}>
      <style>{css}</style>
      <style>{RECORDED_DOC_RESET}</style>
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
