import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D } from "@/lib/qty";
import { allowedDestinationKinds, getLotDetail, moveDestinations, type LotDetail } from "@/modules/inventory/lots";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { LOCATION_KIND_WORDS, LotStatusChip, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";
import { MoveForm } from "./move-form";

export const metadata = { title: "Move stock" };

/** Move one lot from the scan card (US-2-14), grade-5 (ADR-088): four fields with defaults; only allowed shelves listed. */
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
  const kindWords = kinds.map((k) => (LOCATION_KIND_WORDS[k] ?? k).toLowerCase()).join(" or ");

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader
        title={`Move ${lot.itemName}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            Lot <RecordNo>{lot.lotNumber}</RecordNo> <LotStatusChip status={lot.qualityStatus} expiresOn={lot.expiresOn} />
          </span>
        }
        actions={<LinkButton href={`/inventory/${lot.id}`} variant="secondary">Open this lot</LinkButton>}
      />
      <PageIntro>This screen is for moving this lot to another shelf. Choose where it is now, where it goes, how much, and why.</PageIntro>
      {restricted && (
        <Banner tone={lot.qualityStatus === "on_hold" ? "hold" : lot.qualityStatus === "quarantine" ? "q" : "exp"} title="Only some places allowed">
          This lot is not OK to use yet, so it can only go to a place for: {kindWords}.
        </Banner>
      )}
      <Card>
        {lot.balances.length === 0 ? (
          <EmptyState title="Nothing to move" action={<LinkButton href={`/inventory/${lot.id}`} variant="secondary">Back to the lot</LinkButton>}>
            This lot has no stock left on any shelf.
          </EmptyState>
        ) : destinations.length === 0 ? (
          <EmptyState title="No shelf it may go to" action={<LinkButton href={`/inventory/${lot.id}`} variant="secondary">Back to the lot</LinkButton>}>
            This site has no place for: {kindWords}. Ask your site manager to set one up.
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
