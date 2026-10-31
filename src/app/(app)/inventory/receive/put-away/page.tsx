import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate } from "@/lib/qty";
import { lotsToPutAway, type PutAwayTask } from "@/modules/inventory/put-away-queue";
import { putAwayOptions } from "@/modules/inventory/receiving-putaway";
import { keywordMatches, type KeywordMatch } from "@/modules/scan";
import { Card, CardTitle, EmptyState, Field, Input, PageHeader } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { PutAwayForm } from "./put-away-form";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Put away" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** keywordMatches links to /inventory/<lotId>; the put-away choice needs the id. */
function lotIdOf(m: KeywordMatch) {
  const id = m.href.split("/").pop() ?? "";
  return UUID.test(id) ? id : null;
}

function TaskCard({ t }: { t: PutAwayTask }) {
  const allBoxed = Number(t.qtyBase) === 0;
  const href = allBoxed
    ? `/inventory/move?lot=${t.lotId}${t.suggested ? `&to=${t.suggested.id}` : ""}`
    : `/inventory/receive/put-away?lot=${t.lotId}&from=${t.fromLocationId}${t.suggested ? `&to=${t.suggested.id}` : ""}`;
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-[64px] items-center gap-3 rounded-[16px] border border-line bg-surface px-4 py-3 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2"
        data-testid="putaway-task"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{t.itemName || t.itemCode}</p>
          <p className="text-[13px] text-fg-2">
            Lot <span className="font-mono">{t.lotNumber}</span>
            {t.supplierLotNumber ? ` · supplier's code ${t.supplierLotNumber}` : ""} · QA OK {fmtDate(t.releasedAt)}
          </p>
          <p className="mt-1 text-[14px]">
            <b>{allBoxed ? t.boxedQtyText : t.qtyText}</b>
            {!allBoxed && t.boxedQtyText ? <span className="text-muted"> (+ {t.boxedQtyText} in boxes)</span> : null} · from {t.fromCode}
            {" → "}
            {t.suggested ? (
              <b>{t.suggested.code}</b>
            ) : (
              <span className="text-muted">no free shelf in {t.sectionLabel}</span>
            )}
            {t.suggested ? <span className="text-muted"> ({t.sectionLabel})</span> : null}
          </p>
          {allBoxed && <p className="text-[13px] text-muted">It is in boxes: tap to move the boxes (scan each box).</p>}
        </div>
        <ArrowRight size={20} className="shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
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
  const finder = (
    <Card>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Field label={opts ? "Another lot" : "Or scan the lot label"} htmlFor="lot" hint="Scan the label, or type the lot number, its last digits, or the supplier's lot number.">
            <Input id="lot" name="lot" defaultValue={opts ? "" : lotRef} placeholder="BC:LOT:L-2610-00012 or 0012" autoComplete="off" autoFocus={!opts && tasks.length === 0} required />
          </Field>
        </div>
        <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-[14px] font-medium text-white">Find lot</button>
      </form>
    </Card>
  );

  const searching = !!lotRef?.trim() && !opts;
  const taskList = (
    <section aria-labelledby="todo-title" className="space-y-2">
      <h2 id="todo-title" className="text-[17px] font-semibold">
        To put away ({tasks.length})
      </h2>
      {tasks.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to put away">Lots appear here when QA releases them while they are still in the hold area or at the dock.</EmptyState>
        </Card>
      ) : (
        <ul className="space-y-2" data-testid="putaway-tasks">
          {tasks.map((t) => (
            <TaskCard key={`${t.lotId}:${t.fromLocationId}`} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
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
      <PageHeader title="Put away" subtitle={`${ctx.currentSite.code} · take released lots out of the hold area to their shelf`} actions={<><Help screen="inventory.putaway" /></>} />
      {moved && <Banner tone="ok" title="Put away">{moved}</Banner>}

      {searching && finder}
      {searching && results}
      {!opts && taskList}
      {!opts && !searching && finder}

      {opts && (
        <Card>
          <CardTitle action={<StatusChip status={opts.lot.qualityStatus} />}>
            <span className="font-mono">{opts.lot.lotNumber}</span>
          </CardTitle>
          <p className="mb-2 text-[14px]">
            <b>{opts.lot.itemName}</b> <span className="text-muted">· {opts.lot.itemCode}{opts.lot.supplierLotNumber ? ` · supplier's code on the sack ${opts.lot.supplierLotNumber}` : ""}</span>
          </p>
          <p className="mb-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[14px]" data-testid="putaway-suggested-section">
            Belongs in: <strong>{opts.suggestedSectionLabel}</strong>
            {opts.suggestedCodes.length ? ` · ${opts.suggestedCodes.join(", ")}` : " · no allowed place in that section right now"}
          </p>
          {opts.lot.qualityStatus === "quarantine" && <Banner tone="warn" title="Waiting for QA">This lot is not released yet. It can only move between quarantine and hold areas. Put it on a shelf after QA approves it.</Banner>}
          {opts.balances.length === 0 ? (
            <EmptyState title="No stock to put away">This lot has no stock now (not saved yet, used up, or reversed).</EmptyState>
          ) : opts.destinations.length === 0 ? (
            <Banner tone="warn" title="No allowed location">There is no active, unblocked location of an allowed type at this site. Ask the site manager to set one up.</Banner>
          ) : (
            <PutAwayForm
              key={`${opts.lot.id}:${from?.locationId ?? ""}:${suggestedDest?.id ?? ""}`}
              lotNumber={opts.lot.lotNumber}
              balances={opts.balances.map((b) => ({ locationId: b.locationId, code: b.code, name: b.name, qtyText: b.qtyText, looseQtyText: b.looseQtyText, boxed: D(b.looseQtyBase).lt(b.qtyBase) }))}
              destinations={opts.destinations.map((d) => ({ id: d.id, code: d.code, name: d.name, kind: d.kind, sectionLabel: d.sectionLabel, suggested: d.section === opts!.suggestedSection }))}
              defaultFrom={from?.locationId ?? ""}
              defaultTo={suggestedDest?.code ?? ""}
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
