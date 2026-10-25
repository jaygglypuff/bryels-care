import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { forecastRows } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, Field, Input, PageHeader, Select, Table, Td } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { decideOverrideAction, submitOverrideAction } from "../actions";
import { SubNav } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forecast assumptions" };

function months(start: string, n: number) {
  const [y, m] = start.split("-").map(Number);
  return Array.from({ length: n }, (_, k) => new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 10));
}

/**
 * Forecast assumptions and overrides (US-6-20, docs/ux-system.md §9.15, docs/analytics-kpis.md §6). Every
 * figure here is an estimate: never an Actual, never a hero KPI, never an automatic order. A SKU that
 * fails the sufficiency check shows the reason and no number.
 */
export default async function ForecastPage() {
  const ctx = await requireContext();
  if (!ctx.can("analytics.forecast.view")) return <Forbidden what="forecasts" />;
  const f = await forecastRows(ctx);
  const canEdit = ctx.allowedSiteIds.some((s) => ctx.canAt("analytics.forecast.edit", s));
  const canApprove = ctx.allowedSiteIds.some((s) => ctx.canAt("analytics.forecast.approve", s));
  const periods = months(f.nextPeriodStart, f.horizonMonths);
  return (
    <>
      <PageHeader title="Forecast assumptions" subtitle={`SKU × site × month · history ${f.historyMonths} months · horizon ${f.horizonMonths} months · SES α ${f.alpha}`} />
      <SubNav />
      <div className="flex flex-col gap-5">
        <Banner tone="warn" title={f.banner}>
          Demand history is confirmed sales order quantity by the month of confirmation. The method with the lowest backtest error (WAPE over the last 3 months) is shown with its metrics; overrides need a second person before planning uses them.
        </Banner>
        <Card>
          <CardTitle>Forecast (estimate) for {f.nextPeriodStart.slice(0, 7)}</CardTitle>
          {f.rows.length === 0 ? (
            <EmptyState title="No demand history yet">Forecasts appear once confirmed sales orders exist for a SKU at your sites.</EmptyState>
          ) : (
            <Table head={["SKU", "Method", "History", "WAPE / MAE / bias", "Next month (estimate)", "Band", "Overrides"]}>
              {f.rows.map((r) => (
                <tr key={`${r.siteId}-${r.productId}`}>
                  <Td>
                    {r.sku}
                    <div className="text-[12px] text-muted">
                      {r.productName} · {r.siteCode}
                    </div>
                  </Td>
                  {r.forecast.sufficient ? (
                    <>
                      <Td className="text-[13px]">
                        {r.forecast.methodLabel}
                        {r.forecast.alpha !== null && ` (α ${r.forecast.alpha})`}
                        {r.forecast.intermittent && (
                          <div>
                            <Chip tone="warn">intermittent</Chip>
                          </div>
                        )}
                      </Td>
                      <Td>{r.forecast.historyMonths} months</Td>
                      <Td className="text-[13px]">
                        {r.forecast.metrics.wape ?? "—"} % / {r.forecast.metrics.mae} / {r.forecast.metrics.bias ?? "—"} %
                        {r.forecast.others.length > 0 && <div className="text-[12px] text-muted">others: {r.forecast.others.map((o) => `${o.method} ${o.wape ?? "—"} %`).join(", ")}</div>}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <Chip tone="info">Estimate</Chip> {r.forecast.next} {r.baseUom}
                      </Td>
                      <Td className="text-[13px]">{r.forecast.band ? `${r.forecast.band.p10}–${r.forecast.band.p90}` : r.forecast.bandText}</Td>
                    </>
                  ) : (
                    <Td colSpan={5} className="text-[13px] text-muted">
                      {r.forecast.text}
                    </Td>
                  )}
                  <Td className="text-[12px]">
                    {r.overrides.length === 0
                      ? "—"
                      : r.overrides.map((o) => (
                          <div key={o.id} className="mb-1">
                            <Chip tone={o.status === "approved" ? "ok" : o.status === "submitted" ? "appr" : "neu"}>Overridden · {o.status}</Chip> {o.periodStart.slice(0, 7)}: {o.overrideQty} (forecast {o.baselineQty ?? "none"}) — {o.reason} · {o.submittedByName} {fmtDateTime(o.submittedAt)}
                            {canApprove && o.status === "submitted" && (
                              <div className="mt-1 flex flex-wrap gap-2">
                                <ActionForm action={decideOverrideAction} hidden={{ overrideId: o.id, decision: "approved" }} submit="Approve" variant="cta" size="sm" />
                                <ActionForm action={decideOverrideAction} hidden={{ overrideId: o.id, decision: "rejected" }} submit="Reject" variant="secondary" size="sm" className="flex items-end gap-1">
                                  <Input name="note" placeholder="Reason" aria-label="Reason" required />
                                </ActionForm>
                              </div>
                            )}
                          </div>
                        ))}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {canEdit && f.rows.length > 0 && (
          <Card>
            <CardTitle>Enter an override</CardTitle>
            <ActionForm action={submitOverrideAction} submit="Submit override" variant="secondary" className="grid gap-3 sm:grid-cols-5 sm:items-end">
              <Field label="SKU and site" htmlFor="sku">
                <Select id="sku" name="productId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {f.rows.map((r) => (
                    <option key={`${r.siteId}-${r.productId}`} value={r.productId}>
                      {r.sku} · {r.siteCode}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Site" htmlFor="siteId">
                <Select id="siteId" name="siteId" defaultValue={ctx.currentSiteId}>
                  {ctx.allowedSites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Month" htmlFor="periodStart">
                <Select id="periodStart" name="periodStart" defaultValue={periods[0]}>
                  {periods.map((p) => (
                    <option key={p} value={p}>
                      {p.slice(0, 7)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity (units)" htmlFor="overrideQty">
                <Input id="overrideQty" name="overrideQty" inputMode="numeric" required />
              </Field>
              <Field label="Reason" htmlFor="reason">
                <Input id="reason" name="reason" required />
              </Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
