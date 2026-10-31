/**
 * Plain sentences for permission strings (ADR-088): "Stock: see, add, change, approve". The strings
 * themselves (`module.entity.action`) appear only under "More details" as the technical name.
 */
export const PLAIN_MODULE: Record<string, string> = {
  inventory: "Stock",
  production: "Making products",
  quality: "Quality (QA)",
  sales: "Customers and orders",
  procurement: "Buying from suppliers",
  finance: "Money (invoices, bills, payments)",
  masterdata: "Setup lists (materials, products, suppliers, places)",
  identity: "People and sign-in",
  platform: "System settings",
  analytics: "Reports and numbers",
  maintenance: "Machines and repairs",
  documents: "Documents and files",
  governance: "Approvals and rules",
  hr: "People records",
  portal: "Customer portal",
};

const ACTION_WORD: Record<string, string> = {
  view: "see",
  create: "add",
  edit: "change",
  submit: "send for OK",
  approve: "approve",
  post: "save for good",
  export: "download",
  void: "cancel or undo",
  admin: "set up",
};

const ORDER = ["view", "create", "edit", "submit", "approve", "post", "export", "void", "admin"];

export const plainModule = (m: string) => PLAIN_MODULE[m] ?? m.charAt(0).toUpperCase() + m.slice(1);
export const plainAction = (a: string) => ACTION_WORD[a] ?? a.replace(/_/g, " ");

/** Groups permission strings by module with the plain verbs, in a stable order. */
export function permissionSummary(codes: readonly string[]): { module: string; label: string; actions: string[]; count: number }[] {
  const byModule = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const c of codes) {
    const [mod, , action = ""] = c.split(".");
    if (!byModule.has(mod)) byModule.set(mod, new Set());
    byModule.get(mod)!.add(action);
    counts.set(mod, (counts.get(mod) ?? 0) + 1);
  }
  return [...byModule.entries()]
    .map(([module, acts]) => ({
      module,
      label: plainModule(module),
      actions: [...acts].sort((a, b) => (ORDER.indexOf(a) + 100 * Number(!ORDER.includes(a))) - (ORDER.indexOf(b) + 100 * Number(!ORDER.includes(b)))).map(plainAction),
      count: counts.get(module) ?? 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** "needs the owner's OK" instead of "restricted" (R), "careful" instead of "sensitive" (S). */
export const SENSITIVITY_TEXT = { N: "Normal", S: "Careful", R: "Needs the owner's OK" } as const;
