import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { forecastRows } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, Field, Input, PageHeader, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { decideOverrideAction, submitOverrideAction } from "../actions";
import { SubNav } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales guess" };

function months(start: string, n: number) {
  const [y, m] = start.split("-").map(Number);
  return Array.from({ length: n }, (_, k) => new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 10));
}
const monthName = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const OVERRIDE_WORD: Record<string, string> = { submitted: "waiting for a second person", approved: "approved", rejected: "not approved", superseded: "replaced" };

/**
 * Forecast assumptions and overrides (US-6-20, docs/ux-system.md §9.15, docs/analytics-kpis.md §6) as "Sales guess".
 * Every figure here is an estimate: never an actual, never a hero KPI, never an automatic order. A product without
 * enough history shows the reason and no number.
 */
export default async function ForecastPage() {
  const ctx = await requireContext();
  if (!ctx.can("analytics.forecast.view")) return <Forbidden what="sales guesses" />;
  const f = await forecastRows(ctx);
  const canEdit = ctx.allowedSiteIds.some((s) => ctx.canAt("analytics.forecast.edit", s));
  const canApprove = ctx.allowedSiteIds.some((s) => ctx.canAt("analytics.forecast.approve", s));
  const periods = months(f.nextPeriodStart, f.horizonMonths);
  const toDecide = canApprove ? f.rows.flatMap((r) => r.overrides.filter((o) => o.status === "submitted")) : [];
  return (
    <>
      <PageHeader title="Sales guess" />
      <PageIntro>This screen is for a guess of how much of each product we may sell next month, from past customer orders. It is only a guess: nothing is ordered from it. If you know better, change the number; a second person approves it.</PageIntro>
      {toDecide.length > 0 && <NextStep text={`Next: ${toDecide.length} changed guess(es) wait for your approval.`} action={{ label: "Open the list", href: "#guesses" }} />}
      <SubNav />
      <div className="flex flex-col gap-5">
        <Banner tone="warn" title={f.banner}>
          Based on confirmed customer orders by month ({f.historyMonths} months back, {f.horizonMonths} month(s) ahead). <span className="text-[13px]">We try several ways and show the one that would have guessed best over the last 3 months.</span>
        </Banner>
        <Card>
          <span id="guesses" className="block scroll-mt-24" />
          <CardTitle>Guess for {monthName(f.nextPeriodStart)}</CardTitle>
          {f.rows.length === 0 ? (
            <EmptyState title="No sales history yet">A guess appears once customers have confirmed orders for a product at your sites.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line">
              {f.rows.map((r) => (
                <li key={`${r.siteId}-${r.productId}`} className="px-4 py-3">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{r.productName}</span>
                    <span className="font-mono text-[12px] text-muted">
                      {r.sku} · {r.siteCode}
                    </span>
                  </p>
                  {r.forecast.sufficient ? (
                    <>
                      <p className="mt-1 text-[16px]">
                        <Chip tone="info">Guess</Chip> about <strong className="tabular-nums">{r.forecast.next}</strong> {r.baseUom}
                        {r.forecast.band ? <span className="text-[14px] text-fg-2"> (likely {r.forecast.band.p10}–{r.forecast.band.p90})</span> : null}
                        {r.forecast.intermittent && <span className="ml-1"><Chip tone="warn">sells now and then</Chip></span>}
                      </p>
                      <details>
                        <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[14px] text-primary-text">How good is this guess</summary>
                        <p className="text-[13px] text-fg-2">
                          Way: {r.forecast.methodLabel}
                          {r.forecast.alpha !== null && ` (α ${r.forecast.alpha})`} · {r.forecast.historyMonths} months of history · off by {r.forecast.metrics.wape ?? "—"} % on average (MAE {r.forecast.metrics.mae}, bias {r.forecast.metrics.bias ?? "—"} %)
                          {!r.forecast.band && r.forecast.bandText ? ` · ${r.forecast.bandText}` : ""}
                        </p>
                        {r.forecast.others.length > 0 && <p className="text-[12px] text-muted">Other ways: {r.forecast.others.map((o) => `${o.method} ${o.wape ?? "—"} %`).join(", ")}</p>}
                      </details>
                    </>
                  ) : (
                    <p className="mt-1 text-[14px] text-fg-2">{r.forecast.text}</p>
                  )}
                  {r.overrides.map((o) => (
                    <div key={o.id} className="mt-2 rounded-[10px] bg-surface-2 p-3 text-[14px]">
                      <p>
                        <Chip tone={o.status === "approved" ? "ok" : o.status === "submitted" ? "appr" : "neu"}>Changed · {OVERRIDE_WORD[o.status] ?? o.status}</Chip> {monthName(o.periodStart)}: <strong>{Number(o.overrideQty).toLocaleString("en-PH")}</strong> (guess was {o.baselineQty !== null ? Number(o.baselineQty).toLocaleString("en-PH") : "none"}) — {o.reason}
                      </p>
                      <p className="text-[12px] text-muted">
                        {o.submittedByName}, {fmtDateTime(o.submittedAt)}
                      </p>
                      {canApprove && o.status === "submitted" && (
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <ActionForm action={decideOverrideAction} hidden={{ overrideId: o.id, decision: "approved" }} submit="Approve" variant="cta" />
                          <ActionForm action={decideOverrideAction} hidden={{ overrideId: o.id, decision: "rejected" }} submit="Do not approve" variant="secondary">
                            <Input name="note" placeholder="Why not" aria-label="Why not" required />
                          </ActionForm>
                        </div>
                      )}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canEdit && f.rows.length > 0 && (
          <Card>
            <CardTitle>I know better: change a guess</CardTitle>
            <ActionForm action={submitOverrideAction} submit="Send for approval" variant="secondary">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Product" htmlFor="sku">
                  <Select id="sku" name="productId" required defaultValue="">
                    <option value="" disabled>
                      Pick a product…
                    </option>
                    {[...new Map(f.rows.map((r) => [r.productId, r])).values()].map((r) => (
                      <option key={r.productId} value={r.productId}>
                        {r.productName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Month" htmlFor="periodStart">
                  <Select id="periodStart" name="periodStart" defaultValue={periods[0]}>
                    {periods.map((p) => (
                      <option key={p} value={p}>
                        {monthName(p)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="How many we will sell" htmlFor="overrideQty">
                  <Input id="overrideQty" name="overrideQty" inputMode="numeric" required />
                </Field>
                <Field label="Why you know better" htmlFor="reason">
                  <Input id="reason" name="reason" required placeholder="For example: big order promised by a customer" />
                </Field>
              </div>
              <MoreDetails>
                <Field label="Site" htmlFor="siteId">
                  <Select id="siteId" name="siteId" defaultValue={ctx.currentSiteId}>
                    {ctx.allowedSites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </MoreDetails>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
