/**
 * A shelf or place by its name, the code after it small and grey (re-audit B N1/N3: names before codes).
 *
 *   <PlaceName name="Finished goods bay" code="FG-01" />  → Finished goods bay  FG-01 (grey)
 *   placeWords("Finished goods bay", "FG-01")              → "Finished goods bay (FG-01)" for plain text
 *
 * When a place has no name the code is shown alone; when the name already ends with the code
 * ("Oils rack A-01") the code is not repeated.
 */
export function PlaceName({ name, code, className }: { name: string | null | undefined; code: string | null | undefined; className?: string }) {
  const n = (name ?? "").trim();
  const c = (code ?? "").trim();
  if (!n) return <span className={className}>{c || "—"}</span>;
  const repeat = !c || n.toUpperCase().endsWith(c.toUpperCase());
  return (
    <span className={className}>
      {n}
      {!repeat && (
        <>
          {" "}
          <span className="font-mono text-[12px] text-muted" data-testid="place-code">
            {c}
          </span>
        </>
      )}
    </span>
  );
}

/** The same in plain text (selects, sentences): name first, code in brackets only when it adds something. */
export function placeWords(name: string | null | undefined, code: string | null | undefined): string {
  const n = (name ?? "").trim();
  const c = (code ?? "").trim();
  if (!n) return c || "—";
  if (!c || n.toUpperCase().endsWith(c.toUpperCase())) return n;
  return `${n} (${c})`;
}
