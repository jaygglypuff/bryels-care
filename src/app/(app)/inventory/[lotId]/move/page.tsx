import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D } from "@/lib/qty";
import { allowedDestinationKinds, getLotDetail, moveDestinations, type LotDetail } from "@/modules/inventory/lots";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";
import { MoveForm } from "./move-form";

export const metadata = { title: "Move stock" };

export default async function MovePage({ params }: { params: Promise<{ lotId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.movement.post")) return <Forbidden what="moving stock" />;
  const { lotId } = await params;
  let lot: LotDetail;
  try {
    lot = await getLotDetail(ctx, lotId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const destinations = await moveDestinations(ctx, lot);
  const kinds = allowedDestinationKinds(lot.qualityStatus, lot.expiresOn);
  const restricted = !kinds.includes("storage");

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader
        title="Move stock"
        subtitle={
          <>
            <Link href={`/inventory/${lot.id}`} className="font-mono text-primary-text hover:underline">{lot.lotNumber}</Link> · {lot.itemName} · {lot.itemCode}
          </>
        }
        actions={<StatusChip status={lot.qualityStatus} />}
      />
      {restricted && (
        <Banner tone={lot.qualityStatus === "on_hold" ? "hold" : lot.qualityStatus === "quarantine" ? "q" : "exp"} title="Restricted destinations">
          This lot is not released for use, so it can only move to {kinds.join(", ")} locations.
        </Banner>
      )}
      <Card>
        {lot.balances.length === 0 ? (
          <EmptyState title="No stock to move" action={<LinkButton href={`/inventory/${lot.id}`} variant="secondary">Back to lot</LinkButton>}>
            This lot has no stock left at any location.
          </EmptyState>
        ) : destinations.length === 0 ? (
          <EmptyState title="No allowed destination" action={<LinkButton href={`/inventory/${lot.id}`} variant="secondary">Back to lot</LinkButton>}>
            This site has no active {kinds.join(" / ")} location. Ask your site manager to set one up.
          </EmptyState>
        ) : (
          <MoveForm
            lotId={lot.id}
            idempotencyKey={randomUUID()}
            baseUom={lot.baseUom}
            sources={lot.balances.map((b) => ({ id: b.locationId, code: b.code, name: b.name, kind: b.kind, qty: D(b.qtyBase).toString(), qtyLabel: fmtLotQty(b.qtyBase, lot.baseUom) }))}
            destinations={destinations}
          />
        )}
      </Card>
    </div>
  );
}
