/**
 * Labels where the work happens (ADR-099). Import from "@/ui/labels".
 * - LabelFace / LabelSheet: the one label component used by previews and print pages.
 * - LabelPreview: the label at real size + "Stick one on each …".
 * - PrintLabelsButton: "How many? [N]" + "Print N labels" (or reprint with a reason).
 * - LabelPrintCard: preview + size choice + button (client); PrintLabelsPanel: the same, loaded on the server.
 */
export { LabelFace, LabelSheet } from "./label-face";
export { LabelPreview } from "./label-preview";
export { PrintLabelsButton, printPageHref } from "./print-labels-button";
export { LabelPrintCard } from "./label-print-card";
export { LabelGuide } from "./label-guide";
// PrintLabelsPanel is a server component: import it from "@/ui/labels/print-labels-panel" (keeps this barrel client-safe).
export { LABEL_KIND_WORDS, labelCountWords, plainPrinter, SCAN_SENTENCE } from "./words";
export type { PrintLabelsState } from "./actions";
