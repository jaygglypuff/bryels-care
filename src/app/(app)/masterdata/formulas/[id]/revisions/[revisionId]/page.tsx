import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDateTime, fmtQty } from "@/lib/qty";
import { businessToday, formulaFormOptions, getFormulaRevision } from "@/modules/masterdata";
import { Banner } from "@/ui/status";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../../../../forbidden";
import { decideFormulaAction, retireFormulaAction, submitFormulaAction, withdrawFormulaAction } from "../../../../_eng/actions";
import { CommandForm, DecisionForm } from "../../../../_eng/forms";
import { DeleteDraftButton } from "../../../../../delete-draft-button";
import { ApprovalPanel, EffectiveRange, VerifyBanner, VersionChip } from "../../../../_eng/ui";
import { FormulaLineEditor } from "./line-editor";

export const metadata: Metadata = { title: "Formula revision" };

const tol = (l: { tolerancePct: string | null; toleranceAbsG: string | null }) => (l.toleranceAbsG !== null ? `±${D(l.toleranceAbsG).toString()} g` : `±${D(l.tolerancePct ?? 0).toString()} %`);

export default async function FormulaRevisionPage({ params }: { params: Promise<{ id: string; revisionId: string }> }) {
  const { id, revisionId } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view")) return <Forbidden what="formulas" />;
  const v = /^[0-9a-f-]{36}$/i.test(revisionId) ? await getFormulaRevision(ctx, revisionId) : null;
  if (!v || v.formula.id !== id) {
    return <EmptyState title="Revision not found" action={<LinkButton href="/masterdata/formulas" variant="secondary">Back to formulas</LinkButton>} />;
  }
  const { revision: r } = v;
  const today = businessToday();
  const lastStep = Math.max(...v.approval.policy.map((p) => p.step));
  const editor = v.can.edit ? await formulaFormOptions(ctx) : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/masterdata/formulas/${v.formula.id}`} className="text-[13px] text-primary-text hover:underline">
          ← {v.formula.code}
        </Link>
        <PageHeader title={`${v.formula.code} revision ${r.revisionNo}`} subtitle={`${v.formula.name} · ${v.product.name} (${v.product.skuCode})`} actions={<VersionChip status={r.status} label={r.label} />} />
      </div>
      {r.status === "approved" && (
        <Banner tone="info" title="Approved revisions are read-only">
          Batches keep the revision they were created with. To change this formula, start a new revision from the formula page.
        </Banner>
      )}
      <VerifyBanner />

      <Card>
        <Dl
          items={[
            ["Reference batch size", `${fmtQty(D(r.referenceBatchSizeG).div(1000), "kg", 3)} (${fmtQty(r.referenceBatchSizeG, "g", 1)})`],
            ["Theoretical yield", fmtQty(r.theoreticalYieldPct, "%", 2)],
            ["Effective", <EffectiveRange key="e" from={r.effectiveFrom} to={r.effectiveTo} />],
            ["Drafted by", r.createdByName ?? "—"],
            ["Submitted by", r.submittedByName ? `${r.submittedByName}${r.submittedAt ? ` · ${fmtDateTime(r.submittedAt)}` : ""}` : "—"],
            ["Final approver", r.approvedByName ? `${r.approvedByName}${r.approvedAt ? ` · ${fmtDateTime(r.approvedAt)}` : ""}` : "—"],
          ]}
        />
        {r.changeSummary && <p className="mt-3 text-[13px]"><span className="font-medium">Change:</span> {r.changeSummary}</p>}
        {r.notes && <p className="mt-1 text-[12px] text-muted">{r.notes}</p>}
      </Card>

      {editor ? (
        <Card>
          <CardTitle>Edit draft</CardTitle>
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
          <CardTitle>Ingredients</CardTitle>
          {v.lines.length === 0 ? (
            <EmptyState title="No ingredient lines" />
          ) : (
            <>
              <ul className="flex flex-col gap-2 md:hidden">
                {v.lines.map((l) => (
                  <li key={l.id} className="rounded-[14px] border border-line p-3 text-[13px]">
                    <p className="font-medium">
                      {l.lineNo}. {l.materialName} <span className="text-muted">({l.materialCode})</span>
                    </p>
                    <p className="tabular">
                      {fmtQty(l.quantityG, "g", 1)} · {tol(l)} · {l.scaling === "fixed" ? "fixed" : "scales"}
                      {"percentOfBatch" in l && l.percentOfBatch ? ` · ${fmtQty(l.percentOfBatch, "%", 2)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table head={["#", "Material", "INCI name", "Quantity (g)", ...(v.showPercentages ? ["% of batch"] : []), "Tolerance", "Window (g)", "Phase", "Scaling"]}>
                  {v.lines.map((l) => (
                    <tr key={l.id}>
                      <Td>{l.lineNo}</Td>
                      <Td>
                        <span className="font-medium">{l.materialName}</span> <span className="text-muted">({l.materialCode})</span>
                      </Td>
                      <Td>{l.inciName ?? "—"}</Td>
                      <Td className="text-right">{fmtQty(l.quantityG, "", 1)}</Td>
                      {v.showPercentages && <Td className="text-right">{"percentOfBatch" in l && l.percentOfBatch ? fmtQty(l.percentOfBatch, "%", 2) : "—"}</Td>}
                      <Td className="whitespace-nowrap">{tol(l)}</Td>
                      <Td className="whitespace-nowrap">
                        {fmtQty(l.minG, "", 1)}–{fmtQty(l.maxG, "", 1)}
                      </Td>
                      <Td>{l.phaseCode ?? "—"}</Td>
                      <Td>{l.scaling === "fixed" ? "Fixed" : "Scales"}</Td>
                    </tr>
                  ))}
                </Table>
              </div>
            </>
          )}
          <p className="mt-3 text-[13px] tabular">
            Sum of lines <b>{D(v.totals.sumG).toString()} g</b> · reference batch size <b>{D(v.totals.referenceBatchSizeG).toString()} g</b>
            {!D(v.totals.differenceG).isZero() && <span className="block text-[12px] text-[var(--warn-fg)]">Difference {D(v.totals.differenceG).toString()} g from rounding of line quantities (shown unrounded).</span>}
          </p>
          {!v.showPercentages && <p className="mt-1 text-[12px] text-muted">Percentages are not shown for your role; batches show target quantities.</p>}
        </Card>
      )}

      {v.baseRevision && (v.redline.length > 0 || v.headerChanges.length > 0) && (
        <Card>
          <CardTitle>Changes compared with revision {v.baseRevision.revisionNo}</CardTitle>
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {v.headerChanges.map((h) => (
              <li key={h}>• {h}</li>
            ))}
            {v.redline.map((d, i) => (
              <li key={i}>
                <span className={d.kind === "added" ? "font-semibold text-[var(--ok-fg)]" : d.kind === "removed" ? "font-semibold text-[var(--bad-fg)] line-through" : "font-semibold"}>
                  {d.kind === "added" ? "Added" : d.kind === "removed" ? "Removed" : "Changed"}
                </span>{" "}
                {d.material}: {d.detail}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(r.status !== "draft" || v.approval.decisions.length > 0) && (
        <ApprovalPanel approval={v.approval} status={r.status} what="recipe">
          {v.approval.canDecide && v.approval.nextStep && (
            <DecisionForm action={decideFormulaAction} id={r.id} stepLabel={`step ${v.approval.nextStep.step}, ${v.approval.nextStep.label}`} isFinal={v.approval.nextStep.step === lastStep} defaultEffectiveFrom={r.effectiveFrom} today={today} />
          )}
          {r.status === "pending_approval" && !v.approval.canDecide && (
            <p className="text-[12px] text-muted">You cannot decide the waiting step: it needs a different role, or you prepared or already approved this revision.</p>
          )}
        </ApprovalPanel>
      )}

      {(v.can.submit || v.can.withdraw || v.can.retire || v.can.edit) && (
        <Card>
          <CardTitle>Actions</CardTitle>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {v.can.submit && <CommandForm action={submitFormulaAction} hidden={{ id: r.id }} label="Submit for approval" pendingText="Submitting…" variant="cta" confirmText="Save the draft first. After submitting, the revision cannot be edited unless you withdraw it before anyone decides." />}
            {v.can.withdraw && <CommandForm action={withdrawFormulaAction} hidden={{ id: r.id }} label="Withdraw to draft" variant="secondary" />}
            {v.can.edit && !r.submittedAt && <DeleteDraftButton kind="formula_revision" id={r.id} what="this draft revision and its lines (approved revisions are not affected; a formula with no other revision is removed too)" />}
            {v.can.retire && <CommandForm action={retireFormulaAction} hidden={{ id: r.id }} label="Retire revision" variant="danger" reasonLabel="Reason for retiring" confirmText="A retired revision cannot be used for new batches. Batches that used it keep it." />}
          </div>
        </Card>
      )}
    </div>
  );
}
