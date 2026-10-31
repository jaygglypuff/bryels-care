import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";

/** Staging quantities in grams with one decimal: what the operator reads on the container and the scale. */
const g = (v: string) => fmtQty(v, "g", 1);
import { batchSheets, canSeeStaging, getStagingView, type StagingView } from "@/modules/production";
import { Card, CardTitle, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { generateSheetAction, substitutionAction } from "../../work-orders/actions";
import { CommandForm } from "../../work-orders/command-form";
import { StageFlow, StageLotButton } from "./stage-flow";
import Decimal from "decimal.js";
import { PageIntro } from "@/ui/guide";

export const metadata: Metadata = { title: "Stage materials" };
export const dynamic = "force-dynamic";

export default async function StageBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const ctx = await requireContext();
  if (!canSeeStaging(ctx)) return <Forbidden what="material staging" />;
  const { batchId } = await params;
  let v: StagingView;
  try {
    v = await getStagingView(ctx, batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const sheets = await batchSheets(ctx, batchId);
  const b = v.batch;
  const canPrint = ctx.can("documents.generated_document.create");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Stage · ${b.batchNumber}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip status={b.status} />
            <span>
              {v.productName} · {fmtMass(b.plannedSizeG)}
              {v.workOrder ? ` · ${v.workOrder.workOrderNumber}` : ""}
            </span>
          </span>
        }
        actions={<><Help screen="production.staging" />{v.workOrder ? <LinkButton href={`/production/work-orders/${v.workOrder.id}?tab=materials`} variant="secondary">Production order</LinkButton> : undefined}</>}
      />
      <PageIntro>Scan each set-aside lot and the making area to move it there. Most sites use Get materials instead.</PageIntro>
      {!v.workOrder && <Banner tone="info" title="No production order">This batch was created without a production order, so no lots are reserved for it. Staging by scan applies to work-order batches.</Banner>}
      {v.workOrder && !["released", "in_progress"].includes(v.workOrder.status) && (
        <Banner tone="warn" title={`Production order ${v.workOrder.status.replace(/_/g, " ")}`}>Materials are reserved when the production order is released. Ask the site manager to release it.</Banner>
      )}
      {b.status !== "planned" && (
        <div className="mb-4">
          <Banner tone={v.allStaged ? "ok" : "info"} title={v.allStaged ? "All ingredients staged" : `Batch is ${b.status.replace(/_/g, " ")}`}>
            {b.status === "materials_staged" ? "The batch is ready for the weighing-area clean-area check." : <Link className="underline" href={`/production/${b.id}`}>Open the batch workspace</Link>}
          </Banner>
          {b.status === "materials_staged" && ctx.can("production.batch.view") && (
            <div className="mt-3">
              <LinkButton href={`/production/${b.id}`} variant="cta">
                Open batch workspace
              </LinkButton>
            </div>
          )}
        </div>
      )}

      {v.canStage && (
        <details className="mb-2">
          <summary className="cursor-pointer text-[13px] text-primary-text">Scan labels instead (barcode scanner)</summary>
          <div className="mt-2">
            <StageFlow batchId={b.id} stagingLocations={v.stagingLocations} />
          </div>
        </details>
      )}

      <div className="mt-4 space-y-3">
        {v.lines.map((l) => (
          <Card key={l.batchMaterialId} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {l.lineNo}. {l.materialName}
                </p>
                <p className="text-[12px] text-muted">
                  {l.materialCode} · need {g(l.theoreticalQtyG)} · staged {g(l.staged)}
                </p>
              </div>
              {l.isStaged ? <Chip tone="ok">Staged</Chip> : <Chip tone="info">{g(l.remaining)} to stage</Chip>}
            </div>
            {!l.isStaged &&
              (l.expected.length ? (
                <ul className="mt-3 space-y-2">
                  {l.expected.map((x) => {
                    const take = Decimal.min(new Decimal(x.qty), new Decimal(l.remaining)).toString();
                    return (
                      <li key={`${x.lotId}-${x.locationId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line p-2.5">
                        <span className="text-[13.5px]">
                          <span className="font-mono font-medium">{x.lotNumber}</span> · {g(x.qty)} at {x.locationCode}
                          {x.expiresOn ? ` · exp ${fmtDate(x.expiresOn)}` : ""}
                        </span>
                        {v.canStage && <StageLotButton batchId={b.id} lotNumber={x.lotNumber} qty={take} toLocationCode={v.stagingLocations[0]?.code ?? null} label={`Bring ${g(take)} to production`} />}
                      </li>
                    );
                  })}
                  {v.stagingLocations.length === 0 && <li className="text-[12.5px] text-muted">No production staging area is set for this warehouse (Master data → Locations).</li>}
                </ul>
              ) : (
                <p className="mt-2 text-[13px]">No lot is set aside for this ingredient. Approve the production order again, or ask the planner.</p>
              ))}
            {l.stagings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[12px] text-fg-2">
                {l.stagings.map((s) => (
                  <li key={s.id}>
                    {s.lotNumber}: {g(s.qty)} {s.from} → {s.to} · {s.by} · {fmtDateTime(s.at)}
                  </li>
                ))}
              </ul>
            )}
            {l.substitutions.map((s, i) => (
              <p key={i} className="mt-1 text-[12px]">
                <Chip tone="warn">QA substitution</Chip> lot {s.lotNumber}: {s.reason} ({s.by})
              </p>
            ))}
          </Card>
        ))}
      </div>

      {v.canSubstitute && v.lines.some((l) => !l.isStaged) && (
        <Card className="mt-4">
          <CardTitle>QA substitution (another lot of the same material)</CardTitle>
          <p className="mb-3 text-[13px] text-muted">A controlled exception: the expected lot's reservation ends and the substitute is reserved. A different material is never allowed.</p>
          <CommandForm action={substitutionAction} fields={{ batchId: b.id }} label="Approve substitution" variant="secondary">
            <Field label="Ingredient" htmlFor="batchMaterialId">
              <Select id="batchMaterialId" name="batchMaterialId">
                {v.lines
                  .filter((l) => !l.isStaged)
                  .map((l) => (
                    <option key={l.batchMaterialId} value={l.batchMaterialId}>
                      {l.materialName}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Substitute lot (scan or type)" htmlFor="substituteLotCode">
              <Input id="substituteLotCode" name="substituteLotCode" required autoComplete="off" className="font-mono" />
            </Field>
            <Field label="Reason" htmlFor="reason">
              <Textarea id="reason" name="reason" required minLength={5} maxLength={500} className="min-h-[56px]" />
            </Field>
          </CommandForm>
        </Card>
      )}

      <Card className="mt-4">
        <CardTitle>Documents</CardTitle>
        {canPrint ? (
          <div className="flex flex-wrap gap-3">
            <CommandForm action={generateSheetAction} fields={{ batchId: b.id, kind: "dispensing_sheet" }} label="Print weighing sheet" variant="secondary" pendingText="Generating…" />
            <CommandForm action={generateSheetAction} fields={{ batchId: b.id, kind: "traveler" }} label="Print traveler" variant="secondary" pendingText="Generating…" />
          </div>
        ) : (
          <p className="text-[13px] text-muted">Printing production sheets needs documents.generated_document.create.</p>
        )}
        {sheets.length > 0 && (
          <ul className="mt-3 space-y-1 text-[13px]">
            {sheets.map((s) => (
              <li key={s.id}>
                <Link className="font-mono text-primary-text underline" href={`/print/${s.kind === "traveler" ? "traveler" : "dispensing-sheet"}/${b.id}?doc=${s.id}`}>
                  {s.number}
                </Link>{" "}
                {s.kind.replace(/_/g, " ")} · {s.at} · {s.by}
                {s.watermark ? ` · ${s.watermark}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
