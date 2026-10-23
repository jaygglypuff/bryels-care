import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, ClipboardCheck, Minus, Plus } from "lucide-react";
import type { ActivityRow, BoardCard, NearExpiryLot, OwnerDashboard } from "@/modules/analytics";
import { BOARD_LIMIT, NEAR_EXPIRY_WINDOW_DAYS } from "@/modules/analytics";
import { Card, EmptyState, Table, Td, cx } from "@/ui/core";
import { StatusChip } from "@/ui/status";
import { D, fmtDate, fmtDateTime, fmtMass, fmtMoney, fmtQty } from "@/lib/qty";
import { actionLabel, actionModule, entityHref, moduleLabel } from "../admin/audit/format";
import { Donut, Meter, Sparkline } from "./charts";

const fmtInt = (n: number) => n.toLocaleString("en-PH");
const plural = (n: number, one: string, many = one + "s") => `${fmtInt(n)} ${n === 1 ? one : many}`;

function fmtOnHand(qty: string, uom: string) {
  if (uom === "g") return fmtMass(qty);
  if (uom === "pcs") return fmtQty(qty, "pcs", 0);
  return fmtQty(qty, uom);
}

/** KPI card (style tile .kpi): caption, value, delta/hint, chart, definition line. The whole card drills down. */
function KpiCard({
  caption,
  value,
  unit,
  hint,
  tone = "neutral",
  chart,
  definition,
  href,
  linkLabel,
}: {
  caption: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
  chart?: ReactNode;
  definition: ReactNode;
  href: string;
  linkLabel: string;
}) {
  const toneCls = tone === "good" ? "text-[var(--ok-fg)]" : tone === "warn" ? "text-[var(--warn-fg)]" : tone === "bad" ? "text-[var(--bad-fg)]" : "text-fg-2";
  return (
    <Link href={href} aria-label={`${caption}: open ${linkLabel}`} className="group block h-full rounded-[24px]">
      <Card className="flex h-full flex-col gap-2 transition-shadow group-hover:shadow-[var(--shadow-pop)]">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[.04em] text-fg-2">{caption}</span>
          <ArrowRight size={16} className="mt-0.5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
        </div>
        <div className="tabular font-display text-[36px] font-semibold leading-[42px] tracking-[-.01em] text-fg">
          {value}
          {unit && <small className="ml-1 text-[16px] font-medium tracking-normal text-fg-2">{unit}</small>}
        </div>
        {hint && <div className={cx("flex items-center gap-1 text-[13px] font-medium leading-[18px]", toneCls)}>{hint}</div>}
        {chart && <div className="mt-1">{chart}</div>}
        <p className="mt-auto pt-1 text-[12px] leading-4 text-muted">{definition}</p>
      </Card>
    </Link>
  );
}

function Delta({ now, prev }: { now: number; prev: number }) {
  const d = now - prev;
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  return (
    <>
      <Icon size={15} aria-hidden />
      {d === 0 ? "Same as" : `${d > 0 ? "+" : "−"}${fmtInt(Math.abs(d))} vs`} previous 7 days
    </>
  );
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
      href={`/production/${b.id}`}
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
              <Link href="/production" className="px-1.5 text-[12px] font-medium text-primary-text hover:underline">
                +{cards.length - BOARD_LIMIT} more in Batches
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

// ---------- fulfilment ----------

const ORDER_COLOURS: Record<string, string> = {
  draft: "#b9c2b2", // neutral sage
  confirmed: "#8dc63f", // --lime-400 (brand light green)
  allocated: "#4f9d34", // --brand-500
  shipped: "#27581c", // --brand-800 (brand deep green)
};
const ORDER_LABEL: Record<string, string> = { draft: "Draft", confirmed: "Confirmed", allocated: "Allocated", shipped: "Shipped" };

function Fulfilment({ data }: { data: NonNullable<OwnerDashboard["fulfilment"]> }) {
  if (data.total === 0)
    return (
      <EmptyState title="No orders in the last 30 days">
        {data.cancelled > 0 ? `${plural(data.cancelled, "order")} cancelled in the period.` : "Orders created in the last 30 days appear here by status."}
      </EmptyState>
    );
  const segs = data.byStatus.filter((s) => s.count > 0).map((s) => ({ key: s.status, label: ORDER_LABEL[s.status], value: s.count, color: ORDER_COLOURS[s.status] }));
  const pct = (n: number) => D(n).div(data.total).mul(100).toFixed(0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center lg:flex-col 2xl:flex-row">
      <Donut
        segments={segs}
        centre={fmtInt(data.total)}
        centreLabel={data.total === 1 ? "order" : "orders"}
        ariaLabel={`Orders created in the last 30 days by status: ${segs.map((s) => `${s.label} ${s.value}`).join(", ")}`}
      />
      <ul className="grid w-full gap-1.5 text-[13px]">
        {segs.map((s) => (
          <li key={s.key}>
            <Link href="/sales" className="grid grid-cols-[12px_1fr_auto] items-center gap-2 rounded-[8px] px-1.5 py-1 hover:bg-surface-2">
              <span className="size-3 rounded-[3px]" style={{ background: s.color }} aria-hidden />
              <StatusChip status={s.key} className="justify-self-start" />
              <span className="tabular whitespace-nowrap font-medium text-fg">
                {fmtInt(s.value)} · {pct(s.value)} %
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
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

// ---------- page body ----------

export function OwnerOverview({ data, canAudit }: { data: OwnerDashboard; canAudit: boolean }) {
  const { orders, output, fefo, qa, board, nearExpiry, fulfilment, activity, scope, timezone: tz } = data;
  const showSite = scope.all;
  const tzNote = tz === "Asia/Manila" ? "Manila time" : tz;
  const any = orders || output || fefo || qa || board || nearExpiry || fulfilment || activity;
  if (!any) return <EmptyState title="Nothing to show for your role">Your role can open the overview but none of the modules it summarises. Ask your site manager for access.</EmptyState>;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {orders && (
          <KpiCard
            caption="Orders this week"
            value={fmtInt(orders.count7)}
            unit={orders.count7 === 1 ? "order" : "orders"}
            hint={
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="text-fg">{fmtMoney(orders.value7)}</span>
                <span className="flex items-center gap-1 text-fg-2">
                  <Delta now={orders.count7} prev={orders.countPrev7} />
                </span>
              </span>
            }
            chart={
              <Sparkline
                values={orders.daily.map((d) => d.count)}
                labels={orders.daily.map((d) => fmtDate(d.day + "T12:00:00Z"))}
                ariaLabel={`Orders per day, last 14 days: ${orders.daily.map((d) => d.count).join(", ")}`}
              />
            }
            definition={`Sales orders created in the last 7 days incl. today (${tzNote}), cancelled excluded. Value = Σ qty × unit price. Chart: orders per day, 14 days.`}
            href="/sales"
            linkLabel="sales orders"
          />
        )}
        {output && (
          <KpiCard
            caption="Production output"
            value={fmtQty(output.units, "", 0)}
            unit="units"
            tone={output.yieldPct && D(output.yieldPct).lt(95) ? "warn" : "neutral"}
            hint={
              output.batches === 0
                ? "No batch completed in 30 days"
                : `${plural(output.batches, "batch", "batches")} · yield ${output.yieldPct ? D(output.yieldPct).toFixed(1) + " %" : "n/a"}${output.awaitingQc ? ` · ${fmtInt(output.awaitingQc)} awaiting QC` : ""}`
            }
            chart={
              output.batches > 0 && (
                <div className="flex flex-col gap-1">
                  <Meter
                    pct={D(output.plannedG).gt(0) ? D(output.outputG).div(output.plannedG).mul(100).toNumber() : 0}
                    ariaLabel={`${fmtMass(output.outputG)} output of ${fmtMass(output.plannedG)} planned batch size`}
                  />
                  <div className="flex flex-wrap justify-between gap-x-2 whitespace-nowrap text-[12px] text-muted tabular">
                    <span>{fmtMass(output.outputG)} out</span>
                    <span>of {fmtMass(output.plannedG)} planned</span>
                  </div>
                </div>
              )
            }
            definition="Finished units from batches completed in the last 30 days (rejected excluded). Yield = Σ actual output ÷ Σ theoretical yield (mass)."
            href="/production"
            linkLabel="batches"
          />
        )}
        {fefo && (
          <KpiCard
            caption="Stock at FEFO risk"
            value={fmtInt(fefo.releasedExpiring30)}
            unit={fefo.releasedExpiring30 === 1 ? "lot" : "lots"}
            tone={fefo.expiredOnHand > 0 ? "bad" : fefo.within14 > 0 ? "warn" : "good"}
            hint={`${fmtInt(fefo.within14)} within 14 days · ${plural(fefo.expiredOnHand, "expired lot")} on hand`}
            definition="Released lots with stock on hand expiring within 30 days. Expired: past expiry date or status Expired, stock still on hand."
            href="#near-expiry"
            linkLabel="near-expiry lots"
          />
        )}
        {qa && (
          <KpiCard
            caption="QA queue"
            value={fmtInt(qa.quarantinedLots + qa.awaitingQcBatches)}
            unit="open"
            tone={qa.oldestDays !== null && qa.oldestDays > 7 ? "warn" : "neutral"}
            hint={`${plural(qa.quarantinedLots, "lot")} quarantined · ${plural(qa.awaitingQcBatches, "batch", "batches")} awaiting QC${qa.oldestDays !== null ? ` · oldest ${plural(qa.oldestDays, "day")}` : ""}`}
            definition={`Lots in Quarantine plus batches Awaiting QC, as of now. Age from receipt or QC submission.${qa.onHoldLots ? ` ${plural(qa.onHoldLots, "lot")} on QA hold not counted.` : ""}`}
            href="/quality"
            linkLabel="QA queue"
          />
        )}
      </div>

      {board && (
        <Card aria-labelledby="board-h" id="board" className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="board-h" className="font-display text-[20px] font-semibold text-fg">Batch journey</h2>
              <p className="mt-0.5 text-[12px] text-muted">From plan to QA release. Dark card = the next action waiting on QA.</p>
            </div>
            {data.team && <TeamRow team={data.team} />}
            <div className="flex items-center gap-2">
              <Link href="/production/new" className="grid size-10 place-items-center rounded-full border border-line bg-surface text-fg-2 hover:text-fg" title="New batch" aria-label="New batch">
                <Plus size={18} />
              </Link>
              <Link href="/quality" className="grid size-10 place-items-center rounded-full border border-line bg-surface text-fg-2 hover:text-fg" title="QA queue" aria-label="QA queue">
                <ClipboardCheck size={18} />
              </Link>
              <Link href="/production" className="grid size-10 place-items-center rounded-full border border-line bg-surface text-fg-2 hover:text-fg" title="All batches" aria-label="All batches">
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

      {(fulfilment || activity) && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          {fulfilment && (
            <SectionCard
              id="fulfilment"
              title="Order fulfilment"
              aside={
                <Link href="/sales" className="font-medium text-primary-text hover:underline">
                  Orders
                </Link>
              }
            >
              <Fulfilment data={fulfilment} />
              <p className="mt-3 text-[12px] text-muted">
                Sales orders created in the last 30 days by current status{fulfilment.cancelled ? `; ${plural(fulfilment.cancelled, "cancelled order")} not shown` : ", cancelled excluded"}.
              </p>
            </SectionCard>
          )}
          {activity && (
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
          )}
        </div>
      )}

      <p className="text-center text-[12px] text-muted">
        Updated {fmtDateTime(data.generatedAt)} · {scope.label} · all figures from posted transactions
      </p>
    </div>
  );
}
