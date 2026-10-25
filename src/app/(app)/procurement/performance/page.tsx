import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate } from "@/lib/qty";
import { supplierPerformance } from "@/modules/procurement";
import { Card, EmptyState, Field, Input, PageHeader, Table, Td } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { SubNav } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supplier performance" };

const pct = (v: string | null) => (v === null ? "no data" : `${v} %`);

/** Supplier performance (US-6-04, W04-10): on time, in full, quality rejects, discrepancies, lead time, returns. */
export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.supplier_performance.view")) return <Forbidden what="supplier performance" />;
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof supplierPerformance>> | null = null;
  let error: string | null = null;
  try {
    data = await supplierPerformance(ctx, { from: sp.from, to: sp.to });
  } catch (e) {
    if (e instanceof DomainError && e.code === "validation") error = e.message;
    else throw e;
  }
  return (
    <>
      <PageHeader title="Supplier performance" subtitle="Measured from posted receipts, PO lines and QA decisions at your sites. A ratio without data says so; it is never shown as 0 % or 100 %." />
      <SubNav />
      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="From" htmlFor="from">
            <Input id="from" type="date" name="from" defaultValue={data?.from ?? sp.from ?? ""} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" type="date" name="to" defaultValue={data?.to ?? sp.to ?? ""} />
          </Field>
          <button type="submit" className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2">
            Show
          </button>
        </form>
        {error && <Banner tone="bad" title="Check the dates">{error}</Banner>}
        {data && (data.rows.length === 0 ? (
          <EmptyState title="No supplier activity in this period">Receipts, completed PO lines and supplier returns between {fmtDate(data.from)} and {fmtDate(data.to)} appear here.</EmptyState>
        ) : (
          <Table head={["Supplier", "On time", "In full", "QA rejects", "Discrepancies", "Lead time (actual / agreed)", "Returns"]}>
            {data.rows.map((r) => (
              <tr key={r.supplierId}>
                <Td>
                  {r.supplierName}
                  <div className="text-[12px] text-muted">
                    {r.supplierCode} · {r.qualityStatus}
                  </div>
                </Td>
                <Td>
                  {pct(r.onTimePct)}
                  <div className="text-[12px] text-muted">
                    {r.onTimeLines} of {r.receiptLines} PO receipt lines
                  </div>
                </Td>
                <Td>
                  {pct(r.inFullPct)}
                  <div className="text-[12px] text-muted">
                    {r.inFullLines} of {r.completedLines} completed lines
                  </div>
                </Td>
                <Td>
                  {pct(r.rejectPct)}
                  <div className="text-[12px] text-muted">
                    {r.lotsRejected} of {r.lotsReceived} lots
                  </div>
                </Td>
                <Td>{r.discrepancies}</Td>
                <Td>
                  {r.avgLeadDays ?? "—"} d / {r.avgAgreedLeadDays ?? "—"} d
                </Td>
                <Td>{r.returnsPosted}</Td>
              </tr>
            ))}
          </Table>
        ))}
      </Card>
    </>
  );
}
