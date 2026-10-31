import { requireContext } from "@/lib/auth/context";
import { D, fmtDate, fmtQty } from "@/lib/qty";
import { boxableOutputs, listPacks } from "@/modules/sales";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip, StatusChip } from "@/ui/status";
import { LotStatusChip } from "@/ui/inventory/bits";
import { Forbidden } from "../../forbidden";
import { startPackAction } from "../../sales/fulfilment-actions";
import { Cmd } from "../../sales/fulfilment-forms";

export const metadata = { title: "Boxing" };

const SOURCE: Record<string, string> = { batch_output: "Boxing a batch", sales_order: "Packing an order", repack: "Repack for a customer" };
const PACK_WORDS: Record<string, string> = { open: "Boxing now", verified: "Checked", cancelled: "Cancelled", closed: "Done" };

/**
 * Boxing (W08), grade-5 (ADR-088): finished lots that QA said OK and still have units to box, then the
 * boxing jobs of this site, product first, number small and grey. A checker (not the packer) verifies.
 */
export default async function PacksPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.pack.view")) return <Forbidden what="boxing" />;
  const [outputs, list] = await Promise.all([boxableOutputs(ctx), listPacks(ctx)]);
  const canStart = ctx.can("inventory.pack.create") && ctx.can("inventory.container.create");
  const units = (v: string, uom: string) => fmtQty(v, uom, uom === "pcs" ? 0 : 3);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Boxing"
        subtitle={ctx.currentSite.name}
        actions={
          ctx.can("inventory.container.edit") ? (
            <MoreMenu>
              <LinkButton href="/warehouse/repack" variant="secondary">Repack for a customer</LinkButton>
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>This screen is for putting finished products into boxes: start boxing a batch, label every box, and another person checks it.</PageIntro>
      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">To box · {outputs.length}</h2>
        {outputs.length === 0 ? (
          <EmptyState title="Nothing to box">A finished batch shows here when QA said OK and it still has units to box. Nothing to do now.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface" data-testid="to-box">
            {outputs.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                    {o.productName} <LotStatusChip status={o.lotStatus} />
                  </p>
                  <p className="text-[13px] text-fg-2">
                    <b>{units(o.toBox, o.baseUom)} to box</b>
                    {!D(o.toBox).eq(o.qty) ? ` (made ${units(o.qty, o.baseUom)}, samples kept)` : ""}
                    <span className="ml-1 font-mono text-[12px] text-muted">· {o.batchNumber} · {o.lotNumber}</span>
                  </p>
                </div>
                {canStart && <Cmd action={startPackAction} fields={{ batchOutputId: o.id }} label="Start boxing" pending="Starting…" />}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">Boxing jobs · {list.length}</h2>
        {list.length === 0 ? (
          <p className="text-[14px] text-fg-2">No boxing jobs yet. Tap Start boxing above.</p>
        ) : (
          <PlainList label="Boxing jobs">
            {list.map((p) => (
              <PlainRow
                key={p.id}
                href={p.shipmentId ? `/sales/shipments/${p.shipmentId}` : `/warehouse/packs/${p.id}`}
                title={p.productName ?? p.sku ?? "Boxing"}
                status={
                  <>
                    <StatusChip status={p.status} label={p.status === "open" && p.submittedAt ? "Waiting for the check" : PACK_WORDS[p.status]} />
                    {p.usedDefaultConfig && <Chip tone="warn">Usual box size used</Chip>}
                  </>
                }
                facts={
                  <>
                    {SOURCE[p.sourceKind] ?? p.sourceKind} · {p.boxCount} {p.boxCount === 1 ? "box" : "boxes"} · {fmtQty(p.packedUnits, "pcs", 0)}
                    {p.expectedUnits ? ` of ${fmtQty(p.expectedUnits, "pcs", 0)}` : ""} pcs · {p.packer} · {fmtDate(p.createdAt)}
                  </>
                }
                code={[p.packNumber, p.lotNumber].filter(Boolean).join(" · ")}
              />
            ))}
          </PlainList>
        )}
      </section>
    </div>
  );
}
