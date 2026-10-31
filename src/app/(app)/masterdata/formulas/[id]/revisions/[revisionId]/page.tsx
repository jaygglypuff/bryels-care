import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { businessToday, formulaFormOptions, getFormulaRevision } from "@/modules/masterdata";
import { Banner } from "@/ui/status";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Forbidden } from "../../../../../forbidden";
import { decideFormulaAction, retireFormulaAction, submitFormulaAction, withdrawFormulaAction } from "../../../../_eng/actions";
import { CommandForm, DecisionForm } from "../../../../_eng/forms";
import { DeleteDraftButton } from "../../../../../delete-draft-button";
import { ApprovalPanel, VerifyBanner } from "../../../../_eng/ui";
import { PlainVersionChip, useFromText, NEXT_WRAP } from "../../../../_eng/plain";
import { waitingForApprover } from "../../../../_eng/waiting";
import { FormulaLineEditor } from "./line-editor";

export const metadata: Metadata = { title: "Recipe version (advanced)" };

const allowed = (l: { tolerancePct: string | null; toleranceAbsG: string | null }) => (l.toleranceAbsG !== null ? `± ${D(l.toleranceAbsG).toString()} g` : `± ${D(l.tolerancePct ?? 0).toString()} %`);

export default async function FormulaRevisionPage({ params }: { params: Promise<{ id: string; revisionId: string }> }) {
  const { id, revisionId } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view")) return <Forbidden what="recipes" />;
  const v = /^[0-9a-f-]{36}$/i.test(revisionId) ? await getFormulaRevision(ctx, revisionId) : null;
  if (!v || v.formula.id !== id) {
    return (
      <EmptyState title="Version not found" action={<LinkButton href="/masterdata/formulas" variant="secondary">All recipes</LinkButton>}>
        It may have been deleted. Open the recipe and pick a version from its list.
      </EmptyState>
    );
  }
  const { revision: r } = v;
  const today = businessToday();
  const lastStep = Math.max(...v.approval.policy.map((p) => p.step));
  const editor = v.can.edit ? await formulaFormOptions(ctx) : null;
  const canChange = ctx.can("masterdata.formula.create") && ctx.can("masterdata.formula.edit") && ctx.can("masterdata.routing.create") && ctx.can("masterdata.routing.edit") && ctx.can("masterdata.routing.view");
  const wizardNew = `/masterdata/recipes/${v.formula.id}?new=1`;
  const nextPolicy = v.approval.nextStep ? v.approval.policy.find((p) => p.step === v.approval.nextStep!.step) : null;
  const waiting = r.status === "pending_approval" && !v.approval.canDecide ? await waitingForApprover(ctx, "masterdata.formula.approve", nextPolicy, v.approval.policy.length) : null;
  const ingredients = v.lines.filter((l) => !l.isPackaging);
  const packaging = v.lines.filter((l) => l.isPackaging);
  const hasMore = v.can.withdraw || v.can.retire || (v.can.edit && !r.submittedAt);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/masterdata/formulas/${v.formula.id}`} className="inline-flex min-h-[44px] items-center text-[14px] text-primary-text hover:underline">
          ← Recipe for {v.product.name}
        </Link>
        <PageHeader
          title={`Version ${r.revisionNo} of the recipe for ${v.product.name}`}
          subtitle={
            <>
              Recipe (advanced) · <RecordNo>{v.formula.code}</RecordNo> <PlainVersionChip status={r.status} label={r.label} />
            </>
          }
          actions={
            hasMore ? (
              <MoreMenu>
                <div className="flex flex-col gap-3">
                  {v.can.withdraw && <CommandForm action={withdrawFormulaAction} hidden={{ id: r.id }} label="Take it back to change it" variant="secondary" />}
                  {v.can.edit && !r.submittedAt && <DeleteDraftButton kind="formula_revision" id={r.id} what="this draft version and its ingredients (approved versions are not touched; a recipe with no other version is removed too)" />}
                  {v.can.retire && <CommandForm action={retireFormulaAction} hidden={{ id: r.id }} label="Stop using this version" variant="danger" reasonLabel="Why?" confirmText="New batches can no longer use it. Batches that used it keep it." />}
                </div>
              </MoreMenu>
            ) : undefined
          }
        />
      </div>
      <PageIntro>
        This screen is for one version of a recipe: the ingredients and how much of each. Most people use New recipe (step by step). These screens are for advanced changes. <Explain term="version" label="What is a version?" />
      </PageIntro>

      {r.status === "draft" ? (
        v.can.submit ? (
          <NextStep className={NEXT_WRAP} text="Next: check the ingredients and press Save, then send it for approval." action={{ label: "Send for approval", href: "#send" }} />
        ) : (
          <NextStep className={NEXT_WRAP} text="This version is being written." waitingFor={`Waiting for ${r.createdByName ?? "the planner"} to finish it and send it for approval.`} />
        )
      ) : r.status === "pending_approval" ? (
        v.approval.canDecide ? (
          <NextStep className={NEXT_WRAP} text="Next: check the ingredients and amounts, then say OK or not OK." action={{ label: "Decide", href: "#decide" }} />
        ) : (
          <NextStep className={NEXT_WRAP} text="Sent for approval." waitingFor={waiting ?? "Waiting for approval."} />
        )
      ) : r.status === "approved" ? (
        canChange && v.can.newRevision ? (
          <NextStep className={NEXT_WRAP} text={r.label === "effective" ? "This version is in use. To change the recipe, make a new version." : "This version is approved."} action={{ label: "Make a new version (step by step)", href: wizardNew }} />
        ) : (
          <NextStep className={NEXT_WRAP} text={r.label === "effective" ? "This version is in use." : "This version is approved."} action={{ label: "Open the recipe", href: `/masterdata/recipes/${v.formula.id}` }} />
        )
      ) : r.status === "rejected" ? (
        <NextStep className={NEXT_WRAP} text="This version was not OK'd. Read the note in the approval box, then make a new version." action={canChange && v.can.newRevision ? { label: "Make a new version (step by step)", href: wizardNew } : undefined} />
      ) : (
        <NextStep className={NEXT_WRAP} text="This version is no longer used." action={{ label: "Open the recipe", href: `/masterdata/recipes/${v.formula.id}` }} />
      )}

      {r.status === "approved" && <Banner tone="info" title="An approved version cannot change">Batches keep the version they started with. To change the recipe, make a new version.</Banner>}
      <VerifyBanner />

      <Card>
        <Dl
          items={[
            ["Batch weight", `${fmtQty(D(r.referenceBatchSizeG).div(1000), "kg", 3)} (${fmtQty(r.referenceBatchSizeG, "g", 1)})`],
            ["Expected amount made", fmtQty(r.theoreticalYieldPct, "%", 2)],
            ["Use from", useFromText(r.effectiveFrom, r.effectiveTo, fmtDate).replace(/^Use from:? ?/, "") || "—"],
            ["Written by", r.createdByName ?? "—"],
            ["Sent by", r.submittedByName ? `${r.submittedByName}${r.submittedAt ? ` · ${fmtDateTime(r.submittedAt)}` : ""}` : "—"],
            ["Last OK by", r.approvedByName ? `${r.approvedByName}${r.approvedAt ? ` · ${fmtDateTime(r.approvedAt)}` : ""}` : "—"],
          ]}
        />
        {r.changeSummary && (
          <p className="mt-3 text-[14px]">
            <span className="font-medium">What changed:</span> {r.changeSummary}
          </p>
        )}
        {r.notes && <p className="mt-1 text-[13px] text-muted">{r.notes}</p>}
      </Card>

      {editor ? (
        <Card>
          <CardTitle>Change this draft</CardTitle>
          <FormulaLineEditor
            today={today}
            // Ingredients only (usability test): no packaging or spare parts, except a material already on a line.
            materials={editor.materials.filter((m) => m.kind === "raw_material" || m.kind === "intermediate" || v.lines.some((l) => l.materialId === m.id))}
            init={{
              revisionId: r.id,
              referenceBatchSizeG: r.referenceBatchSizeG,
              theoreticalYieldPct: r.theoreticalYieldPct,
              effectiveFrom: r.effectiveFrom,
              changeSummary: r.changeSummary,
              notes: r.notes,
              lines: v.lines.map((l) => ({ materialId: l.materialId, quantityG: l.quantityG, tolerancePct: l.tolerancePct, toleranceAbsG: l.toleranceAbsG, phaseCode: l.phaseCode, scaling: l.scaling, isCritical: l.isCritical, requiresChecker: l.requiresChecker })),
            }}
          />
        </Card>
      ) : (
        <Card>
          <CardTitle>Ingredients ({ingredients.length})</CardTitle>
          {ingredients.length === 0 ? (
            <p className="text-[14px] text-fg-2">No ingredients yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-[16px] border border-line" aria-label="Ingredients">
              {ingredients.map((l) => (
                <li key={l.id} className="px-4 py-3" data-testid={`ingredient-${l.lineNo}`}>
                  <p className="break-words text-[15px] font-semibold">
                    {l.lineNo}. {l.materialName} <span className="font-mono text-[12px] font-normal text-muted">{l.materialCode}</span>
                  </p>
                  <p className="mt-0.5 text-[14px] tabular">
                    {fmtQty(l.quantityG, "g", 1)}
                    {"percentOfBatch" in l && l.percentOfBatch ? ` (${fmtQty(l.percentOfBatch, "%", 2)} of the batch)` : ""} · allowed difference {allowed(l)} (between {fmtQty(l.minG, "", 1)} and {fmtQty(l.maxG, "g", 1)})
                  </p>
                  <p className="text-[12px] text-muted">
                    {l.scaling === "fixed" ? "Same amount in every batch size" : "Grows with the batch size"}
                    {l.phaseCode ? ` · part ${l.phaseCode}` : ""}
                    {l.requiresChecker ? " · a second person checks the weighing" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[14px] tabular" data-testid="gram-total">
            All ingredients together <b>{fmtQty(v.totals.sumG, "g", 1)}</b> · batch weight <b>{fmtQty(v.totals.referenceBatchSizeG, "g", 1)}</b>
            {!D(v.totals.differenceG).isZero() && <span className="block text-[13px] text-[var(--warn-fg)]">Difference {D(v.totals.differenceG).toString()} g (from rounding the amounts; shown exactly).</span>}
          </p>
          {!v.showPercentages && <p className="mt-1 text-[13px] text-muted">Percentages are hidden for your job; batches show the amounts to weigh.</p>}
        </Card>
      )}

      {v.totals.packaging.length > 0 && (
        <Card>
          <CardTitle>Packaging per batch</CardTitle>
          <p className="mb-2 text-[14px] text-fg-2">Counted in pieces, not weighed, and not part of the gram total. Set aside with the ingredients at Get materials.</p>
          <ul className="flex flex-col divide-y divide-line rounded-[16px] border border-line" aria-label="Packaging per batch" data-testid="packaging-per-batch">
            {packaging.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                <span className="break-words text-[15px] font-semibold">{l.materialName}</span>
                <span className="text-[14px] tabular">{fmtQty(l.quantityG, "pcs", 0)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {v.baseRevision && (v.redline.length > 0 || v.headerChanges.length > 0) && (
        <Card>
          <CardTitle>What changed since version {v.baseRevision.revisionNo}</CardTitle>
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {v.headerChanges.map((h) => (
              <li key={h}>• {h.replace("Reference batch size", "Batch weight").replace("Theoretical yield", "Expected amount made")}</li>
            ))}
            {v.redline.map((d, i) => (
              <li key={i} className="break-words">
                <span className={d.kind === "added" ? "font-semibold text-[var(--ok-fg)]" : d.kind === "removed" ? "font-semibold text-[var(--bad-fg)] line-through" : "font-semibold"}>
                  {d.kind === "added" ? "Added" : d.kind === "removed" ? "Removed" : "Changed"}
                </span>{" "}
                {d.material}: {d.detail.replace(/tolerance/g, "allowed difference").replace(/quantity/g, "amount")}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(r.status !== "draft" || v.approval.decisions.length > 0) && (
        <section id="decide" className="scroll-mt-20">
          <ApprovalPanel approval={v.approval} status={r.status} what="recipe">
            {v.approval.canDecide && v.approval.nextStep && (
              <DecisionForm action={decideFormulaAction} id={r.id} stepLabel={`OK ${v.approval.nextStep.step} of ${v.approval.policy.length}, ${v.approval.nextStep.label}`} isFinal={v.approval.nextStep.step === lastStep} defaultEffectiveFrom={r.effectiveFrom} today={today} plain />
            )}
            {r.status === "pending_approval" && !v.approval.canDecide && (
              <p className="text-[13px] text-muted">You cannot decide this step: it needs another job, or you wrote, sent or already approved this version.</p>
            )}
          </ApprovalPanel>
        </section>
      )}

      {v.can.submit && (
        <section id="send" className="scroll-mt-20">
          <Card>
            <CardTitle>Send for approval</CardTitle>
            <CommandForm action={submitFormulaAction} hidden={{ id: r.id }} label="Send for approval" pendingText="Sending…" variant="cta" confirmText="Press Save above first. After sending, it cannot change unless you take it back before anyone decides." />
          </Card>
        </section>
      )}
    </div>
  );
}
