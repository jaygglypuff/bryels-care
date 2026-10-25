import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { aslMaterialOptions, listReorderPolicies, listReorderSuggestions } from "@/modules/procurement";
import { supplierOptions } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, Field, Input, PageHeader, Select, Table, Td } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { acceptSuggestionAction, dismissSuggestionAction, recomputeReorderAction, savePolicyAction } from "../actions";
import { FilterPills, SubNav, fmtBase } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reorder suggestions" };

const FILTERS = [
  ["open", "Open"],
  ["accepted", "Accepted"],
  ["dismissed", "Dismissed"],
  ["superseded", "Superseded"],
] as const;

/**
 * Reorder suggestions with their drivers (US-6-04, W04-01). Nothing is ordered automatically: accepting
 * opens a draft purchase request; dismissing needs a reason. Policies (minimum and safety stock,
 * preferred supplier) are configuration per site and material.
 */
export default async function ReorderPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.reorder_suggestion.view")) return <Forbidden what="reorder suggestions" />;
  const { status = "open" } = await searchParams;
  const canDecide = ctx.can("procurement.reorder_suggestion.approve");
  const [rows, policies] = await Promise.all([listReorderSuggestions(ctx, { status }), listReorderPolicies(ctx)]);
  const [mats, sups] = canDecide && ctx.can("masterdata.supplier.edit") ? await Promise.all([aslMaterialOptions(ctx), supplierOptions(ctx)]) : [[], []];
  return (
    <>
      <PageHeader title="Reorder suggestions" subtitle={`${ctx.currentSite.code} · every suggestion shows its drivers; a person decides.`} actions={canDecide ? <ActionForm action={recomputeReorderAction} submit="Recompute now" pending="Computing…" variant="secondary" className="flex flex-col gap-1" messageBelow /> : undefined} />
      <SubNav />
      <div className="flex flex-col gap-5">
        <Banner tone="info" title="How the suggestion is made">
          Usable stock minus reservations and stock that expires before a delivery could arrive, plus open purchase orders and requests, is compared with the minimum. Below it, the suggestion fills up to minimum + safety stock, at least the supplier&apos;s MOQ. Materials have no demand forecast yet.
        </Banner>
        <Card>
          <FilterPills base="/procurement/reorder" current={status} items={FILTERS} />
          {rows.length === 0 ? (
            <EmptyState title="No suggestions here">{policies.length === 0 ? "Add a reorder policy below to get suggestions." : "Everything is above its minimum, or the nightly job has not run yet."}</EmptyState>
          ) : (
            <Table head={["Material", "Suggest", "Drivers", "Supplier", ...(status === "open" && canDecide ? [""] : ["Review"])]}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    {r.materialCode}
                    <div className="text-[12px] text-muted">
                      {r.materialName} · {r.siteCode}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap font-medium">
                    {fmtBase(r.suggestedQtyBase, r.baseUom)}
                    <div className="text-[12px] text-muted">by {r.needByDate ? fmtDate(r.needByDate) : "—"}</div>
                  </Td>
                  <Td className="text-[12px]">
                    <div>
                      on hand {fmtBase(r.onHandBase, r.baseUom)} · reserved {fmtBase(r.reservedBase, r.baseUom)} · open supply {fmtBase(r.openPoQtyBase, r.baseUom)}
                    </div>
                    <div>
                      expiry risk {fmtBase(r.expiryRiskQtyBase, r.baseUom)} · min {fmtBase(r.minStockBase, r.baseUom)} · safety {fmtBase(r.safetyStockBase, r.baseUom)} · lead {r.leadTimeDays ?? "—"} d
                    </div>
                    <div className="text-muted">{r.explanation}</div>
                  </Td>
                  <Td>{r.supplierName ?? "—"}</Td>
                  {status === "open" && canDecide ? (
                    <Td>
                      <ActionForm action={acceptSuggestionAction} hidden={{ suggestionId: r.id }} submit="Accept → request" variant="cta" size="sm">
                        <Input name="qty" placeholder={`qty in ${r.baseUom}`} aria-label="Quantity" />
                      </ActionForm>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[12px] text-primary-text">Dismiss</summary>
                        <ActionForm action={dismissSuggestionAction} hidden={{ suggestionId: r.id }} submit="Dismiss" variant="secondary" size="sm">
                          <Input name="note" placeholder="Reason" aria-label="Reason" required />
                        </ActionForm>
                      </details>
                    </Td>
                  ) : (
                    <Td className="text-[12px]">{r.reviewedAt ? `${r.reviewedByName ?? ""} ${fmtDateTime(r.reviewedAt)}: ${r.reviewNote ?? ""}` : `computed ${fmtDateTime(r.runAt)}`}</Td>
                  )}
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <CardTitle>Reorder policies at {ctx.currentSite.code}</CardTitle>
          {policies.length === 0 ? (
            <p className="text-[13px] text-muted">No policies yet.</p>
          ) : (
            <Table head={["Material", "Minimum", "Safety stock", "Preferred supplier", "Active"]}>
              {policies.map((p) => (
                <tr key={p.id}>
                  <Td>{p.materialCode}</Td>
                  <Td>{fmtBase(p.minStockBase, p.baseUom)}</Td>
                  <Td>{fmtBase(p.safetyStockBase, p.baseUom)}</Td>
                  <Td>{p.supplierName ?? "shortest lead time"}</Td>
                  <Td>{p.isActive ? "yes" : "no"}</Td>
                </tr>
              ))}
            </Table>
          )}
          {canDecide && mats.length > 0 && (
            <ActionForm action={savePolicyAction} submit="Save policy" variant="secondary" className="mt-4 grid gap-3 sm:grid-cols-5 sm:items-end">
              <Field label="Material" htmlFor="materialId">
                <Select id="materialId" name="materialId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {mats.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} ({m.baseUom})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Minimum (base unit)" htmlFor="minStockBase">
                <Input id="minStockBase" name="minStockBase" inputMode="decimal" required />
              </Field>
              <Field label="Safety stock (base unit)" htmlFor="safetyStockBase">
                <Input id="safetyStockBase" name="safetyStockBase" inputMode="decimal" />
              </Field>
              <Field label="Preferred supplier" htmlFor="preferredSupplierId">
                <Select id="preferredSupplierId" name="preferredSupplierId" defaultValue="">
                  <option value="">Shortest lead time</option>
                  {sups.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Active" htmlFor="isActive">
                <Select id="isActive" name="isActive" defaultValue="yes">
                  <option value="yes">yes</option>
                  <option value="no">no</option>
                </Select>
              </Field>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
