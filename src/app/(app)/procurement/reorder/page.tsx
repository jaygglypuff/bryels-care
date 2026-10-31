import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { friendlyUnit } from "@/lib/units";
import { aslMaterialOptions, ensureReorderSuggestionsFresh, listReorderPolicies, listReorderSuggestions } from "@/modules/procurement";
import { supplierOptions } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, Field, Input, PageHeader } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { FilterTabs } from "@/ui/plain-list";
import { QtyUnitInput } from "@/ui/qty-unit-input";
import { Forbidden } from "../../forbidden";
import { acceptSuggestionAction, dismissSuggestionAction, recomputeReorderAction } from "../actions";
import { SubNav, fmtBase } from "../_ui";
import { PolicyForm } from "./policy-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Running low" };

const FILTERS = [
  ["open", "To decide"],
  ["accepted", "Asked to buy"],
  ["dismissed", "Hidden"],
  ["superseded", "Old"],
] as const;

/**
 * Reorder suggestions (US-6-04, W04-01) as "Running low". Nothing is ordered by itself: "Ask to buy" opens a
 * request to buy; hiding needs a reason. The minimum per item is configuration per site.
 */
export default async function ReorderPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.reorder_suggestion.view")) return <Forbidden what="running-low suggestions" />;
  const { status = "open" } = await searchParams;
  const canDecide = ctx.can("procurement.reorder_suggestion.approve");
  // The nightly job may not have run (demo without a worker, missed night): compute now when stale (owner QA 2026-10-30).
  const fresh = await ensureReorderSuggestionsFresh(ctx).catch(() => ({ lastComputedAt: null, computedNow: false }));
  const [rows, policies] = await Promise.all([listReorderSuggestions(ctx, { status }), listReorderPolicies(ctx)]);
  const [mats, sups] = canDecide && ctx.can("masterdata.supplier.edit") ? await Promise.all([aslMaterialOptions(ctx), supplierOptions(ctx)]) : [[], []];
  const open = status === "open" && canDecide;
  return (
    <>
      <PageHeader
        title="Running low"
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-muted">{fresh.lastComputedAt ? `Last checked ${fmtDateTime(fresh.lastComputedAt)}.` : "Not checked yet."}</p>
              {canDecide && <ActionForm action={recomputeReorderAction} submit="Check again now" pending="Checking…" variant="secondary" messageBelow />}
              <div className="border-t border-line pt-3 text-[13px] text-fg-2">
                <p className="mb-1 font-medium text-fg">How it is worked out</p>
                Usable stock, minus what is set aside and what will expire before a delivery could arrive, plus what is already ordered or asked for, is compared with the item&apos;s minimum. Below it, we suggest enough to reach minimum + safety extra, at least the supplier&apos;s minimum order.
              </div>
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for items that are running low at {ctx.currentSite.name}. You decide: ask to buy them, or hide the suggestion with a reason. Nothing is ordered by itself.</PageIntro>
      {open && rows.length > 0 && <NextStep text={`Next: ${rows.length} item(s) are running low. Ask to buy them.`} action={{ label: "Start with the first", href: `#s-${rows[0].id}` }} />}
      <SubNav />
      <div className="flex flex-col gap-5">
        <Card>
          <FilterTabs label="Filter" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/procurement/reorder?status=${v}`] as const)} />
          {rows.length === 0 ? (
            <EmptyState title="Nothing here">
              {status !== "open"
                ? "Nothing in this list."
                : policies.length === 0
                  ? "No item has a minimum yet. Set one below (“Tell me when an item runs low”)."
                  : fresh.lastComputedAt
                    ? `Every watched item has enough, counting what is already ordered (checked ${fmtDateTime(fresh.lastComputedAt)}). Use ⋯ More → “Check again now” after receiving or using stock.`
                    : "It could not be worked out just now. Use ⋯ More → “Check again now”."}
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((r) => (
                <li key={r.id} id={`s-${r.id}`} className="scroll-mt-24 rounded-[14px] border border-line p-3" data-testid="reorder-row">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{r.materialName}</span>
                    <span className="font-mono text-[12px] text-muted">{r.materialCode}</span>
                  </p>
                  <p className="mt-1 text-[16px]">
                    Buy about <strong>{fmtBase(r.suggestedQtyBase, r.baseUom)}</strong>
                    {r.needByDate ? ` by ${fmtDate(r.needByDate)}` : ""}
                    {r.supplierName ? ` from ${r.supplierName}` : ""}
                  </p>
                  <p className="text-[14px] text-fg-2">
                    We have {fmtBase(r.onHandBase, r.baseUom)} · {fmtBase(r.openPoQtyBase, r.baseUom)} already coming · lowest we want {fmtBase(r.minStockBase, r.baseUom)}
                  </p>
                  <details className="mt-1">
                    <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[14px] text-primary-text">Why this amount</summary>
                    <p className="text-[13px] text-fg-2">
                      Set aside {fmtBase(r.reservedBase, r.baseUom)} · expires before a delivery {fmtBase(r.expiryRiskQtyBase, r.baseUom)} · safety extra {fmtBase(r.safetyStockBase, r.baseUom)} · supplier needs {r.leadTimeDays ?? "—"} day(s) · {r.siteCode}
                    </p>
                    <p className="text-[13px] text-muted">{r.explanation}</p>
                  </details>
                  {open ? (
                    <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <ActionForm action={acceptSuggestionAction} hidden={{ suggestionId: r.id, baseUom: r.baseUom }} submit="Ask to buy this" variant="cta">
                        <Field label="How much (empty = the suggested amount)" htmlFor={`q-${r.id}`}>
                          <QtyUnitInput id={`q-${r.id}`} baseUom={r.baseUom} name="qty" unitName="qtyUnit" defaultUnit={friendlyUnit(r.baseUom)} />
                        </Field>
                      </ActionForm>
                      <details>
                        <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[14px] text-primary-text">Hide this suggestion</summary>
                        <ActionForm action={dismissSuggestionAction} hidden={{ suggestionId: r.id }} submit="Hide it" variant="secondary">
                          <Input name="note" placeholder="Why we do not need it" aria-label="Why we do not need it" required />
                        </ActionForm>
                      </details>
                    </div>
                  ) : (
                    <p className="mt-1 text-[13px] text-muted">{r.reviewedAt ? `${r.reviewedByName ?? ""}, ${fmtDateTime(r.reviewedAt)}: ${r.reviewNote ?? ""}` : `Worked out ${fmtDateTime(r.runAt)}`}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Items we watch at {ctx.currentSite.name}</CardTitle>
          {policies.length === 0 ? (
            <p className="text-[14px] text-fg-2">No items watched yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
              {policies.map((p) => (
                <li key={p.id} className="px-3 py-2.5 text-[14px]">
                  <span className="font-medium">{p.materialName ?? p.materialCode}</span>
                  <span className="text-fg-2">
                    {" "}
                    · tell me below {fmtBase(p.minStockBase, p.baseUom)} · safety extra {fmtBase(p.safetyStockBase, p.baseUom)} · buy from {p.supplierName ?? "the fastest supplier"}
                    {p.isActive ? "" : " · not watched"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canDecide && mats.length > 0 && (
            <div className="mt-4">
              <MoreDetails title="Tell me when an item runs low">
                <PolicyForm materials={[...mats].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ id: m.id, name: m.name, baseUom: m.baseUom }))} suppliers={sups.map((s) => ({ id: s.id, name: s.name }))} />
              </MoreDetails>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
