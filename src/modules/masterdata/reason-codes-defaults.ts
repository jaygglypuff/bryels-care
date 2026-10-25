import type { ReasonCategory } from "../../db/schema/org";

/**
 * Reference reason codes installed for every organization (US-1-24). They are the lists other
 * streams held in code until the shared table existed, merged by code (the same code keeps one
 * meaning across categories), plus the migration and undo codes named in docs/data-model.md §3.2.
 * Content is owned by the company: QA, the warehouse lead and the site managers confirm or
 * replace it before go-live (assumption A-W2G-05). Codes never change once installed.
 *
 * Sources: W1E reprint reasons (src/modules/documents/reasons.ts, A-PRD-45); W1B unplanned-receipt
 * reasons (src/modules/inventory/receiving-state.ts, A-W1B-01) and hold reasons
 * (src/modules/inventory/holds.ts, A-W1B-04); W1C adjustment and count-variance reasons
 * (src/db/schema/counts.ts); W2B scrap/rework reasons (formerly a setting).
 */
export type ReasonCodeSeed = { code: string; name: string; appliesTo: ReasonCategory[]; requiresNote?: boolean; requiresApproval?: boolean; sortOrder: number };

export const DEFAULT_REASON_CODES: readonly ReasonCodeSeed[] = [
  // Unplanned receipt (W1B)
  { code: "no_purchase_order", name: "No purchase order in the system (purchasing not yet live)", appliesTo: ["receipt"], sortOrder: 10 },
  { code: "urgent_purchase", name: "Urgent purchase, PO to follow", appliesTo: ["receipt"], sortOrder: 11 },
  { code: "replacement_delivery", name: "Replacement for a rejected delivery", appliesTo: ["receipt"], sortOrder: 12 },
  { code: "sample_or_free_goods", name: "Sample or free goods", appliesTo: ["receipt"], sortOrder: 13 },
  // Holds (W1B)
  { code: "supplier_complaint", name: "Supplier complaint or notice", appliesTo: ["hold"], sortOrder: 20 },
  { code: "suspected_contamination", name: "Suspected contamination", appliesTo: ["hold"], sortOrder: 21 },
  { code: "damaged_packaging", name: "Damaged packaging", appliesTo: ["hold"], sortOrder: 22 },
  { code: "documentation_issue", name: "Documentation issue (CoA, label)", appliesTo: ["hold"], sortOrder: 23 },
  { code: "investigation", name: "Investigation / deviation", appliesTo: ["hold"], sortOrder: 24 },
  { code: "retest_due", name: "Retest due", appliesTo: ["hold"], sortOrder: 25 },
  // Adjustments and count variances (W1C)
  { code: "found", name: "Found stock", appliesTo: ["adjustment", "count_variance"], sortOrder: 30 },
  { code: "found_unlabelled", name: "Found unlabelled stock", appliesTo: ["adjustment"], sortOrder: 31 },
  { code: "lost", name: "Lost stock", appliesTo: ["adjustment"], sortOrder: 32 },
  { code: "damaged", name: "Damaged", appliesTo: ["adjustment"], sortOrder: 33 },
  { code: "spillage", name: "Spillage", appliesTo: ["adjustment"], sortOrder: 34 },
  { code: "expired_disposal", name: "Expired stock disposed", appliesTo: ["adjustment"], sortOrder: 35 },
  { code: "data_correction", name: "Data correction", appliesTo: ["adjustment"], sortOrder: 36 },
  { code: "damage", name: "Damage found at count", appliesTo: ["count_variance"], sortOrder: 40 },
  { code: "mis_location", name: "Stock in the wrong location", appliesTo: ["count_variance"], sortOrder: 41 },
  { code: "unrecorded_issue", name: "Issue not recorded", appliesTo: ["count_variance"], sortOrder: 42 },
  { code: "unrecorded_receipt", name: "Receipt not recorded", appliesTo: ["count_variance"], sortOrder: 43 },
  { code: "data_entry", name: "Data entry error", appliesTo: ["count_variance"], sortOrder: 44 },
  { code: "loss", name: "Loss", appliesTo: ["count_variance"], sortOrder: 45 },
  // Reprints (W1E, docs/reports-and-templates.md §13.3)
  { code: "lost_copy", name: "Lost copy", appliesTo: ["reprint"], sortOrder: 50 },
  { code: "damaged_label", name: "Damaged or unreadable label", appliesTo: ["reprint"], sortOrder: 51 },
  { code: "status_change", name: "Status changed (new status word needed)", appliesTo: ["reprint"], sortOrder: 52 },
  { code: "repack", name: "Repacked into a new container", appliesTo: ["reprint"], sortOrder: 53 },
  { code: "customer_copy", name: "Extra copy for a customer", appliesTo: ["reprint"], sortOrder: 54 },
  // Scrap and rework of finished units (W2B, formerly setting production.scrap_rework.reason_codes, A-W2B-05)
  { code: "broken_bar", name: "Broken or cracked unit", appliesTo: ["scrap", "rework"], sortOrder: 70 },
  { code: "underweight", name: "Underweight unit", appliesTo: ["scrap", "rework"], sortOrder: 71 },
  { code: "appearance", name: "Appearance defect", appliesTo: ["scrap", "rework"], sortOrder: 72 },
  { code: "packaging_damage", name: "Damaged in packaging", appliesTo: ["scrap", "rework"], sortOrder: 73 },
  // Migration and undo (docs/data-model.md §3.2, §13.5)
  { code: "opening_balance", name: "Opening balance (data migration)", appliesTo: ["receipt", "adjustment"], sortOrder: 60 },
  { code: "expiry_unknown", name: "Expiry date unknown at migration", appliesTo: ["receipt", "hold"], requiresNote: true, sortOrder: 61 },
  { code: "import_voided", name: "Imported record voided", appliesTo: ["reversal", "cancel"], requiresNote: true, sortOrder: 62 },
  { code: "legacy_release", name: "Released under the previous paper system", appliesTo: ["disposition"], requiresNote: true, sortOrder: 63 },
  { code: "undo_by_actor", name: "Undone by the person who posted it", appliesTo: ["reversal"], sortOrder: 64 },
  // Customer returns (Wave 3 W3F, US-4-16; the company's sales and QA leads confirm the list, A-W3F-06)
  { code: "customer_refused", name: "Refused by the customer at delivery", appliesTo: ["return"], sortOrder: 80 },
  { code: "damaged_in_transit", name: "Damaged in transit", appliesTo: ["return"], sortOrder: 81 },
  { code: "wrong_item", name: "Wrong item or quantity delivered", appliesTo: ["return"], sortOrder: 82 },
  { code: "quality_complaint", name: "Returned with a quality complaint", appliesTo: ["return"], sortOrder: 83 },
  { code: "short_dated", name: "Shelf life shorter than agreed", appliesTo: ["return"], sortOrder: 84 },
  { code: "recall_return", name: "Returned under a recall or withdrawal", appliesTo: ["return"], sortOrder: 85 },
  // Supplier returns (Wave 4 W4A, US-6-21; procurement and QA leads confirm the list, A-W4A-09)
  { code: "rejected_at_inspection", name: "Rejected at incoming inspection", appliesTo: ["return"], sortOrder: 86 },
  { code: "over_delivery", name: "Over-delivered surplus sent back", appliesTo: ["return"], sortOrder: 87 },
  // Shared
  { code: "other", name: "Other (explain)", appliesTo: ["receipt", "hold", "adjustment", "count_variance", "reprint", "scrap", "rework", "return"], requiresNote: true, sortOrder: 99 },
];

/** Active codes offered for a category, in display order (US-1-24 AC1). Pure, unit-tested. */
export function reasonCodesFor<T extends { appliesTo: string[]; isActive: boolean; sortOrder: number; code: string }>(rows: readonly T[], category: string): T[] {
  return rows.filter((r) => r.isActive && r.appliesTo.includes(category)).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

export const REASON_NOTE_MAX = 500;
