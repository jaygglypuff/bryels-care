import { requireContext } from "@/lib/auth/context";
import { bulkDispositionCandidates, type BulkFilter } from "@/modules/quality";
import { Card, CardTitle, EmptyState, Input, LinkButton, PageHeader, Select, buttonClass } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { fmtLotQty } from "../_ui";
import { BulkForm } from "../w2c-forms";

export const dynamic = "force-dynamic";

type SP = { warehouseId?: string; itemKind?: string; materialKind?: string; status?: string; expiresFrom?: string; expiresTo?: string; lotPrefix?: string };

/** US-2-23: QA bulk disposition of opening (migrated) lots, one decision per lot through the normal path. */
export default async function BulkDispositionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.disposition.approve")) return <Forbidden what="bulk disposition (QA only)" />;
  const sp = await searchParams;
  const filter: BulkFilter = {
    warehouseId: sp.warehouseId || null,
    itemKind: sp.itemKind === "material" || sp.itemKind === "product" ? sp.itemKind : null,
    materialKind: sp.materialKind || null,
    status: sp.status === "on_hold" ? "on_hold" : "quarantine",
    expiresFrom: sp.expiresFrom || null,
    expiresTo: sp.expiresTo || null,
    lotPrefix: sp.lotPrefix || null,
  };
  const c = await bulkDispositionCandidates(ctx, filter);
  return (
    <>
      <PageHeader title="Bulk disposition" subtitle={`${ctx.currentSite.code} · apply one QA decision to many lots (opening stock); each lot is checked and recorded separately`} actions={<LinkButton href="/quality" variant="secondary">QA queue</LinkButton>} />
      <div className="flex flex-col gap-5">
        <Card>
          <CardTitle>Filter</CardTitle>
          <form method="get" className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Warehouse
              <Select name="warehouseId" defaultValue={sp.warehouseId ?? ""}>
                <option value="">All</option>
                {c.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Status
              <Select name="status" defaultValue={filter.status ?? "quarantine"}>
                <option value="quarantine">Quarantined</option>
                <option value="on_hold">On QA hold</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Item kind
              <Select name="itemKind" defaultValue={sp.itemKind ?? ""}>
                <option value="">All</option>
                <option value="material">Materials</option>
                <option value="product">Finished goods</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Material class
              <Select name="materialKind" defaultValue={sp.materialKind ?? ""}>
                <option value="">All</option>
                {c.materialKinds.map((k) => (
                  <option key={k} value={k}>
                    {k.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Expires from
              <Input type="date" name="expiresFrom" defaultValue={sp.expiresFrom ?? ""} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Expires to
              <Input type="date" name="expiresTo" defaultValue={sp.expiresTo ?? ""} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Lot number starts with
              <Input name="lotPrefix" defaultValue={sp.lotPrefix ?? ""} autoComplete="off" />
            </label>
            <div className="flex items-end">
              <button type="submit" className={buttonClass("secondary")}>
                Apply filter
              </button>
            </div>
          </form>
        </Card>
        {c.truncated && <Banner tone="warn" title={`More than ${c.maxLots} lots match`}>Narrow the filter; one run decides at most {c.maxLots} lots.</Banner>}
        <Card>
          <CardTitle>Lots ({c.rows.length})</CardTitle>
          {c.rows.length === 0 ? (
            <EmptyState title="No lots match">Change the filter. Finished lots whose batch is still awaiting QC are decided through batch release, never in bulk.</EmptyState>
          ) : (
            <BulkForm rows={c.rows.map((r) => ({ ...r, onHand: fmtLotQty(r.onHand, r.baseUom), baseUom: "" }))} reasonCodes={c.reasonCodes} />
          )}
          <p className="mt-3 text-[12px] text-muted">
            Every lot goes through the single-lot rules: expired lots are refused, receiving and hold blockers apply, and you cannot release lots you received or tested. Re-entering your password confirms the decision; it is not a validated electronic signature.
          </p>
        </Card>
      </div>
    </>
  );
}
