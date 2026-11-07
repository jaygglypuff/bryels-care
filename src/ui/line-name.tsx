import { splitLineName } from "@/lib/line-name";

/**
 * A document line by its name, the product or material code after it small and grey (ADR-108, ADR-124 item 2):
 *
 *   <LineName name="Aloe Hand Lotion" code="PRD-0002" />      → Aloe Hand Lotion  PRD-0002 (grey)
 *   <LineName description="PRD-0002 · Aloe Hand Lotion" />    → the same, from a stored description snapshot
 *
 * Display only: stored snapshots are never rewritten. Server- and client-safe (no hooks). `print` uses a grey that
 * stays readable on paper.
 */
export function LineName({ name, code, description, className, print = false }: { name?: string | null; code?: string | null; description?: string | null; className?: string; print?: boolean }) {
  const parts = description !== undefined ? splitLineName(description) : { name: (name ?? "").trim(), code: (code ?? "").trim() || null };
  const n = parts.name || parts.code || "—";
  const c = parts.name && parts.code && !parts.name.toUpperCase().endsWith(parts.code.toUpperCase()) ? parts.code : null;
  return (
    <span className={className}>
      {n}
      {c && (
        <>
          {" "}
          <span className={print ? "font-mono text-[10px] text-[#555]" : "font-mono text-[12px] font-normal text-muted"} data-testid="line-code">
            {c}
          </span>
        </>
      )}
    </span>
  );
}
