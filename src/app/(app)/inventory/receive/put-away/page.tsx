import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { putAwayOptions } from "@/modules/inventory/receiving-putaway";
import { Card, CardTitle, EmptyState, Field, Input, PageHeader } from "@/ui/core";
import { LocationKindChip } from "@/ui/inventory/bits";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { PutAwayForm } from "./put-away-form";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Put away" };

/** W01-08 put-away: scan the lot label, then the destination. Only status-allowed locations are offered (V-LOC). */
export default async function PutAwayPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.movement.post")) return <Forbidden what="put-away" />;
  const { lot: lotRef } = await searchParams;
  let opts: Awaited<ReturnType<typeof putAwayOptions>> | null = null;
  let error: string | null = null;
  if (lotRef?.trim()) {
    try {
      opts = await putAwayOptions(ctx, lotRef);
    } catch (e) {
      if (e instanceof DomainError) error = e.message;
      else throw e;
    }
  }
  const from = opts?.balances.find((b) => b.kind === "receiving") ?? opts?.balances[0];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Put away" subtitle={`${ctx.currentSite.code} · scan the lot label, then the destination location`} actions={<><Help screen="inventory.putaway" /></>} />
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Field label="1. Scan the lot label" htmlFor="lot" hint="Keyboard-wedge scanner or type the lot number.">
              <Input id="lot" name="lot" defaultValue={lotRef} placeholder="BC:LOT:L-2610-00012" autoComplete="off" autoFocus={!opts} required />
            </Field>
          </div>
          <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-[14px] font-medium text-white">Find lot</button>
        </form>
      </Card>
      {error && <Banner tone="bad" title="Lot not found">{error}</Banner>}
      {opts && (
        <Card>
          <CardTitle action={<StatusChip status={opts.lot.qualityStatus} />}>
            <span className="font-mono">{opts.lot.lotNumber}</span>
          </CardTitle>
          <p className="mb-3 text-[13px] text-muted">
            {opts.lot.itemCode} · {opts.lot.itemName} · may go to {opts.allowedKinds.map((k) => <LocationKindChip key={k} kind={k} />)}
          </p>
          <p className="mb-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[14px]" data-testid="putaway-suggested-section">
            Belongs in: <strong>{opts.suggestedSectionLabel}</strong>
            {opts.suggestedCodes.length ? ` · ${opts.suggestedCodes.join(", ")}` : " · no allowed place in that section right now"}
          </p>
          {opts.balances.length === 0 ? (
            <EmptyState title="No stock to put away">This lot has no stock on hand (not yet posted, consumed or reversed).</EmptyState>
          ) : opts.destinations.length === 0 ? (
            <Banner tone="warn" title="No allowed location">There is no active, unblocked location of an allowed type at this site. Ask the site manager to set one up.</Banner>
          ) : (
            <PutAwayForm lotNumber={opts.lot.lotNumber} balances={opts.balances} destinations={opts.destinations} defaultFrom={from?.locationId ?? ""} uom={opts.lot.baseUom} />
          )}
        </Card>
      )}
    </div>
  );
}
