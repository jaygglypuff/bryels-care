import { notFound } from "next/navigation";
import { DomainError } from "@/lib/errors";
import { getPortalDocument, requirePortalContext } from "@/modules/portal";
import { Logo } from "@/ui/brand";
import { Card, LinkButton, cx } from "@/ui/core";
import { Chip } from "@/ui/status";
import { PrintButton } from "./print-button";

export const metadata = { title: "Document", referrer: "no-referrer" };

/**
 * A customer copy of one document (allow-listed view from src/modules/portal/documents.ts), printable
 * with the browser (ADR-026). Unknown kinds, foreign ids and missing capability are all 404.
 */
export default async function PortalDocumentPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await requirePortalContext();
  const { kind, id } = await params;
  let d: Awaited<ReturnType<typeof getPortalDocument>>;
  try {
    d = await getPortalDocument(ctx, decodeURIComponent(kind), decodeURIComponent(id));
  } catch (e) {
    if (e instanceof DomainError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <LinkButton href="/portal/documents" variant="secondary">All documents</LinkButton>
        <PrintButton />
      </div>
      <Card className="print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{d.kindLabel} · customer copy</p>
            <h1 className="font-display text-[22px] font-semibold sm:text-[26px]">{d.title}</h1>
            {d.statusLabel && <Chip tone="neu">{d.statusLabel}</Chip>}
          </div>
          <Logo className="h-10 w-auto" />
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          {d.facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {/* Lines: stacked on phones, a table from the small breakpoint (no horizontal scroll at 390 px). */}
        <ul className="mt-5 flex flex-col divide-y divide-line border-t border-line sm:hidden">
          {d.rows.map((r, i) => (
            <li key={i} className="py-2.5 text-[13px]">
              {r.map((cell, j) => (
                <p key={j} className={cx(j === 1 ? "font-medium" : "text-fg-2", "break-words")}>
                  <span className="text-[11px] uppercase tracking-wide text-muted">{d.columns[j]?.header}: </span>
                  {cell}
                </p>
              ))}
            </li>
          ))}
        </ul>
        <table className="mt-5 hidden w-full border-collapse text-left text-[13px] sm:table">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
            <tr>
              {d.columns.map((c) => (
                <th key={c.header} className={cx("px-2 py-2 font-semibold", c.numeric && "text-right")}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular">
            {d.rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j} className={cx("px-2 py-2 align-top", d.columns[j]?.numeric && "text-right")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {d.rows.length === 0 && <p className="mt-4 text-[13px] text-muted">No lines.</p>}
        {d.totals.length > 0 && (
          <dl className="ml-auto mt-4 flex max-w-xs flex-col gap-1 border-t border-line pt-3 text-[13px] tabular">
            {d.totals.map(([k, v], i) => (
              <div key={k} className={cx("flex justify-between gap-4", i === d.totals.length - 1 && "text-[15px] font-semibold")}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {d.notes.map((n, i) => (
          <p key={i} className="mt-4 whitespace-pre-line text-[12.5px] text-fg-2">
            {n}
          </p>
        ))}
      </Card>
    </>
  );
}
