/**
 * Plain names for the ready-made reports (ADR-088 grade-5 words). The report definitions keep their
 * official titles for exports, printouts and audit; the screens show these names. The report code stays
 * in the URL and under "More details" only.
 */
export const PLAIN_REPORT: Record<string, { title: string; text: string }> = {
  "RPT-INV-STOCK": { title: "What stock we have, and where", text: "Every lot on the shelves: how much, which shelf, its expiry date and whether it is OK to use." },
  "RPT-INV-EXPIRY": { title: "Stock that expires soon (or already did)", text: "Use these first, or set them aside." },
  "RPT-INV-MOVEMENTS": { title: "Stock in and out", text: "Every time stock was received, moved, used, sent or corrected." },
  "RPT-INV-RECEIPTS": { title: "Deliveries we received", text: "What came in from suppliers, when, and the QA result." },
  "RPT-PRO-OPEN-PO": { title: "Orders to suppliers still coming", text: "What we ordered and have not received yet, with the expected date." },
  "RPT-PRO-SUPPLIER": { title: "How good our suppliers are", text: "On time, right amount, passed the quality check." },
  "RPT-PRD-BATCHES": { title: "Batches made and how much came out", text: "Each batch: product, amount made against the recipe, QA result." },
  "RPT-PRD-WORK-ORDERS": { title: "Production orders and which are late", text: "Planned dates against real dates." },
  "RPT-PRO-MAINTENANCE": { title: "Machine repairs and maintenance", text: "Repair jobs and regular maintenance, open and done." },
  "RPT-QUA-DISPOSITIONS": { title: "QA decisions (OK / not OK)", text: "Every lot and batch QA decided on, who decided and when." },
  "RPT-QUA-DEVIATIONS": { title: "Problem reports", text: "Things that went wrong, how bad, and whether they are closed." },
  "RPT-QUA-HOLDS": { title: "Stock stopped by QA", text: "What is stopped, since when and why." },
  "RPT-QUA-CAPA": { title: "Fix-and-prevent plans", text: "Plans to fix a problem and stop it happening again." },
  "RPT-SAL-ORDERS": { title: "Customer orders and what was sent", text: "Each order: what was ordered, what was sent, what is still open." },
  "RPT-SAL-SHIPMENTS": { title: "Shipments and delivery papers", text: "What left the warehouse, when, for which customer." },
  "RPT-AUD-EXTRACT": { title: "History of changes (for auditors)", text: "Who changed what and when, for a period you choose." },
  "RPT-SEC-ACCESS": { title: "Sign-ins and access problems (weekly)", text: "Failed sign-ins, locked accounts and role changes." },
};

export const PLAIN_CATEGORY: Record<string, string> = {
  Inventory: "Stock",
  Procurement: "Buying from suppliers",
  Production: "Making products",
  Quality: "Quality",
  Sales: "Customers and orders",
  "Audit and access": "Checks and sign-ins",
};

export function plainReport(code: string, fallbackTitle: string, fallbackText = ""): { title: string; text: string } {
  return PLAIN_REPORT[code] ?? { title: fallbackTitle, text: fallbackText };
}
