import Link from "next/link";
import { fmtDate } from "@/lib/qty";
import { listPortalDocuments, portalDocumentKinds, requirePortalContext } from "@/modules/portal";
import { EmptyState, PageHeader, cx } from "@/ui/core";
import { Chip } from "@/ui/status";

export const metadata = { title: "Documents" };

/** The customer's own documents (US-8-02): quotations and delivery receipts; invoices once finance adds them. */
export default async function PortalDocumentsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await requirePortalContext();
  const { kind } = await searchParams;
  const kinds = portalDocumentKinds();
  const active = kinds.some((k) => k.kind === kind) ? kind : undefined;
  const docs = await listPortalDocuments(ctx, { kind: active });
  return (
    <>
      <PageHeader title="Documents" subtitle={`${ctx.customerName} · customer copies you can view and print`} />
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter documents">
        {[{ kind: undefined as string | undefined, label: "All" }, ...kinds].map((k) => (
          <Link
            key={k.kind ?? "all"}
            href={k.kind ? `/portal/documents?kind=${k.kind}` : "/portal/documents"}
            aria-current={active === k.kind ? "page" : undefined}
            className={cx("rounded-full border px-3.5 py-1.5 text-[13px] font-medium", active === k.kind ? "border-transparent bg-[var(--brand-600)] text-white" : "border-line bg-surface text-fg-2 hover:bg-[var(--lime-100)]")}
          >
            {k.label}
          </Link>
        ))}
      </div>
      {docs.length === 0 ? (
        <EmptyState title="No documents yet">Delivery receipts appear here when an order is dispatched, quotations when our sales team sends you one.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((d) => (
            <li key={`${d.kind}:${d.id}`}>
              <Link href={d.href} className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-line bg-surface px-4 py-3 hover:border-[var(--brand-300)] hover:bg-[var(--lime-50)]">
                <span className="min-w-0">
                  <span className="block font-semibold">{d.title}</span>
                  <span className="block text-[12px] text-muted">
                    {fmtDate(d.date)}
                    {d.reference ? ` · ${d.reference}` : ""}
                  </span>
                </span>
                {d.statusLabel && <Chip tone="neu">{d.statusLabel}</Chip>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
