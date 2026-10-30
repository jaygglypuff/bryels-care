import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Clock, Info, Lock, Minus } from "lucide-react";
import type { Freshness, KpiScope, KpiTile, ListRow, PeriodDto } from "@/modules/analytics";
import { PERIOD_KEYS, PERIOD_LABELS } from "@/modules/analytics";
import { Card, EmptyState, Table, Td, cx } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Meter, Sparkline } from "@/ui/charts/charts";
import { LABEL_TEXT, deltaOf, fmtKpi, hhmm, shortDate } from "@/ui/charts/format";
import { slotColor } from "@/ui/charts/palette";

/** Shared KPI presentation for the overview, the area dashboards and the drill-down (docs/ux-system.md 5.12, 9.2). */

export function scopeText(scope: KpiScope) {
  return scope.all ? "All sites" : scope.sites[0].code;
}

export function periodText(p: PeriodDto) {
  return p.toDate === addOne(p.fromDate) ? shortDate(p.fromDate) : `${p.label} (${shortDate(p.fromDate)} – ${shortDate(minusOne(p.toDate))})`;
}
const addOne = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
const minusOne = (d: string) => new Date(Date.parse(d + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);

export function ValueLabelChip({ label }: { label: string }) {
  return label === "actual" ? (
    <span className="rounded-full border border-line px-1.5 py-0 text-[10.5px] font-semibold uppercase tracking-wide text-muted">Actual</span>
  ) : (
    <span className="rounded-full border border-dashed border-[var(--warn-bd)] bg-[var(--warn-bg)] px-1.5 py-0 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--warn-fg)]">{LABEL_TEXT[label] ?? label}</span>
  );
}

function DeltaLine({ tile, previousLabel }: { tile: KpiTile; previousLabel: string }) {
  const d = deltaOf(tile.unit, tile.better, tile.current?.value, tile.previous?.value, previousLabel);
  if (!d) return tile.previous ? <span className="text-muted">No comparison: {previousLabel} has no value</span> : null;
  const Icon = d.direction === "up" ? ArrowUpRight : d.direction === "down" ? ArrowDownRight : Minus;
  const tone = d.tone === "good" ? "text-[var(--ok-fg)]" : d.tone === "bad" ? "text-[var(--bad-fg)]" : "text-fg-2";
  return (
    <span className={cx("inline-flex items-center gap-1", tone)}>
      <Icon size={15} aria-hidden />
      {d.text}
    </span>
  );
}

/**
 * KPI card: caption, value label chip, hero value, delta with the comparison period in words, a
 * sparkline (12 nightly snapshots) or a meter, the definition, and "Updated HH:MM · scope · period".
 * The whole card opens the records the number is made of.
 */
export function KpiCard({
  tile,
  scope,
  period,
  visual = "sparkline",
  hint,
  meterOf,
  updated,
  title,
  simple = false,
}: {
  /** When the live value was computed (ISO). */
  updated: string;
  /** Plain title instead of the KPI short name (Home, ADR-083). */
  title?: string;
  /** Home card (ADR-083): title, number, change and hint only; no definition, chips or trend. */
  simple?: boolean;
  tile: KpiTile;
  scope: KpiScope;
  period: PeriodDto;
  visual?: "sparkline" | "meter" | "none";
  hint?: ReactNode;
  /** Meter caption for ratio KPIs against a plan: numerator and denominator in words. */
  meterOf?: (t: KpiTile) => ReactNode;
}) {
  if (tile.masked) return <LockedCard title={tile.short} />;
  const value = fmtKpi(tile.unit, tile.current?.value);
  const pct = tile.current?.value ? Math.min(100, Number(tile.current.value) * 100) : 0;
  const asOf = tile.kind === "asof" ? `as of ${hhmm(tile.asOf)}` : periodText(period);
  return (
    <Link href={tile.href} aria-label={`${tile.name}: ${value}. Open the records`} className="group block h-full rounded-[24px]">
      <Card className="flex h-full flex-col gap-2 transition-shadow group-hover:shadow-[var(--shadow-pop)]">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[.04em] text-fg-2">{title ?? tile.short}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {!simple && <ValueLabelChip label={tile.label} />}
            <ArrowRight size={16} className="text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
        <div className="tabular font-display text-[32px] font-semibold leading-[38px] tracking-[-.01em] text-fg">{value}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium leading-[18px]">
          <DeltaLine tile={tile} previousLabel={period.previousLabel} />
        </div>
        {hint && <div className="text-[12.5px] leading-[17px] text-fg-2">{hint}</div>}
        {visual === "meter" && tile.current?.value !== null && tile.current && (
          <div className="flex flex-col gap-1">
            <Meter pct={pct} ariaLabel={`${tile.name}: ${value}`} />
            {meterOf && <div className="text-[12px] text-muted">{meterOf(tile)}</div>}
          </div>
        )}
        {!simple && visual === "sparkline" &&
          (tile.sparkline ? (
            <Sparkline
              values={tile.sparkline.map((p) => (p.value === null ? null : Number(p.value)))}
              labels={tile.sparkline.map((p) => shortDate(p.periodStart))}
              ariaLabel={`${tile.short} per day, last 12 days: ${tile.sparkline.map((p) => fmtKpi(tile.unit, p.value)).join(", ")}`}
              dashed={tile.label !== "actual"}
              color={tile.label !== "actual" ? "#8a8f86" : slotColor(1)}
            />
          ) : (
            <p className="text-[12px] text-muted">The 12-day trend appears after the nightly snapshot.</p>
          ))}
        {simple ? (
          <p className="mt-auto pt-1 text-[12px] text-muted">{tile.label === "actual" ? asOf : `Estimate · ${asOf}`}</p>
        ) : (
          <>
            <p className="mt-auto pt-1 text-[12px] leading-4 text-muted" title={`${tile.formula}. Time basis: ${tile.timeBasis}. Sources: ${tile.sources.join(", ")}.`}>
              <Info size={12} className="mr-1 inline align-[-1px]" aria-hidden />
              {tile.definition}
            </p>
            <p className="text-[11.5px] text-muted">
              Updated {hhmm(updated)} · {scopeText(scope)} · {asOf}
            </p>
          </>
        )}
      </Card>
    </Link>
  );
}

/** A KPI the caller may not see: the card keeps its place so the layout does not reveal which KPI exists. */
export function LockedCard({ title }: { title: string }) {
  return (
    <Card className="flex h-full flex-col items-start gap-2 border border-dashed border-line-strong bg-surface-2/60 shadow-none">
      <span className="text-[12px] font-semibold uppercase tracking-[.04em] text-muted">{title}</span>
      <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-2">
        <Lock size={15} aria-hidden /> You don&apos;t have access to this figure.
      </span>
      <span className="text-[12px] text-muted">Ask your site manager or the owner if you need it.</span>
    </Card>
  );
}

/** A catalogue KPI that cannot be computed from posted data yet: says why, never shows a number. */
export function UnavailableCard({ title, reason, phase }: { title: string; reason: string; phase: string }) {
  return (
    <Card className="flex h-full flex-col items-start gap-2 border border-dashed border-line-strong bg-surface-2/60 shadow-none">
      <span className="text-[12px] font-semibold uppercase tracking-[.04em] text-muted">{title}</span>
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-2">
        <Clock size={15} aria-hidden /> Not available yet · {phase}
      </span>
      <span className="text-[12px] text-muted">{reason}</span>
    </Card>
  );
}

export function StaleNotice({ freshness }: { freshness: Freshness }) {
  if (!freshness.stale) return null;
  return (
    <Banner tone="warn" title="Trend data is stale">
      {freshness.reason} Live figures on the cards are current; sparklines and trends show the last snapshot
      {freshness.lastSnapshotAt ? ` (${new Date(freshness.lastSnapshotAt).toLocaleString("en-GB", { timeZone: "Asia/Manila", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })})` : ""}.
      {freshness.failedJobId && (
        <>
          {" "}
          <Link href={`/admin/diagnostics?job=${freshness.failedJobId}#jobs`} className="font-medium underline">
            See the failed job
          </Link>
        </>
      )}
    </Banner>
  );
}

export function freshnessMeta(freshness: Freshness, scope: KpiScope, what: string) {
  return `Updated ${freshness.lastSnapshotAt ? hhmm(freshness.lastSnapshotAt) : "—"} (nightly snapshot${freshness.lastBusinessDate ? ` to ${shortDate(freshness.lastBusinessDate)}` : ""}) · ${scopeText(scope)} · ${what}`;
}

/** Period pills and the scope picker (sites in the caller's scope; "All sites" only for owner roles). Plain links: the URL is the state. */
export function ScopePeriodBar({ basePath, scope, period, sites, canAll, extra = {} }: { basePath: string; scope: KpiScope; period: PeriodDto; sites: { id: string; code: string }[]; canAll: boolean; extra?: Record<string, string> }) {
  const href = (p: Record<string, string>) => `${basePath}?${new URLSearchParams({ ...extra, scope: scope.key, period: period.key, ...p }).toString()}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Period" className="flex flex-wrap gap-1 rounded-[20px] border border-line-strong bg-surface p-0.5">
        {PERIOD_KEYS.map((k) => (
          <Link key={k} href={href({ period: k })} aria-current={period.key === k ? "page" : undefined} className={cx("inline-flex min-h-[36px] items-center rounded-full px-3 text-[12.5px] font-medium", period.key === k ? "bg-primary-soft text-primary-text" : "text-fg-2 hover:bg-surface-2")}>
            {PERIOD_LABELS[k]}
          </Link>
        ))}
      </nav>
      {(sites.length > 1 || canAll) && (
        <nav aria-label="Sites" className="flex flex-wrap gap-1 rounded-[20px] border border-line-strong bg-surface p-0.5">
          {canAll && (
            <Link href={href({ scope: "all" })} aria-current={scope.all ? "page" : undefined} className={cx("inline-flex min-h-[36px] items-center rounded-full px-3 text-[12.5px] font-medium", scope.all ? "bg-primary-soft text-primary-text" : "text-fg-2 hover:bg-surface-2")}>
              All sites
            </Link>
          )}
          {sites.map((s) => (
            <Link key={s.id} href={href({ scope: s.id })} aria-current={!scope.all && scope.siteIds[0] === s.id ? "page" : undefined} className={cx("inline-flex min-h-[36px] items-center rounded-full px-3 text-[12.5px] font-medium", !scope.all && scope.siteIds[0] === s.id ? "bg-primary-soft text-primary-text" : "text-fg-2 hover:bg-surface-2")}>
              {s.code}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

const REF_ROUTES: Record<string, (id: string) => string> = {
  sales_order: (id) => `/sales/${id}`,
  batch: (id) => `/production/${id}`,
  work_order: (id) => `/production/work-orders/${id}`,
  lot: (id) => `/inventory/${id}`,
  goods_receipt: (id) => `/inventory/receive/${id}`,
  inspection: (id) => `/quality/inspections/${id}`,
  quality_hold: (id) => `/quality/holds/${id}`,
  deviation: (id) => `/quality/deviations/${id}`,
  notification: () => "/notifications",
  reconciliation_run: () => "/admin/diagnostics",
};

export function refHref(r: ListRow): string | null {
  return r.refId && REF_ROUTES[r.refType] ? REF_ROUTES[r.refType](r.refId) : null;
}

const REF_LABEL: Record<string, string> = {
  sales_order: "Order",
  batch: "Batch",
  work_order: "Work order",
  lot: "Lot",
  goods_receipt: "Receipt",
  inspection: "Inspection",
  quality_hold: "Hold",
  deviation: "Deviation",
  notification: "Alert",
  shipment: "Shipment",
  reconciliation_run: "Check",
};

export function RecordRef({ r }: { r: ListRow }) {
  const href = refHref(r);
  const text = r.refNumber ?? REF_LABEL[r.refType] ?? r.refType;
  return href ? (
    <Link href={href} className="whitespace-nowrap font-mono text-[12.5px] text-primary-text hover:underline">
      {text}
    </Link>
  ) : (
    <span className="whitespace-nowrap font-mono text-[12.5px]">{text}</span>
  );
}

const STATUS_CATEGORIES = new Set(["quarantine", "on_hold", "rejected", "recalled", "expired", "released", "planned", "released", "in_progress", "confirmed", "allocated", "shipped", "draft", "cancelled", "pending", "open", "investigating"]);

export function CategoryChip({ category }: { category: string | null }) {
  if (!category) return null;
  if (STATUS_CATEGORIES.has(category)) return <StatusChip status={category} label={category === "in_progress" ? "In progress" : category === "open" ? "Open" : category === "investigating" ? "Investigating" : undefined} />;
  const tone = ["on_time", "within", "covered", "right_first_time", "pass", "none"].includes(category)
    ? "ok"
    : ["late", "outside", "short", "oos", "critical", "fail", "exception", "major"].includes(category)
      ? "bad"
      : ["warning", "within_14", "minor", "open"].includes(category)
        ? "warn"
        : "neu";
  return <Chip tone={tone}>{category.replace(/_/g, " ")}</Chip>;
}

/** A compact record list (desktop table, phone cards) with links to each record. */
export function RecordList({ rows, showSite, empty, valueHeader, value }: { rows: ListRow[]; showSite: boolean; empty: string; valueHeader?: string; value?: (r: ListRow) => ReactNode }) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <>
      <div className="hidden md:block">
        <Table head={["Record", ...(showSite ? ["Site"] : []), "Item", "Detail", ...(valueHeader ? [valueHeader] : []), "Status"]}>
          {rows.map((r, i) => (
            <tr key={`${r.refId}-${i}`} className="hover:bg-surface-2">
              <Td>
                <RecordRef r={r} />
              </Td>
              {showSite && <Td className="text-[12px] font-semibold text-muted">{r.siteCode}</Td>}
              <Td>{r.item}</Td>
              <Td className="text-[12.5px] text-fg-2">{r.detail}</Td>
              {valueHeader && <Td className="whitespace-nowrap text-right tabular">{value?.(r)}</Td>}
              <Td>
                <CategoryChip category={r.category} />
              </Td>
            </tr>
          ))}
        </Table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((r, i) => (
          <li key={`${r.refId}-${i}`} className="rounded-[12px] border border-line p-3">
            <div className="flex items-start justify-between gap-2">
              <RecordRef r={r} />
              <CategoryChip category={r.category} />
            </div>
            {r.item && <p className="mt-1 text-[14px] font-medium text-fg">{r.item}</p>}
            <p className="mt-0.5 text-[12.5px] text-muted">
              {r.detail}
              {showSite && r.siteCode && ` · ${r.siteCode}`}
              {valueHeader && value && <> · {value(r)}</>}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Period-to-date text for the trends and drill-down headers. */
export function rangeText(fromDate: string, toDate: string) {
  return addOne(fromDate) === toDate ? shortDate(fromDate) : `${shortDate(fromDate)} – ${shortDate(minusOne(toDate))}`;
}
