/**
 * Complaint rules without database access (US-4-15, W07-06): the state machine, labels and the
 * customer-facing projection. Pure, so pages, documents and unit tests share one definition.
 */
import type { COMPLAINT_CHANNELS, COMPLAINT_STATUSES, COMPLAINT_TRACE_MATCHES } from "@/db/schema/complaints";

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export type ComplaintChannel = (typeof COMPLAINT_CHANNELS)[number];
export type ComplaintTraceMatch = (typeof COMPLAINT_TRACE_MATCHES)[number];

/** open → investigating → resolved → closed; resolved → investigating (reopened before closure). */
export const COMPLAINT_TRANSITIONS: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  open: ["investigating"],
  investigating: ["resolved"],
  resolved: ["investigating", "closed"],
  closed: [],
};

export const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  resolved: "Resolved",
  closed: "Closed",
};

export const COMPLAINT_CHANNEL_LABEL: Record<ComplaintChannel, string> = {
  phone: "Phone call",
  email: "Email",
  visit: "Customer visit",
  sales_rep: "Through the sales representative",
  other: "Other",
};

export const TRACE_MATCH_LABEL: Record<ComplaintTraceMatch, string> = {
  verified: "Verified: shipped to this customer",
  unverified: "Not verifiable: no shipment to this customer is recorded yet",
  mismatch: "Not found in this customer's shipments",
  not_given: "No lot or box code given",
};

export function canMoveComplaint(from: string, to: ComplaintStatus): boolean {
  return (COMPLAINT_TRANSITIONS[from as ComplaintStatus] ?? []).includes(to);
}

/** The fields of a complaint that may appear on a customer-facing document (acknowledgement, portal). */
export type CustomerFacingComplaint = {
  complaintNumber: string;
  receivedAt: Date;
  statusWord: string;
  customerName: string;
  customerAddress: string;
  customerReference: string | null;
  productName: string | null;
  reportedCode: string | null;
  lotNumber: string | null;
  categoryLabel: string;
  description: string;
  qtyAffected: string | null;
  sampleReturned: boolean;
  customerResponse: string | null;
};

/** Status wording for the customer: internal stages (investigating, resolved) read as "under review". */
const CUSTOMER_STATUS_WORD: Record<ComplaintStatus, string> = {
  open: "Received",
  investigating: "Under review",
  resolved: "Under review",
  closed: "Closed",
};

/**
 * Whitelist projection (docs/permissions-matrix.md §6 "Internal notes"): only the named fields are
 * copied, so internal notes, investigation, root cause, internal resolution, severity and the
 * recall-review flag can never reach a customer-facing document, whatever the input carries.
 */
export function toCustomerFacing(c: {
  complaintNumber: string;
  receivedAt: Date;
  status: string;
  customerName: string;
  customerAddress: string;
  customerReference: string | null;
  productName: string | null;
  reportedCode: string | null;
  lotNumber: string | null;
  categoryLabel: string;
  description: string;
  qtyAffected: string | null;
  sampleReturned: boolean;
  customerResponse: string | null;
}): CustomerFacingComplaint {
  return {
    complaintNumber: c.complaintNumber,
    receivedAt: c.receivedAt,
    statusWord: CUSTOMER_STATUS_WORD[c.status as ComplaintStatus] ?? "Received",
    customerName: c.customerName,
    customerAddress: c.customerAddress,
    customerReference: c.customerReference,
    productName: c.productName,
    reportedCode: c.reportedCode,
    lotNumber: c.lotNumber,
    categoryLabel: c.categoryLabel,
    description: c.description,
    qtyAffected: c.qtyAffected,
    sampleReturned: c.sampleReturned,
    customerResponse: c.customerResponse,
  };
}

/** Normalises a typed or scanned lot/box code: control characters removed, upper case, payload kind split off. */
export function parseTraceCode(raw: string | null | undefined): { kind: "box" | "lot" | "any"; value: string } | null {
  const code = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().toUpperCase();
  if (!code) return null;
  const m = /^BC:(BOX|LOT):(.+)$/.exec(code);
  if (m) return { kind: m[1] === "BOX" ? "box" : "lot", value: m[2].trim() };
  return { kind: "any", value: code };
}
