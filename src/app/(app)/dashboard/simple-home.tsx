import Link from "next/link";
import Decimal from "decimal.js";
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, ClipboardCheck, Factory, PhilippinePeso } from "lucide-react";
import type { ReactNode } from "react";
import type { ActivityRow, OperationsCenter, OwnerHome, StockAlertCounts } from "@/modules/analytics";
import { fmtDateTime } from "@/lib/qty";
import { ColumnChart } from "@/ui/charts/charts";
import { ChartFrame } from "@/ui/charts/chart-frame";
import { axisFmt, deltaOf, fmtKpi, hhmm, shortDate } from "@/ui/charts/format";
import { VIZ, slotColor } from "@/ui/charts/palette";
import { EmptyState, cx } from "@/ui/core";
import { entityHref } from "../admin/audit/format";
import { activitySentence } from "./activity-sentence";

/**
 * Owner Home parts (ADR-083 §4, mockup panel 1). Every number comes from `getOwnerHome` and opens the
 * list it was counted from (src/modules/analytics/owner-home.ts, "one source per label").
 */

/** One line of "Needs your attention": a plain sentence that opens the records behind it. */
export type AttentionItem = { key: string; text: string; href: string; urgent?: boolean };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;

/** Whole pesos for the big card number (the drill-down shows centavos). */
const peso = (v: string) => `₱${new Decimal(v).toDecimalPlaces(0).toNumber().toLocaleString("en-PH")}`;

/**
 * The owner's "needs attention" list (ADR-083), built from live counts only: decisions waiting, late
 * deliveries and orders, late batches, quality checks, and the three stock alerts. The stock lines use
 * the SAME counts as the "Stock alerts" card (`listStockAlerts`), so the two can never disagree.
 */
export function attentionItems(oc: OperationsCenter, approvals: number, stock: StockAlertCounts | null, stockHref: string): AttentionItem[] {
  const st = (k: string) => oc.stages.find((s) => s.key === k);
  const items: AttentionItem[] = [];
  if (approvals > 0) items.push({ key: "approve", text: `${plural(approvals, "thing waits", "things wait")} for your decision`, href: "/approvals", urgent: true });
  const add = (k: string, text: (n: number) => string, urgent = false) => {
    const s = st(k);
    if (s && s.attention > 0) items.push({ key: k, text: text(s.attention), href: s.attentionHref ?? s.href, urgent });
  };
  add("dispatch", (n) => `${plural(n, "customer order is", "customer orders are")} past the promised delivery date`, true);
  add("production", (n) => `${plural(n, "batch is", "batches are")} late to start`, true);
  if (stock?.lowStock) items.push({ key: "low", text: `${plural(stock.lowStock, "item is", "items are")} below the minimum stock`, href: `${stockHref}#low`, urgent: true });
  add("expected", (n) => `${plural(n, "supplier delivery is", "supplier deliveries are")} late`);
  const qc = st("qc");
  if (qc && qc.count > 0) items.push({ key: "qc", text: `${plural(qc.count, "finished batch waits", "finished batches wait")} for the quality check`, href: qc.href });
  if (stock?.onHold) items.push({ key: "hold", text: `${plural(stock.onHold, "lot is", "lots are")} on quality hold`, href: `${stockHref}#on-hold` });
  if (stock?.expiring) items.push({ key: "expiring", text: `${plural(stock.expiring, "lot expires", "lots expire")} within 30 days`, href: `${stockHref}#expiring` });
  return items;
}

const ATTENTION_MAX = 5;

function AttentionRow({ i }: { i: AttentionItem }) {
  return (
    <li>
      <Link href={i.href} className="group flex min-h-[48px] items-center gap-3 py-2 text-[15px] text-fg">
        <AlertTriangle size={18} className={cx("shrink-0", i.urgent ? "text-[var(--bad-fg)]" : "text-[var(--warn-fg)]")} aria-hidden />
        <span className="min-w-0 flex-1">{i.text}</span>
        <ArrowRight size={16} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const first = items.slice(0, ATTENTION_MAX);
  const rest = items.slice(ATTENTION_MAX);
  return (
    <section aria-labelledby="attention-h" className="rounded-[20px] border border-line bg-surface p-4 sm:p-5">
      <h2 id="attention-h" className="font-display text-[18px] font-semibold text-fg">Needs your attention</h2>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-[15px] text-fg-2">
          <CheckCircle2 size={18} className="text-primary-text" aria-hidden /> Nothing needs you right now.
        </p>
      ) : (
        <>
          <ul className="mt-1 divide-y divide-line">
            {first.map((i) => (
              <AttentionRow key={i.key} i={i} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="group">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center text-[14px] font-medium text-primary-text hover:underline group-open:hidden">See all {items.length}</summary>
              <ul className="divide-y divide-line border-t border-line">
                {rest.map((i) => (
                  <AttentionRow key={i.key} i={i} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- the four cards

const TONES = {
  green: { card: "border-[var(--ok-bd)] bg-[var(--ok-bg)]", icon: "bg-surface text-[var(--ok-fg)]" },
  blue: { card: "border-[var(--info-bd)] bg-[var(--info-bg)]", icon: "bg-surface text-[var(--info-fg)]" },
  orange: { card: "border-[var(--warn-bd)] bg-[var(--warn-bg)]", icon: "bg-surface text-[var(--warn-fg)]" },
  red: { card: "border-[var(--bad-bd)] bg-[var(--bad-bg)]", icon: "bg-surface text-[var(--bad-fg)]" },
} as const;

function HomeCard({ title, icon, tone, value, href, children, label }: { title: string; icon: ReactNode; tone: keyof typeof TONES; value: ReactNode; href: string; children?: ReactNode; label: string }) {
  const t = TONES[tone];
  return (
    <Link href={href} aria-label={label} className={cx("group flex h-full min-w-0 flex-col rounded-[18px] border p-3.5 transition-shadow hover:shadow-[var(--shadow-pop)] sm:p-4", t.card)}>
      <span className="flex items-center gap-2">
        <span className={cx("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full", t.icon)} aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 text-[13px] font-semibold leading-tight text-fg">{title}</span>
      </span>
      <span className="mt-3 block break-words font-display text-[26px] font-semibold leading-none text-fg tabular sm:text-[30px]">{value}</span>
      {children && <span className="mt-2 block text-[12.5px] leading-snug text-fg-2">{children}</span>}
    </Link>
  );
}

export function HomeCards({ home, approvals, stockHref, batchesHref }: { home: OwnerHome; approvals: number; stockHref: string; batchesHref: string }) {
  const s = home.salesToday;
  const p = home.production;
  const k = home.stock;
  const delta = s && !s.masked ? deltaOf("money", "up", s.value, s.yesterday, "yesterday") : null;
  const orderDelta = s ? s.orders - s.ordersYesterday : 0;
  return (
    <section aria-label="Today at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {s && (
        <HomeCard
          title="Sales today"
          tone="green"
          icon={<PhilippinePeso size={16} />}
          href={s.href}
          label={s.masked ? `Sales today: ${s.orders} orders confirmed` : `Sales today: ${fmtKpi("money", s.value)}`}
          value={s.masked ? plural(s.orders, "order", "orders") : peso(s.value ?? "0")}
        >
          {s.masked ? (
            <>Confirmed today ({orderDelta === 0 ? "same as" : orderDelta > 0 ? `${orderDelta} more than` : `${-orderDelta} fewer than`} yesterday). Values hidden for your role.</>
          ) : (
            <>
              {plural(s.orders, "order", "orders")} confirmed
              {delta && <span className={cx("block", delta.tone === "good" ? "text-[var(--ok-fg)]" : delta.tone === "bad" ? "text-[var(--bad-fg)]" : "text-fg-2")}>{delta.text}</span>}
            </>
          )}
        </HomeCard>
      )}
      {p && (
        <HomeCard
          title="Production progress"
          tone="blue"
          icon={<Factory size={16} />}
          href={batchesHref}
          label={`Production progress: ${p.done} of ${p.total} batches done this week`}
          value={p.pct === null ? "—" : `${p.pct}%`}
        >
          {p.done} of {p.total} {p.total === 1 ? "batch" : "batches"} done this week
          <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-surface" role="img" aria-label={`${p.pct ?? 0}% of this week's batches released by QA`}>
            <span className="block h-full rounded-full" style={{ width: `${p.pct ?? 0}%`, background: slotColor(2) }} />
          </span>
        </HomeCard>
      )}
      {k && (
        <HomeCard title="Stock alerts" tone="orange" icon={<Boxes size={16} />} href={stockHref} label={`Stock alerts: ${k.total}`} value={k.total.toLocaleString("en-PH")}>
          {[
            k.lowStock !== null ? `${k.lowStock} low` : null,
            k.expiring !== null ? `${k.expiring} expiring ≤30 days` : null,
            k.onHold !== null ? `${k.onHold} on hold` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </HomeCard>
      )}
      <HomeCard title="Waiting for your approval" tone="red" icon={<ClipboardCheck size={16} />} href="/approvals" label={`Waiting for your approval: ${approvals}`} value={approvals.toLocaleString("en-PH")}>
        {approvals === 0 ? "Nothing to decide" : approvals === 1 ? "Needs your decision" : "Need your decision"}
      </HomeCard>
    </section>
  );
}

// ---------------------------------------------------------------- sales this week

const weekday = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

export function SalesWeek({ week, scopeLabel, generatedAt }: { week: NonNullable<OwnerHome["salesWeek"]>; scopeLabel: string; generatedAt: string }) {
  const unit = week.unit;
  const values = week.days.map((d) => Number(d.value));
  const fmt = unit === "money" ? axisFmt("money") : (v: number) => v.toLocaleString("en-PH", { maximumFractionDigits: 0 });
  const total = week.days.reduce((s, d) => s.plus(d.value), new Decimal(0)).toString();
  return (
    <ChartFrame
      title="Sales this week"
      subtitle={
        <>
          {unit === "money" ? `${fmtKpi("money", total)} in the last 7 days` : `${plural(Number(total), "order", "orders")} confirmed in the last 7 days`} · Actual (confirmed orders, no estimates)
        </>
      }
      meta={
        <>
          Updated {hhmm(generatedAt)} · {scopeLabel} ·{" "}
          <Link href={week.href} className="font-medium text-primary-text hover:underline">
            See the orders
          </Link>
        </>
      }
      chart={
        <>
          <div className="hidden sm:block">
            <ColumnChart series={[{ key: "v", label: unit === "money" ? "Order value" : "Orders", color: slotColor(1), values }]} labels={week.days.map((d) => weekday(d.date))} fmt={fmt} ariaLabel={`Sales per day, last 7 days: ${week.days.map((d) => `${shortDate(d.date)} ${unit === "money" ? fmtKpi("money", d.value) : d.value}`).join(", ")}`} height={180} />
          </div>
          {/* Phones: the scaled SVG's labels would be too small to read, so the same bars are drawn in HTML. */}
          <PhoneBars days={week.days} values={values} fmt={fmt} />
        </>
      }
      table={
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Orders</th>
              {unit === "money" && <th className="py-1 text-right font-medium">Value</th>}
            </tr>
          </thead>
          <tbody>
            {week.days.map((d) => (
              <tr key={d.date} className="border-t border-line">
                <td className="py-1">{weekday(d.date)} {shortDate(d.date)}</td>
                <td className="py-1 text-right tabular">{d.orders}</td>
                {unit === "money" && <td className="py-1 text-right tabular">{fmtKpi("money", d.value)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}

/** Seven readable columns for phones (zero baseline, value on every non-empty day). */
function PhoneBars({ days, values, fmt }: { days: { date: string }[]; values: number[]; fmt: (v: number) => string }) {
  const max = Math.max(0, ...values);
  return (
    <div className="flex h-[150px] items-end gap-1.5 border-b border-line-strong sm:hidden" aria-hidden>
      {days.map((d, i) => (
        <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
          {values[i] > 0 && <span className="mb-0.5 text-[10.5px] font-semibold tabular text-fg">{fmt(values[i])}</span>}
          <span className="block w-full max-w-[28px] rounded-t-[4px]" style={{ height: max > 0 ? `${(values[i] / max) * 100 * 0.75}%` : 0, background: slotColor(1) }} />
          <span className="mt-1 text-[11px] text-muted">{weekday(d.date)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- production by stage

const PART_COLOURS = [slotColor(1), slotColor(2), slotColor(5), VIZ.neutral];

/** Compact list of the Operations Center stages: count, its split and a bar of the split. */
export function ProductionByStage({ oc, all }: { oc: OperationsCenter; all: boolean }) {
  if (oc.stages.length === 0) return null;
  const max = Math.max(1, ...oc.stages.map((s) => s.count));
  return (
    <section aria-labelledby="stages-h" className="min-w-0 rounded-[24px] bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="stages-h" className="font-display text-[17px] font-semibold text-fg">Production by stage</h2>
        <Link href={all ? "/operations?scope=all" : "/operations"} className="text-[13px] font-medium text-primary-text hover:underline">
          Operations Center
        </Link>
      </div>
      <ul className="divide-y divide-line">
        {oc.stages.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className="group block py-2">
              <span className="flex items-baseline justify-between gap-2 text-[14px]">
                <span className="min-w-0 font-medium text-fg">{s.label}</span>
                <span className="shrink-0 font-semibold tabular text-fg">{s.count.toLocaleString("en-PH")}</span>
              </span>
              <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-2" style={{ width: `${Math.max(4, (s.count / max) * 100)}%` }} aria-hidden>
                {s.count > 0 && s.parts.map((p, i) => (p.n > 0 ? <span key={p.label} style={{ width: `${(p.n / s.count) * 100}%`, background: PART_COLOURS[i % PART_COLOURS.length] }} /> : null))}
              </span>
              {s.parts.length > 1 && (
                <span className="mt-0.5 block text-[12px] text-muted">
                  {s.parts.map((p) => `${p.n} ${p.label}`).join(" · ")}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- recent activity

export function RecentActivity({ rows, showSite }: { rows: ActivityRow[]; showSite: boolean }) {
  return (
    <section aria-labelledby="activity-h" className="min-w-0 rounded-[24px] bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="activity-h" className="font-display text-[17px] font-semibold text-fg">Recent activity</h2>
        <Link href="/admin/audit" className="text-[13px] font-medium text-primary-text hover:underline">
          Full history
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing has happened yet">Receipts, batches, quality decisions and orders appear here.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const s = activitySentence(r);
            const href = entityHref(r.entityType, r.entityId);
            return (
              <li key={r.id} className="py-2.5">
                <p className="text-[14px] text-fg">
                  <span className="font-medium">{s.who}</span> {s.text}
                  {s.number &&
                    (href ? (
                      <>
                        {" "}
                        <Link href={href} className="font-medium text-primary-text hover:underline">
                          {s.number}
                        </Link>
                      </>
                    ) : (
                      <span className="font-medium"> {s.number}</span>
                    ))}
                </p>
                <p className="text-[12px] text-muted">
                  {fmtDateTime(r.occurredAt)}
                  {showSite && r.siteCode && ` · ${r.siteCode}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
