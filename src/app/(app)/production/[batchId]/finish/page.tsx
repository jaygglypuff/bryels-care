import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { type FinishView, getFinishView, pieceWord } from "@/modules/production";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Banner } from "@/ui/status";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Forbidden } from "../../../forbidden";
import { FinishForm } from "./forms";

export const metadata: Metadata = { title: "Finish batch" };
export const dynamic = "force-dynamic";

/**
 * Finish (ADR-080 §6, UX review S6): read-back of the day-log counts, damaged and left-over wrappers,
 * hold area, then one "Finish batch". Online only: one transaction across stock. Every rule is in
 * finishBatch; this page only shows what the service will check.
 */
export default async function FinishPage({ params }: { params: Promise<{ batchId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production batches" />;
  const { batchId } = await params;
  let v: FinishView;
  try {
    v = await getFinishView(ctx, batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const back = v.order ? `/production/orders/${v.order.id}` : `/production/${v.batch.id}`;
  const word = pieceWord(v.product.family, 2);
  const requirePassword = await getSetting(db, ctx.organizationId, "production.sign_off.require_password");
  const finished = v.batch.status === "awaiting_qc" || v.batch.status === "quarantined";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={`Finish · ${v.batch.number}`}
        subtitle={`${v.product.name}${v.order ? ` · order ${v.order.number}` : ""}`}
        actions={
          <>
            <Help screen="production.finish" />
            <LinkButton href={back} variant="secondary">
              Back
            </LinkButton>
          </>
        }
      />
      {finished ? (
        <Banner tone="ok" title="This batch is finished">
          It is in the hold area, waiting for the quality check.
        </Banner>
      ) : v.blockers.length > 0 ? (
        <Banner tone="warn" title="Not ready to finish">
          <ul className="list-disc pl-5">
            {v.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Banner>
      ) : !v.can.finish ? (
        <Card>
          <EmptyState title="Someone from production finishes this batch">
            <WhoCanHelp permission="production.batch.post" siteId={v.batch.siteId} />
          </EmptyState>
        </Card>
      ) : !v.hold ? (
        <Banner tone="bad" title="No hold area">
          This site has no hold-area location for finished batches. Ask an administrator to add one (section Waiting for QA / on hold).
        </Banner>
      ) : (
        <Card>
          <noscript>Finishing needs a connection and JavaScript.</noscript>
          <FinishForm
            batchId={v.batch.id}
            batchNumber={v.batch.number}
            orderId={v.order?.id ?? null}
            pieceWord={word}
            expected={v.expectedUnits}
            unitNetMassG={v.product.unitNetMassG}
            theoreticalYieldG={v.batch.theoreticalYieldG}
            limits={v.limits}
            log={v.log}
            existingScrap={v.existing.scrap}
            defectTypes={v.defectTypes}
            samples={v.samples.units}
            packaging={v.packaging}
            hold={v.hold}
            holdOptions={v.holdOptions}
            needsChecker={v.needsChecker}
            checkers={v.checkers}
            requirePassword={requirePassword}
          />
        </Card>
      )}
    </div>
  );
}
