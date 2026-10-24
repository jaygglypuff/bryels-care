import type { ImportJobStatus } from "@/modules/imports";

/** Status chip tones of the import pages (the label and the colour always come together). */
export const STATUS_TONE: Record<ImportJobStatus, "ok" | "warn" | "bad" | "info" | "neu" | "appr"> = {
  uploaded: "info",
  validating: "info",
  validated: "ok",
  under_review: "warn",
  submitted: "appr",
  approved: "appr",
  posting: "info",
  posted: "ok",
  failed: "bad",
  rejected: "neu",
  voided: "neu",
};
