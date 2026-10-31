import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate } from "@/lib/qty";
import { supplierPerformance } from "@/modules/procurement";
import { Card, EmptyState, Field, Input, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { SubNav, SupplierChip } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "How suppliers do" };

const pct = (v: string | null) => (v === null ? "no data yet" : `${v} %`);

/** Supplier performance (US-6-04, W04-10): on time, everything there, QA not OK, problems, days, returns — one row per supplier. */
export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.supplier_performance.view")) return <Forbidden what="supplier results" />;
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
      <PageHeader title="How suppliers do" />
      <PageIntro>This screen is for comparing suppliers: do they deliver on time, is everything there, and does QA accept what they send? Counted from real deliveries; “no data yet” is never shown as 0 % or 100 %.</PageIntro>
      <SubNav />
      <Card>
        <form method="get" className="mb-4 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
          <Field label="From" htmlFor="from">
            <Input id="from" type="date" name="from" defaultValue={data?.from ?? sp.from ?? ""} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" type="date" name="to" defaultValue={data?.to ?? sp.to ?? ""} />
          </Field>
          <button type="submit" className="col-span-2 inline-flex min-h-[44px] items-center justify-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2 sm:col-span-1">
            Show
          </button>
        </form>
        {error && <Banner tone="bad" title="Check the dates">{error}</Banner>}
        {data &&
          (data.rows.length === 0 ? (
            <EmptyState title="No deliveries in these dates">Deliveries, finished orders and returns between {fmtDate(data.from)} and {fmtDate(data.to)} show here. Try wider dates.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line" aria-label="Suppliers">
              {data.rows.map((r) => (
                <li key={r.supplierId} className="px-4 py-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.supplierName}</span>
                    <SupplierChip status={r.qualityStatus} />
                    <span className="font-mono text-[12px] text-muted">{r.supplierCode}</span>
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[14px] sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <dt className="text-[12px] text-muted">On time</dt>
                      <dd className="font-semibold tabular-nums">{pct(r.onTimePct)}</dd>
                      <dd className="text-[12px] text-muted">{r.onTimeLines} of {r.receiptLines} deliveries</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">Everything there</dt>
                      <dd className="font-semibold tabular-nums">{pct(r.inFullPct)}</dd>
                      <dd className="text-[12px] text-muted">{r.inFullLines} of {r.completedLines} items</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">QA said not OK</dt>
                      <dd className="font-semibold tabular-nums">{pct(r.rejectPct)}</dd>
                      <dd className="text-[12px] text-muted">{r.lotsRejected} of {r.lotsReceived} lots</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">Problems at delivery</dt>
                      <dd className="font-semibold tabular-nums">{r.discrepancies}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">Days to deliver (real / agreed)</dt>
                      <dd className="font-semibold tabular-nums">
                        {r.avgLeadDays ?? "—"} / {r.avgAgreedLeadDays ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">Sent back</dt>
                      <dd className="font-semibold tabular-nums">{r.returnsPosted}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          ))}
      </Card>
    </>
  );
}
