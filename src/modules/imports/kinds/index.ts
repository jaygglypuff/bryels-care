import "server-only";
import { DomainError } from "@/lib/errors";
import { legacyDocumentsKind } from "./legacy-documents";
import { locationsKind } from "./locations";
import { materialsKind } from "./materials";
import { openingStockKind } from "./opening-stock";
import { reasonCodesKind, uomConversionsKind } from "./reference";
import { skusKind } from "./skus";
import { suppliersKind } from "./suppliers";
import type { ImportKindHandler } from "./types";

/**
 * Import kind registry (docs/data-migration-plan.md §9.2). The wizard, the templates and the go-live loader
 * all read this list, so one engine serves every path (US-5-09). Order = the load order of §5.
 *
 * `customers` is pluggable: the customer master (addresses, contacts, terms) is built by another Wave 3
 * stream, so the kind is listed with its template but stays unavailable until the integrator registers a
 * handler that calls that stream's customer service with `{ tx }` (see `registerImportKind`).
 */
const customersPlaceholder: ImportKindHandler = {
  kind: "customers",
  label: "Customers",
  description: "Customer master with addresses and contacts (docs/data-migration-plan.md §7.5).",
  creates: "customer",
  entityPermissions: ["masterdata.customer.create"],
  availability: { available: false, reason: "Customer imports open when the customer master (addresses, contacts, terms) is installed. Until then customers are entered on the Customers screen." },
  columns: [
    { key: "code", label: "Code", hint: "Blank = the loader assigns CUS-nnnn." },
    { key: "name", label: "Name", required: true, hint: "Registered name." },
    { key: "status", label: "Status", hint: "active or on_hold." },
    { key: "payment_terms_days", label: "Payment terms (days)", hint: "From the Accountant (sensitive)." },
    { key: "credit_limit_amount", label: "Credit limit", hint: "From the Accountant (sensitive)." },
    { key: "currency", label: "Currency", hint: "ISO 4217." },
    { key: "tax_identifier", label: "Tax identifier", hint: "As registered." },
    { key: "legacy_number", label: "Legacy number", hint: "Old code." },
  ],
  exampleRows: [{ code: "CUS-9001", name: "Sample Wellness Store (fictional)", status: "active", payment_terms_days: "30", credit_limit_amount: "", currency: "PHP", tax_identifier: "", legacy_number: "C-017" }],
  normalize: () => null,
  create: async () => {
    throw new DomainError("setup_required", "Customer imports are not installed yet.");
  },
};

const KINDS = new Map<string, ImportKindHandler>(
  ([materialsKind, uomConversionsKind, reasonCodesKind, locationsKind, skusKind, suppliersKind, customersPlaceholder, legacyDocumentsKind, openingStockKind] as ImportKindHandler[]).map((k) => [k.kind, k]),
);

/** Registers (or replaces) a kind handler, e.g. the customer kind once the customer master exists. */
export function registerImportKind(handler: ImportKindHandler): void {
  KINDS.set(handler.kind, handler);
}

export function importKinds(): ImportKindHandler[] {
  return [...KINDS.values()];
}

export function getImportKind(kind: string): ImportKindHandler {
  const k = KINDS.get(kind);
  if (!k) throw new DomainError("validation", `Unknown import kind ${kind}.`, { field: "kind" });
  return k;
}

export { openingStatus } from "./opening-stock";
export type { ImportKindHandler, ColumnSpec, ImportJobRow } from "./types";
