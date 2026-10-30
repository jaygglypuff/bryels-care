import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import type { OperationsCenter, OwnerOverview as OwnerKpis } from "@/modules/analytics";
import { fmtKpi } from "@/ui/charts/format";
import { PipelineStrip } from "@/ui/pipeline";
import { cx } from "@/ui/core";
import { KpiCard } from "../analytics/kpi-ui";

/** One line of "Needs your attention": a plain sentence that opens the records behind it. */
export type AttentionItem = { key: string; text: string; href: string; urgent?: boolean };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;

/**
 * The owner's "needs attention" list (ADR-083), built from live counts only: decisions waiting, late
 * deliveries and orders, late batches, quality checks, holds, expiring stock and low stock.
 */
export function attentionItems(oc: OperationsCenter, approvals: number, lowStock: number | null, notInvoiced: { count: number; oldestDays: number | null } | null = null): AttentionItem[] {
  const st = (k: string) => oc.stages.find((s) => s.key === k);
  const items: AttentionItem[] = [];
  if (approvals > 0) items.push({ key: "approve", text: `${plural(approvals, "thing waits", "things wait")} for your decision`, href: "/approvals", urgent: true });
  const add = (k: string, text: (n: number) => string, urgent = false) => {
    const s = st(k);
    if (s && s.attention > 0) items.push({ key: k, text: text(s.attention), href: s.attentionHref ?? s.href, urgent });
  };
  add("dispatch", (n) => `${plural(n, "customer order is", "customer orders are")} past the promised delivery date`, true);
  add("production", (n) => `${plural(n, "batch is", "batches are")} late to start`, true);
  add("expected", (n) => `${plural(n, "supplier delivery is", "supplier deliveries are")} late`);
  const qc = st("qc");
  if (qc && qc.count > 0) items.push({ key: "qc", text: `${plural(qc.count, "finished batch waits", "finished batches wait")} for the quality check`, href: qc.href });
  add("inspection", (n) => `${plural(n, "material lot is", "material lots are")} on quality hold`);
  if (lowStock && lowStock > 0) items.push({ key: "low", text: `${plural(lowStock, "item is", "items are")} below the minimum stock`, href: "/procurement/reorder", urgent: true });
  if (notInvoiced && notInvoiced.count > 0)
    items.push({ key: "invoice", text: `${plural(notInvoiced.count, "shipment is", "shipments are")} not billed yet${notInvoiced.oldestDays && notInvoiced.oldestDays > 1 ? ` (oldest ${notInvoiced.oldestDays} days ago)` : ""}`, href: "/finance/invoices", urgent: (notInvoiced.oldestDays ?? 0) > 7 });
  add("raw_available", (n) => `${plural(n, "raw material lot expires", "raw material lots expire")} within 30 days`);
  add("finished", (n) => `${plural(n, "finished goods lot expires", "finished goods lots expire")} within 30 days`);
  return items;
}

export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  return (
    <section aria-labelledby="attention-h" className="rounded-[20px] border border-line bg-surface p-4 sm:p-5">
      <h2 id="attention-h" className="font-display text-[18px] font-semibold text-fg">Needs your attention</h2>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-[15px] text-fg-2">
          <CheckCircle2 size={18} className="text-primary-text" aria-hidden /> Nothing needs you right now.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {items.map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="group flex min-h-[52px] items-center gap-3 py-2.5 text-[15px] text-fg">
                <AlertTriangle size={18} className={cx("shrink-0", i.urgent ? "text-[var(--bad-fg)]" : "text-[var(--warn-fg)]")} aria-hidden />
                <span className="min-w-0 flex-1">{i.text}</span>
                <ArrowRight size={16} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Four headline numbers with plain titles; each opens its records (actuals, estimates labelled). */
export function HeadlineNumbers({ kpi }: { kpi: OwnerKpis }) {
  const t = kpi.tiles;
  const orderValue = t["KPI-SAL-01V"];
  const expired = t["KPI-INV-04E"];
  const common = { scope: kpi.scope, period: kpi.period, updated: kpi.generatedAt, simple: true, visual: "none" as const };
  return (
    <section aria-label="How the business is doing" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard {...common} tile={t["KPI-SAL-01"]} title="Customer orders" hint={!orderValue.masked && orderValue.current ? <>Worth {fmtKpi("money", orderValue.current.value)}</> : undefined} />
      <KpiCard
        {...common}
        tile={t["KPI-OPS-01"]}
        title="Made vs planned"
        hint={t["KPI-OPS-01"].current ? <>{fmtKpi("qty_g", t["KPI-OPS-01"].current.numerator)} made of {fmtKpi("qty_g", t["KPI-OPS-01"].current.denominator)} planned</> : undefined}
      />
      <KpiCard {...common} tile={t["KPI-INV-04"]} title="Stock expiring soon" hint={!expired.masked && expired.current && Number(expired.current.value) > 0 ? <>{plural(Number(expired.current.value), "lot has", "lots have")} already expired</> : undefined} />
      <KpiCard {...common} tile={t["KPI-QUA-03"]} title="Stock on quality hold" />
    </section>
  );
}

export function RightNow({ oc, all }: { oc: OperationsCenter; all: boolean }) {
  if (oc.stages.length === 0) return null;
  return (
    <section aria-labelledby="now-h" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="now-h" className="font-display text-[18px] font-semibold">From delivery to dispatch, right now</h2>
        <Link href={all ? "/operations?scope=all" : "/operations"} className="text-[14px] font-medium text-primary-text hover:underline">
          Open the Operations Center
        </Link>
      </div>
      <PipelineStrip stages={oc.stages} compact />
    </section>
  );
}
