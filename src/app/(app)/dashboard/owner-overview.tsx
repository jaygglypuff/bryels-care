import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CalendarDays, ClipboardCheck, Plus } from "lucide-react";
import type { ActivityRow, BoardCard, NearExpiryLot, OwnerDashboard, OwnerOverview as OwnerKpis } from "@/modules/analytics";
import { BOARD_LIMIT, NEAR_EXPIRY_WINDOW_DAYS } from "@/modules/analytics";
import { Card, EmptyState, Table, Td, cx } from "@/ui/core";
import { StatusChip } from "@/ui/status";
import { fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import { Donut } from "@/ui/charts/charts";
import { ChartFrame } from "@/ui/charts/chart-frame";
import { fmtKpi, hhmm } from "@/ui/charts/format";
import { VIZ } from "@/ui/charts/palette";
import { actionLabel, actionModule, entityHref, moduleLabel } from "../admin/audit/format";
import { CategoryChip, KpiCard, LockedCard, RecordRef, StaleNotice, UnavailableCard, periodText, plainKpi, scopeText } from "../analytics/kpi-ui";

/**
 * Owner overview (docs/ux-system.md §9.2, US-5-02). The KPI rows come from the KPI engine
 * (KPI-OWN-01..13; each card opens the records behind it), the Batch journey board and near-expiry
 * lots from the live operational read model, order fulfilment is the OTIF donut with its table
 * twin, then exceptions and the site comparison (KPI-OWN-14: only the caller's sites, "n/a" where a
 * column is masked or not recorded yet).
 */

const fmtInt = (n: number) => n.toLocaleString("en-PH");
const plural = (n: number, one: string, many = one + "s") => `${fmtInt(n)} ${n === 1 ? one : many}`;

function fmtOnHand(qty: string, uom: string) {
  if (uom === "g") return fmtMass(qty);
  if (uom === "pcs") return fmtQty(qty, "pcs", 0);
  return fmtQty(qty, uom);
}

function SectionCard({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card aria-labelledby={`${id}-h`} id={id} className="min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`${id}-h`} className="font-display text-[18px] font-semibold text-fg">
          {title}
        </h2>
        {aside && <div className="text-[12px] text-muted">{aside}</div>}
      </div>
      {children}
    </Card>
  );
}

// ---------- production board ----------

function BatchCard({ b, showSite, highlight }: { b: BoardCard; showSite: boolean; highlight?: boolean }) {
  const pct = b.stepsTotal > 0 ? (b.stepsDone / b.stepsTotal) * 100 : 0;
  const running = (b.status === "in_process" || b.status === "materials_staged") && b.stepsTotal > 0;
  return (
    <Link
      href={b.workOrderId ? `/production/orders/${b.workOrderId}` : `/production/${b.id}`}
      className={cx(
        "group block rounded-[18px] p-3.5 transition-all",
        highlight ? "bg-cta text-white shadow-[var(--shadow-pop)] hover:-translate-y-0.5" : "bg-surface shadow-[var(--shadow-card)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cx("font-mono text-[12.5px]", highlight ? "text-white/80" : "text-fg-2")}>{b.batchNumber}</span>
        {showSite && <span className={cx("text-[11px] font-semibold", highlight ? "text-white/70" : "text-muted")}>{b.siteCode}</span>}
      </div>
      <p className={cx("mt-1.5 font-display text-[14.5px] font-semibold leading-5", highlight ? "text-white" : "text-fg")}>{b.productName}</p>
      <p className={cx("mt-0.5 text-[12px] leading-4", highlight ? "text-white/75" : "text-muted")}>
        {fmtMass(b.plannedSizeG)} · {b.meta}
        {running && ` · step ${Math.min(b.stepsDone + 1, b.stepsTotal)} of ${b.stepsTotal}`}
      </p>
      {running && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--lime-100)]" role="img" aria-label={`${b.stepsDone} of ${b.stepsTotal} steps completed`}>
          <i className="block h-full rounded-full" style={{ width: `${pct.toFixed(1)}%`, background: "linear-gradient(90deg, var(--brand-600), var(--lime-400))" }} />
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between">
        {highlight ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[12px] font-medium">Next: QA review</span>
        ) : (
          <StatusChip status={b.status} />
        )}
        <ArrowRight size={15} className={cx("transition-transform group-hover:translate-x-0.5", highlight ? "text-white/80" : "text-muted")} aria-hidden />
      </div>
    </Link>
  );
}

const AVATAR_TONES = ["#d3ecaf", "#bfe0a8", "#e8f5d3", "#fdead2", "#e0ecfa", "#ece5fa", "#d9f0ec", "#fbe3e1"];

function TeamRow({ team }: { team: NonNullable<OwnerDashboard["team"]> }) {
  if (team.length === 0) return null;
  return (
    <div className="flex items-center" aria-label="People who posted work in the last 30 days">
      {team.map((t, i) => (
        <div key={t.userId} className="relative -ml-2 first:ml-0" title={`${t.name} · ${t.actions} actions in 30 days`}>
          <span
            className="grid size-10 place-items-center rounded-full text-[12px] font-semibold ring-[3px] ring-white"
            style={{ background: AVATAR_TONES[i % AVATAR_TONES.length], color: "var(--brand-900)" }}
          >
            {t.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
          </span>
          <span
            className="absolute -bottom-1 left-1/2 grid min-w-[18px] -translate-x-1/2 place-items-center rounded-full px-1 text-[10px] font-semibold leading-[18px] text-white ring-2 ring-white"
            style={{ background: i === 0 ? "var(--brand-600)" : i < 3 ? "var(--lime-500)" : "#9aa594" }}
          >
            {t.actions}
          </span>
        </div>
      ))}
    </div>
  );
}

function Board({ board, showSite }: { board: NonNullable<OwnerDashboard["board"]>; showSite: boolean }) {
  const cols: [string, BoardCard[], string][] = [
    ["Planned", board.planned, "No batches planned."],
    ["In process", board.inProcess, "Nothing on the line."],
    ["Awaiting QC", board.awaitingQc, "No batches waiting for QC."],
    ["Released · 14 days", board.released, "No batch released in the last 14 days."],
  ];
  return (
    <div className="-mx-1 flex snap-x snap-mandatory gap-5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
      {cols.map(([title, cards, empty], ci) => (
        <div key={title} className="relative flex w-[78%] min-w-0 shrink-0 snap-start flex-col sm:w-[46%] lg:w-auto">
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 rounded-[22px] bg-surface-2 p-3">
            {cards.length === 0 && <p className="px-1.5 py-6 text-center text-[12px] text-muted">{empty}</p>}
            {cards.slice(0, BOARD_LIMIT).map((b, i) => (
              <BatchCard key={b.id} b={b} showSite={showSite} highlight={title === "Awaiting QC" && i === 0} />
            ))}
            {cards.length > BOARD_LIMIT && (
              <Link href="/production/orders?status=all" className="px-1.5 text-[12px] font-medium text-primary-text hover:underline">
                +{cards.length - BOARD_LIMIT} more in Production orders
              </Link>
            )}
          </div>
          <p className="mt-3 text-center font-display text-[13px] font-medium text-fg">
            {title} <span className="tabular text-muted">· {cards.length}</span>
          </p>
          {ci < cols.length - 1 && (
            <svg aria-hidden="true" className="absolute -right-[18px] top-1/2 hidden h-6 w-[16px] -translate-y-1/2 lg:block" viewBox="0 0 16 24">
              <path d="M0 12 H12" stroke="var(--border-strong)" strokeWidth="1.5" strokeDasharray="2 2.5" />
              <circle cx="13" cy="12" r="2.5" fill="var(--brand-600)" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- near-expiry ----------

function ExpiryText({ l }: { l: NearExpiryLot }) {
  const d = l.daysToExpiry;
  const tone = d < 0 ? "text-[var(--bad-fg)]" : d <= 14 ? "text-[var(--warn-fg)]" : "text-fg";
  const rel = d < 0 ? `expired ${plural(-d, "day")} ago` : d === 0 ? "expires today" : `in ${plural(d, "day")}`;
  return (
    <span className={cx("tabular", tone)}>
      {fmtDate(l.expiresOn)} <span className="text-[12px] font-medium">· {rel}</span>
    </span>
  );
}

function NearExpiry({ data, showSite }: { data: NonNullable<OwnerDashboard["nearExpiry"]>; showSite: boolean }) {
  if (data.rows.length === 0)
    return <EmptyState title="No lots near expiry">No lot with stock on hand expires within {NEAR_EXPIRY_WINDOW_DAYS} days, and none is past its expiry date.</EmptyState>;
  return (
    <>
      <div className="hidden md:block">
        <Table head={["Lot", "Item", "Expiry", "On hand", "Location", "Status"]}>
          {data.rows.map((l) => (
            <tr key={l.id} className="hover:bg-surface-2">
              <Td>
                <Link href={`/inventory/${l.id}`} className="whitespace-nowrap font-mono text-primary-text hover:underline">
                  {l.lotNumber}
                </Link>
                {showSite && <span className="ml-1.5 text-[11px] font-semibold text-muted">{l.siteCode}</span>}
              </Td>
              <Td>{l.itemName}</Td>
              <Td>
                <ExpiryText l={l} />
              </Td>
              <Td className="whitespace-nowrap text-right tabular">{fmtOnHand(l.onHand, l.uom)}</Td>
              <Td className="font-mono text-[12px]">{l.locations}</Td>
              <Td>
                <StatusChip status={l.status} />
              </Td>
            </tr>
          ))}
        </Table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {data.rows.map((l) => (
          <li key={l.id}>
            <Link href={`/inventory/${l.id}`} className="block rounded-[12px] border border-line p-3 hover:border-line-strong">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[13px] text-primary-text">{l.lotNumber}</span>
                <StatusChip status={l.status} />
              </div>
              <p className="mt-1 text-[14px] font-medium text-fg">{l.itemName}</p>
              <p className="mt-1 text-[13px]">
                <ExpiryText l={l} />
              </p>
              <p className="mt-1 text-[12px] text-muted">
                {fmtOnHand(l.onHand, l.uom)} · <span className="font-mono">{l.locations}</span>
                {showSite && ` · ${l.siteCode}`}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {data.total > data.rows.length && (
        <p className="mt-2 text-[12px] text-muted">
          Showing the {data.rows.length} soonest of {data.total} lots.{" "}
          <Link href="/inventory" className="font-medium text-primary-text hover:underline">
            See all lots
          </Link>
        </p>
      )}
    </>
  );
}
// ---------- activity ----------

function Activity({ rows, showSite }: { rows: ActivityRow[]; showSite: boolean }) {
  if (rows.length === 0) return <EmptyState title="No activity yet">Posted receipts, batches, QA decisions and orders appear here.</EmptyState>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const href = entityHref(r.entityType, r.entityId);
        return (
          <li key={r.id} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 w-[88px] shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-center text-[11px] font-semibold text-fg-2">{moduleLabel(actionModule(r.action))}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-fg">
                {actionLabel(r.action)}
                {r.entityNumber &&
                  (href ? (
                    <>
                      {" "}
                      <Link href={href} className="font-mono text-primary-text hover:underline">
                        {r.entityNumber}
                      </Link>
                    </>
                  ) : (
                    <span className="font-mono"> {r.entityNumber}</span>
                  ))}
              </p>
              <p className="text-[12px] text-muted">
                {r.actorName ?? "System"} · {fmtDateTime(r.occurredAt)}
                {showSite && r.siteCode && ` · ${r.siteCode}`}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}


// ---------- OTIF donut ----------

const OTIF_COLOURS: Record<string, string> = { on_time: VIZ.good, late: VIZ.bad, open: VIZ.neutral };

function Fulfilment({ kpi }: { kpi: OwnerKpis }) {
  const t = kpi.tiles["KPI-SAL-02"];
  if (t.masked) return <LockedCard title="Order fulfilment" />;
  const meta = `Updated ${hhmm(kpi.generatedAt)} · ${scopeText(kpi.scope)} · orders due ${periodText(kpi.period)}`;
  const segs = (t.breakdown ?? []).map((b) => ({ key: b.key, label: b.label, value: b.rows, color: OTIF_COLOURS[b.key] ?? VIZ.neutral }));
  const total = segs.reduce((a, s) => a + s.value, 0);
  const pct = (n: number) => (total ? `${((n / total) * 100).toFixed(0)} %` : "—");
  const table = (
    <Table head={["Outcome", "Orders", "Share"]}>
      {segs.map((s) => (
        <tr key={s.key}>
          <Td>{s.label}</Td>
          <Td className="text-right tabular">{fmtInt(s.value)}</Td>
          <Td className="text-right tabular">{pct(s.value)}</Td>
        </tr>
      ))}
      <tr className="font-semibold">
        <Td>Due in the period</Td>
        <Td className="text-right tabular">{fmtInt(total)}</Td>
        <Td className="text-right tabular">On time {fmtKpi("ratio", t.current?.value)}</Td>
      </tr>
    </Table>
  );
  const chart =
    total === 0 ? (
      <EmptyState title="No orders due in this period">Orders appear here by their requested delivery date.</EmptyState>
    ) : (
      <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col 2xl:flex-row">
        <Donut segments={segs} centre={fmtKpi("ratio", t.current?.value)} centreLabel="on time" ariaLabel={`Orders due: ${segs.map((s) => `${s.label} ${s.value}`).join(", ")}`} />
        <ul className="grid w-full gap-1.5 text-[13px]">
          {segs.map((s) => (
            <li key={s.key}>
              <Link href={t.href} className="grid grid-cols-[12px_1fr_auto] items-center gap-2 rounded-[8px] px-1.5 py-1 hover:bg-surface-2">
                <span className="size-3 rounded-[3px]" style={{ background: s.color }} aria-hidden />
                <span className="text-fg">{s.label}</span>
                <span className="tabular whitespace-nowrap font-medium text-fg">
                  {fmtInt(s.value)} · {pct(s.value)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  return <ChartFrame title="Order fulfilment" subtitle="Orders due in this period: sent on time and complete, late, or still open" chart={chart} table={table} meta={meta} />;
}

// ---------- exceptions ----------

function Exceptions({ kpi }: { kpi: OwnerKpis }) {
  if (!kpi.exceptions) return null;
  return (
    <SectionCard
      id="exceptions"
      title="Exceptions"
      aside={
        <Link href={kpi.tiles["KPI-OWN-13"].href} className="font-medium text-primary-text hover:underline">
          All open items
        </Link>
      }
    >
      {kpi.exceptions.length === 0 ? (
        <EmptyState title="Nothing needs attention">No open alert in the action centre.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {kpi.exceptions.map((e, i) => (
            <li key={`${e.refId}-${i}`} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 w-[78px] shrink-0">
                <CategoryChip category={e.category} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-fg">{e.item}</p>
                <p className="text-[12px] text-muted">
                  <RecordRef r={e} /> · {e.siteCode ?? "Organization"} · {e.at ? fmtDateTime(e.at) : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------- site comparison ----------

const COMPARISON_COLUMNS: [string, string, string][] = [
  ["KPI-OPS-01", "Made", "qty_g"],
  ["KPI-OPS-02", "Came out", "ratio"],
  ["KPI-SAL-02", "On time", "ratio"],
  ["KPI-QUA-03", "Stopped by QA", "count"],
  ["KPI-INV-04", "Expires soon", "count"],
  ["KPI-OWN-07", "Stock value", "money"],
  ["KPI-FIN-02", "Shipped value (est.)", "money"],
];

type ComparisonRow = NonNullable<OwnerKpis["comparison"]>[number];

function ComparisonCell({ r, code, unit }: { r: ComparisonRow; code: string; unit: string }) {
  const c = r.cells[code];
  if (!c || c.masked || c.unavailable)
    return (
      <span className="text-muted" title={c?.unavailable ? "Not recorded yet" : "You don't have access to this figure"}>
        n/a
      </span>
    );
  // Output: the posted output mass (numerator of KPI-OPS-01) and its share of the plan.
  if (code === "KPI-OPS-01")
    return (
      <>
        {fmtKpi("qty_g", c.numerator)} <span className="text-muted">({fmtKpi("ratio", c.value)})</span>
      </>
    );
  return <>{fmtKpi(unit, c.value)}</>;
}

function SiteComparison({ kpi }: { kpi: OwnerKpis }) {
  if (!kpi.comparison) return null;
  return (
    <SectionCard id="comparison" title="Site comparison" aside={`${periodText(kpi.period)} · your sites only`}>
      <div className="hidden md:block">
        <Table head={["Site", ...COMPARISON_COLUMNS.map(([, h]) => h)]}>
          {kpi.comparison.map((r) => (
            <tr key={r.siteId}>
              <Td>
                <span className="font-semibold">{r.siteCode}</span> <span className="text-[12px] text-muted">{r.siteName}</span>
              </Td>
              {COMPARISON_COLUMNS.map(([code, , unit]) => (
                <Td key={code} className="whitespace-nowrap text-right tabular">
                  <ComparisonCell r={r} code={code} unit={unit} />
                </Td>
              ))}
            </tr>
          ))}
        </Table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {kpi.comparison.map((r) => (
          <li key={r.siteId} className="rounded-[12px] border border-line p-3">
            <p className="font-semibold text-fg">
              {r.siteCode} <span className="text-[12px] font-normal text-muted">{r.siteName}</span>
            </p>
            <dl className="mt-1 grid grid-cols-1 gap-y-1 text-[12.5px] min-[380px]:grid-cols-2 min-[380px]:gap-x-3">
              {COMPARISON_COLUMNS.map(([code, h, unit]) => (
                <div key={code} className="flex justify-between gap-2">
                  <dt className="text-muted">{h}</dt>
                  <dd className="tabular text-right">
                    <ComparisonCell r={r} code={code} unit={unit} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-muted">n/a = not in your access, or not recorded yet (stock value needs lot unit costs, Phase 6). Ratios per site are recomputed from that site&apos;s records, never averaged.</p>
    </SectionCard>
  );
}

// ---------- page body ----------

export function OwnerOverview({ data, kpi, canAudit }: { data: OwnerDashboard; kpi: OwnerKpis; canAudit: boolean }) {
  const { board, nearExpiry, activity } = data;
  const showSite = kpi.scope.all;
  const t = kpi.tiles;
  const card = (code: string, props: Partial<Parameters<typeof KpiCard>[0]> = {}) => <KpiCard key={code} tile={t[code]} scope={kpi.scope} period={kpi.period} updated={kpi.generatedAt} {...props} />;
  const orderValue = t["KPI-SAL-01V"];
  const expired = t["KPI-INV-04E"];
  const oldest = t["KPI-QUA-03A"];
  const loss = t["KPI-OPS-03"];
  const activityCard = activity && (
    <SectionCard
      id="activity"
      title="Recent activity"
      aside={
        canAudit && (
          <Link href="/admin/audit" className="font-medium text-primary-text hover:underline">
            Audit log
          </Link>
        )
      }
    >
      <Activity rows={activity} showSite={showSite} />
    </SectionCard>
  );
  return (
    <div className="flex flex-col gap-4">
      <StaleNotice freshness={kpi.freshness} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {card("KPI-SAL-01", { hint: !orderValue.masked && orderValue.current ? <>Value {fmtKpi("money", orderValue.current.value)} at order price</> : undefined })}
        {card("KPI-OPS-01", {
          visual: "meter",
          meterOf: (x) => (
            <>
              {fmtKpi("qty_g", x.current?.numerator)} output of {fmtKpi("qty_g", x.current?.denominator)} planned
            </>
          ),
        })}
        {card("KPI-INV-04", { hint: !expired.masked && expired.current ? <>{plural(Number(expired.current.value ?? 0), "expired lot")} still on hand</> : undefined })}
        {card("KPI-QUA-03", { hint: !oldest.masked && oldest.current?.value ? <>Oldest open {fmtKpi("days", oldest.current.value)}</> : undefined })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {card("KPI-OPS-02", { hint: !loss.masked && loss.current ? <>Yield loss {fmtKpi("qty_g", loss.current.value)}</> : undefined })}
        {card("KPI-INV-07")}
        {card("KPI-FIN-02")}
        {card("KPI-OWN-13", { visual: "none" })}
        {kpi.unavailable.map((u) => (u.masked ? <LockedCard key={u.code} title={plainKpi(u.code, u.short)} /> : <UnavailableCard key={u.code} title={plainKpi(u.code, u.short)} reason={u.reason} phase={u.phase} />))}
      </div>

      {board && (
        <Card aria-labelledby="board-h" id="board" className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="board-h" className="font-display text-[20px] font-semibold text-fg">
                Batch journey
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">From plan to QA release, live. Dark card = the next action waiting on QA.</p>
            </div>
            {data.team && <TeamRow team={data.team} />}
            <div className="flex items-center gap-2">
              <Link href="/production/orders/new" className="grid size-10 place-items-center rounded-full border border-line bg-surface text-fg-2 hover:text-fg" title="New order" aria-label="New production order">
                <Plus size={18} />
              </Link>
              <Link href="/quality" className="grid size-10 place-items-center rounded-full border border-line bg-surface text-fg-2 hover:text-fg" title="QA queue" aria-label="QA queue">
                <ClipboardCheck size={18} />
              </Link>
              <Link href="/production/orders" className="grid size-10 place-items-center rounded-full border border-line bg-surface text-fg-2 hover:text-fg" title="Production orders" aria-label="Production orders">
                <CalendarDays size={18} />
              </Link>
            </div>
          </div>
          <Board board={board} showSite={showSite} />
        </Card>
      )}

      {nearExpiry && (
        <SectionCard
          id="near-expiry"
          title="Near-expiry lots"
          aside={
            <>
              Sorted by expiry · on hand, expiring within {NEAR_EXPIRY_WINDOW_DAYS} days or expired ·{" "}
              <Link href="/inventory" className="font-medium text-primary-text hover:underline">
                All lots
              </Link>
            </>
          }
        >
          <NearExpiry data={nearExpiry} showSite={showSite} />
        </SectionCard>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <Fulfilment kpi={kpi} />
        {kpi.exceptions ? <Exceptions kpi={kpi} /> : activityCard}
      </div>

      <SiteComparison kpi={kpi} />

      {kpi.exceptions && activityCard}

      <p className="text-center text-[12px] text-muted">
        Updated {fmtDateTime(kpi.generatedAt)} · {kpi.scope.label} · cards are computed from posted records; sparklines from the nightly snapshot
        {kpi.freshness.lastReconciliation &&
          ` · last reconciliation: ${kpi.freshness.lastReconciliation.mismatches === 0 ? "every number matched its records" : `${kpi.freshness.lastReconciliation.mismatches} differences reported`}`}
      </p>
    </div>
  );
}
