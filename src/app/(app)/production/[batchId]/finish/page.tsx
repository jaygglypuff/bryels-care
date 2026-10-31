import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { batchRecordHref, type FinishView, getFinishView, pieceWord } from "@/modules/production";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Banner } from "@/ui/status";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Forbidden } from "../../../forbidden";
import { PageIntro } from "@/ui/guide";
import { LabelPrint } from "../../orders/[workOrderId]/step/[n]/packaging-box";
import { printBatchLabelsPanelAction } from "../../orders/[workOrderId]/flow-actions";
import { PrintLabelsPanel } from "@/ui/labels/print-labels-panel";
import { FinishForm } from "./forms";

export const metadata: Metadata = { title: "Finish batch" };
export const dynamic = "force-dynamic";

/**
 * Finish (ADR-080 §6, UX review S6): read-back of the day-log counts, wrappers (damaged read from the
 * packaging step when it recorded them), hold area, then one "Finish batch" with an in-page confirmation. Online only: one transaction across stock. Every rule is in
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
  const back = v.order ? `/production/orders/${v.order.id}` : batchRecordHref(v.batch.id);
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
      <PageIntro>Check the counts of good pieces, rejects and wrappers, then put the batch in the hold area to wait for the QA check.</PageIntro>
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
            <WhoCanHelp permission="production.batch.post" siteId={v.batch.siteId} hideEmails />
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
            rejectApproval={v.rejectApproval}
            hold={v.hold}
            holdOptions={v.holdOptions}
            needsChecker={v.needsChecker}
            checkers={v.checkers}
            requirePassword={requirePassword}
          />
        </Card>
      )}
      {v.labels.allowed && v.labels.values ? (
        <PrintLabelsPanel ctx={ctx} entityType="batch" entityId={v.batch.id} kind="bar" copies={v.labels.defaultCount} sentence="Stick one label on each bar." action={printBatchLabelsPanelAction} batchValues={v.labels.values} />
      ) : v.labels.lotNumber ? (
        <LabelPrint batchId={v.batch.id} labels={v.labels} />
      ) : null}
    </div>
  );
}
