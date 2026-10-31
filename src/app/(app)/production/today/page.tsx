import Link from "next/link";
import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { listSiteDailyLogs, manilaToday } from "@/modules/production";
import { Card, EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { PageIntro } from "@/ui/guide";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

const pcs = (v: string) => fmtQty(v, "", D(v).isInteger() ? 0 : 1);

/**
 * Today (ADR-080 §11, stage G1): what was written in the daily log today, for every production
 * order of the site. Read-only here: today's count is written on the order page ("What happened
 * today?"). The full plant page with one row per order and "+ add" is stage G4 (V2-8).
 */
export default async function TodayPage() {
  const ctx = await requireContext();
  if (!ctx.can("production.daily_log.view")) return <Forbidden what="the daily log" />;
  const t = await listSiteDailyLogs(ctx, { date: manilaToday() });
  const counted = t.entries.filter((e) => !e.replacedById);
  const good = counted.reduce((a, e) => a.plus(e.goodQty), D(0));
  const rejects = counted.reduce((a, e) => a.plus(e.rejectTotal), D(0));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Today"
        subtitle={`${ctx.currentSite.name} · ${fmtDate(t.date)}`}
        actions={
          <>
            <Help screen="production.production_order" />
            <LinkButton href="/production/orders" variant="secondary">Orders</LinkButton>
          </>
        }
      />
      <PageIntro>Today's count: good pieces and rejects written in the daily log of each batch.</PageIntro>
      {t.entries.length === 0 ? (
        <EmptyState title="Nothing written today yet" action={<LinkButton href="/production/orders">Open an order</LinkButton>}>
          To write today&apos;s count, open the production order and fill in &quot;What happened today?&quot;.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-[14px] border border-line bg-surface p-3">
              <p className="text-[12px] text-muted">Good pieces today</p>
              <p className="text-[22px] font-semibold tabular">{pcs(good.toString())}</p>
            </div>
            <div className="rounded-[14px] border border-line bg-surface p-3">
              <p className="text-[12px] text-muted">Rejects today</p>
              <p className="text-[22px] font-semibold tabular">{pcs(rejects.toString())}</p>
            </div>
          </div>
          <ul className="space-y-2">
            {t.entries.map((e) => (
              <li key={e.id}>
                <Card className={cx("p-4", e.replacedById && "opacity-60")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/production/orders/${e.workOrderId}`} className="text-[16px] font-semibold hover:underline">
                      {e.productName}
                    </Link>
                    <div className="flex flex-wrap gap-1">
                      {e.correctsId && <Chip tone="info">Correction</Chip>}
                      {e.replacedById && <Chip tone="neu">Replaced – not counted</Chip>}
                    </div>
                  </div>
                  <p className="text-[13px] text-muted">
                    {e.orderNumber}
                    {e.batchNumber ? ` · batch ${e.batchNumber}` : ""}
                    {e.shift ? ` · ${e.shift}` : ""}
                  </p>
                  {e.notes && <p className="mt-1 whitespace-pre-line text-[14px]">{e.notes}</p>}
                  <p className="mt-1 text-[14px]">
                    Good: <span className="font-semibold tabular">{pcs(e.goodQty)}</span>
                    {e.rejects.length > 0 && (
                      <>
                        {" "}· Rejects: <span className="font-semibold tabular">{pcs(e.rejectTotal)}</span> ({e.rejects.map((d) => `${d.type} ${pcs(d.quantity)}`).join(", ")})
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-[12px] text-muted">
                    {e.author} · {fmtDateTime(e.createdAt)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
