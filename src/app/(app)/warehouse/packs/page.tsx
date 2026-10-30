import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDateTime, fmtQty } from "@/lib/qty";
import { boxableOutputs, listPacks } from "@/modules/sales";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { startPackAction } from "../../sales/fulfilment-actions";
import { Cmd } from "../../sales/fulfilment-forms";

export const metadata = { title: "Boxing" };

const SOURCE: Record<string, string> = { batch_output: "Batch boxing", sales_order: "Order packing", repack: "Customer repack" };

/** W08 boxing queue: released finished lots with boxes still to make (units after samples), and the packs of the current site. */
export default async function PacksPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.pack.view")) return <Forbidden what="boxing" />;
  const [outputs, list] = await Promise.all([boxableOutputs(ctx), listPacks(ctx)]);
  const canStart = ctx.can("inventory.pack.create") && ctx.can("inventory.container.create");
  return (
    <>
      <PageHeader
        title="Boxing"
        subtitle={`${ctx.currentSite.code} · box finished lots, label every box, a checker verifies`}
        actions={ctx.can("inventory.container.edit") ? <LinkButton href="/warehouse/repack" variant="secondary">Repack for a customer</LinkButton> : undefined}
      />
      <Card>
        <CardTitle>To box ({outputs.length})</CardTitle>
        {outputs.length === 0 ? (
          <EmptyState title="Nothing to box">A finished batch appears here when QA has passed it and it still has units to box.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="to-box">
            {outputs.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{o.batchNumber} · {o.productName}</p>
                  <p className="text-[13px] text-fg-2">
                    <b>{fmtQty(o.toBox, o.baseUom, o.baseUom === "pcs" ? 0 : 3)} to box</b>
                    {!D(o.toBox).eq(o.qty) ? ` (made ${fmtQty(o.qty, o.baseUom, o.baseUom === "pcs" ? 0 : 3)}, samples kept)` : ""} · lot {o.lotNumber} · {o.sku} · <StatusChip status={o.lotStatus} />
                  </p>
                </div>
                {canStart && <Cmd action={startPackAction} fields={{ batchOutputId: o.id }} label="Start boxing" pending="Starting…" size="sm" />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="mt-4">
        <CardTitle>Packs</CardTitle>
        {list.length === 0 ? (
          <EmptyState title="No packs yet" />
        ) : (
          <Table head={["Pack", "Kind", "SKU", "Lot", "Boxes", "Units", "Status", "Packer", "Started"]}>
            {list.map((p) => (
              <tr key={p.id}>
                <Td><Link href={p.shipmentId ? `/sales/shipments/${p.shipmentId}` : `/warehouse/packs/${p.id}`} className="text-primary-text hover:underline">{p.packNumber}</Link></Td>
                <Td>{SOURCE[p.sourceKind]}{p.usedDefaultConfig && <> <Chip tone="warn">default config used</Chip></>}</Td>
                <Td>{p.sku}</Td>
                <Td className="font-mono text-[12px]">{p.lotNumber ?? "—"}</Td>
                <Td>{p.boxCount}</Td>
                <Td>{fmtQty(p.packedUnits, "pcs", 0)}{p.expectedUnits ? ` / ${fmtQty(p.expectedUnits, "pcs", 0)}` : ""}</Td>
                <Td><StatusChip status={p.status} label={p.status === "open" && p.submittedAt ? "Awaiting check" : undefined} /></Td>
                <Td>{p.packer}</Td>
                <Td>{fmtDateTime(p.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
