import { requireContext } from "@/lib/auth/context";
import { bulkDispositionCandidates, type BulkFilter } from "@/modules/quality";
import { Card, CardTitle, EmptyState, Input, LinkButton, PageHeader, Select, buttonClass } from "@/ui/core";
import { Banner } from "@/ui/status";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { fmtLotQty } from "../_ui";
import { BulkForm } from "../w2c-forms";
import { StepUpGate } from "../../admin/users/step-up-gate";

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
      <PageHeader title="Decide many lots at once" subtitle={ctx.currentSite.name} actions={<LinkButton href="/quality" variant="secondary">Check a batch or delivery</LinkButton>} />
      <PageIntro>This screen is for QA, mostly when starting with the system: say OK to use (or not OK) for many old lots in one go. Each lot is still checked and saved one by one.</PageIntro>
      {c.rows.length > 0 && <NextStep text={`Next: tick the lots, choose OK or not OK, then confirm with your password (${c.rows.length} lot(s) match).`} />}
      <StepUpGate ctx={ctx} purpose="apply a bulk disposition" />
      <div className="flex flex-col gap-5">
        <Card>
          <MoreDetails title="Choose which lots to show (place, kind, use-by date)">
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
                <option value="quarantine">Waiting for QA check</option>
                <option value="on_hold">Stopped by QA</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Materials or products
              <Select name="itemKind" defaultValue={sp.itemKind ?? ""}>
                <option value="">All</option>
                <option value="material">Materials</option>
                <option value="product">Finished products</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Kind of material
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
              Use by, from
              <Input type="date" name="expiresFrom" defaultValue={sp.expiresFrom ?? ""} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Use by, until
              <Input type="date" name="expiresTo" defaultValue={sp.expiresTo ?? ""} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Lot number starts with (optional)
              <Input name="lotPrefix" defaultValue={sp.lotPrefix ?? ""} autoComplete="off" />
            </label>
            <div className="flex items-end">
              <button type="submit" className={buttonClass("secondary")}>
                Show these lots
              </button>
            </div>
          </form>
          </MoreDetails>
        </Card>
        {c.truncated && <Banner tone="warn" title={`More than ${c.maxLots} lots match`}>Show fewer lots (choose which lots, above); one go decides at most {c.maxLots} lots.</Banner>}
        <Card>
          <CardTitle>Lots ({c.rows.length})</CardTitle>
          {c.rows.length === 0 ? (
            <EmptyState title="No lots match">Change which lots to show. Finished products whose batch waits for QA check are decided on the batch, never here.</EmptyState>
          ) : (
            <BulkForm rows={c.rows.map((r) => ({ ...r, onHand: fmtLotQty(r.onHand, r.baseUom), baseUom: "" }))} reasonCodes={c.reasonCodes} />
          )}
          <p className="mt-3 text-[12px] text-muted">
            Every lot follows the same rules as one by one: expired lots are refused, QA stops still count, and you cannot say OK to lots you received or tested. Typing your password confirms the decision; it is not a validated electronic signature.
          </p>
        </Card>
      </div>
    </>
  );
}
