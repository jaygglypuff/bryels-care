import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D } from "@/lib/qty";
import { lotsToPutAway } from "@/modules/inventory/put-away-queue";
import { putAwayOptions } from "@/modules/inventory/receiving-putaway";
import { keywordMatches, type KeywordMatch } from "@/modules/scan";
import { Card, CardTitle, EmptyState, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { LotStatusChip } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";
import { PutAwayForm } from "./put-away-form";
import { PutAwayLotFinder } from "./lot-finder";
import type { PickCandidate } from "@/ui/scan-or-pick";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Put away" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** keywordMatches links to /inventory/<lotId>; the put-away choice needs the id. */
function lotIdOf(m: KeywordMatch) {
  const id = m.href.split("/").pop() ?? "";
  return UUID.test(id) ? id : null;
}


/**
 * W01-08 put-away. Top: "To put away" (lots QA released that still sit in quarantine, hold or receiving,
 * oldest release first); tapping one preselects the lot, where it is and the suggested shelf, so the
 * user only confirms. Below: scan or type a lot (number, last digits or supplier lot). Only
 * status-allowed locations are offered (V-LOC); the service re-checks everything.
 */
export default async function PutAwayPage({ searchParams }: { searchParams: Promise<{ lot?: string; from?: string; to?: string; moved?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.movement.post")) return <Forbidden what="put-away" />;
  const { lot: lotRef, from: fromParam, to: toParam, moved } = await searchParams;
  const tasks = ctx.can("inventory.lot.view") ? await lotsToPutAway(ctx) : [];
  let opts: Awaited<ReturnType<typeof putAwayOptions>> | null = null;
  let error: string | null = null;
  let matches: { id: string; title: string; detail: string }[] = [];
  if (lotRef?.trim()) {
    try {
      opts = await putAwayOptions(ctx, lotRef);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      error = e.message;
      // Not the exact lot number: the last digits or the supplier's lot number find it too (ADR-085 look-up).
      if (e.code === "not_found" && ctx.can("inventory.lot.view")) {
        matches = (await keywordMatches(ctx, lotRef.replace(/^BC:LOT:/i, ""))).flatMap((m) => {
          const id = lotIdOf(m);
          return id ? [{ id, title: m.title, detail: m.detail }] : [];
        });
      }
    }
  }
  const from = (fromParam && opts?.balances.find((b) => b.locationId === fromParam)) || opts?.balances.find((b) => b.kind === "receiving") || opts?.balances.find((b) => Number(b.looseQtyBase) > 0) || opts?.balances[0];
  const suggestedDest = opts ? (toParam ? opts.destinations.find((d) => d.id === toParam || d.code === toParam.toUpperCase()) : undefined) ?? opts.destinations.find((d) => d.kind === "storage" && d.section === opts!.suggestedSection) : undefined;
  const taskLot = opts ? tasks.find((t) => t.lotId === opts!.lot.id) : undefined;
  // The lots waiting to be put away are the only candidates (tap, scan or find by name among them).
  const taskCandidates: PickCandidate[] = tasks
    .filter((t) => !opts || t.lotId !== opts.lot.id)
    .map((t) => {
      const allBoxed = Number(t.qtyBase) === 0;
      return {
        value: allBoxed
          ? `/inventory/move?lot=${t.lotId}${t.suggested ? `&to=${t.suggested.id}` : ""}`
          : `/inventory/receive/put-away?lot=${t.lotId}&from=${t.fromLocationId}${t.suggested ? `&to=${t.suggested.id}` : ""}`,
        title: t.itemName || t.itemCode,
        detail: `${allBoxed ? `${t.boxedQtyText} in boxes` : t.qtyText} at ${t.fromCode} → ${t.suggested ? `${t.suggested.code} (${t.sectionLabel})` : `no free shelf in ${t.sectionLabel}`} · lot ${t.lotNumber}`,
        code: t.lotNumber,
        codes: [t.lotNumber, ...(t.supplierLotNumber ? [t.supplierLotNumber.toUpperCase()] : [])],
      };
    });
  const finder =
    taskCandidates.length > 0 ? (
      <Card data-testid="putaway-tasks">
        <PutAwayLotFinder label={opts ? "Another lot?" : `To put away (${tasks.length})`} candidates={taskCandidates} />
      </Card>
    ) : null;

  const searching = !!lotRef?.trim() && !opts;
  const taskList =
    tasks.length === 0 ? (
      <Card>
        <EmptyState title="Nothing to put away">Lots show here when QA says OK while they are still in the QA area or at the dock. Nothing to do now.</EmptyState>
      </Card>
    ) : null;
  const results = (
    <>
      {error && matches.length === 0 && <Banner tone="bad" title="Lot not found">{error} Check the number on the label, or type part of it.</Banner>}
      {matches.length > 0 && (
        <Card data-testid="putaway-matches">
          <CardTitle>Which lot do you mean?</CardTitle>
          <ul className="space-y-2">
            {matches.map((m) => (
              <li key={m.id}>
                <Link href={`/inventory/receive/put-away?lot=${m.id}`} className="flex min-h-[56px] items-center justify-between gap-3 rounded-[12px] border border-line px-3 py-2 hover:border-primary">
                  <span className="min-w-0">
                    <span className="block font-medium">{m.title}</span>
                    <span className="block text-[13px] text-muted">{m.detail}</span>
                  </span>
                  <ArrowRight size={18} className="shrink-0 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Put away" subtitle={ctx.currentSite.name} actions={<Help screen="inventory.putaway" />} />
      <PageIntro>This screen is for taking lots that QA said OK out of the QA area to their shelf. Tap a lot in the list; the shelf is suggested, you only confirm.</PageIntro>
      {moved && <Banner tone="ok" title="Put away">{moved}</Banner>}

      {searching && results}
      {!opts && taskList}
      {!opts && finder}

      {opts && (
        <Card>
          <CardTitle action={<LotStatusChip status={opts.lot.qualityStatus} expiresOn={opts.lot.expiresOn} />}>
            {opts.lot.itemName}
          </CardTitle>
          <p className="mb-2 text-[14px]">
            Lot <span className="font-mono text-[13px] text-muted">{opts.lot.lotNumber}</span>{opts.lot.supplierLotNumber ? <span className="text-muted"> · supplier&apos;s code on the sack {opts.lot.supplierLotNumber}</span> : null}
          </p>
          <p className="mb-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[14px]" data-testid="putaway-suggested-section">
            Belongs in: <strong>{opts.suggestedSectionLabel}</strong>
            {opts.suggestedCodes.length ? ` · ${opts.suggestedCodes.join(", ")}` : " · no allowed place in that section right now"}
          </p>
          {opts.lot.qualityStatus === "quarantine" && <Banner tone="warn" title="Waiting for QA check">This lot is not OK to use yet. It can only move between the QA areas. Put it on a shelf after QA says OK.</Banner>}
          {opts.balances.length === 0 ? (
            <EmptyState title="No stock to put away">This lot has no stock now (not saved yet, used up, or reversed).</EmptyState>
          ) : opts.destinations.length === 0 ? (
            <Banner tone="warn" title="No shelf it may go to">There is no free shelf of the right kind at this site. Ask the site manager to set one up.</Banner>
          ) : (
            <PutAwayForm
              key={`${opts.lot.id}:${from?.locationId ?? ""}:${suggestedDest?.id ?? ""}`}
              lotNumber={opts.lot.lotNumber}
              balances={opts.balances.map((b) => ({ locationId: b.locationId, code: b.code, name: b.name, qtyText: b.qtyText, looseQtyText: b.looseQtyText, boxed: D(b.looseQtyBase).lt(b.qtyBase) }))}
              destinations={opts.destinations.map((d) => ({ id: d.id, code: d.code, name: d.name, kind: d.kind, sectionLabel: d.sectionLabel, suggested: d.section === opts!.suggestedSection }))}
              defaultFrom={from?.locationId ?? ""}
              defaultTo={suggestedDest?.id ?? ""}
              uom={opts.lot.baseUom}
              fromTask={!!taskLot}
            />
          )}
          <p className="mt-4 text-[14px]">
            <Link href="/inventory/receive/put-away" className="font-medium text-primary-text underline">
              Back to the list
            </Link>
          </p>
        </Card>
      )}
      {opts && finder}
    </div>
  );
}
