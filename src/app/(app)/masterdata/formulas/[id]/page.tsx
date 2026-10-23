import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDateTime, fmtQty } from "@/lib/qty";
import { getFormula } from "@/modules/production";
import { Banner } from "@/ui/status";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { RevisionStatus } from "../revision-status";

export const metadata: Metadata = { title: "Formula" };

export default async function FormulaDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view")) return <Forbidden what="formulas" />;
  const f = /^[0-9a-f-]{36}$/i.test(id) ? await getFormula(ctx, id) : null;
  if (!f) {
    return <EmptyState title="Formula not found" action={<LinkButton href="/masterdata/formulas" variant="secondary">Back to formulas</LinkButton>} />;
  }
  const rev = f.current;
  const ref = rev ? D(rev.referenceBatchSizeG) : D(0);
  const total = f.lines.reduce((acc, l) => acc.plus(l.line.quantityG), D(0));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/masterdata/formulas" className="text-[13px] text-primary-text hover:underline">
          ← Formulas
        </Link>
        <PageHeader
          title={`${f.formula.code} · ${f.formula.name}`}
          subtitle={`${f.product.name} (${f.product.skuCode})`}
          actions={ctx.can("production.batch.create") && rev?.status === "approved" ? <LinkButton href="/production/new" variant="cta">New batch</LinkButton> : undefined}
        />
      </div>

      {!rev ? (
        <EmptyState title="No revision yet">This formula has no revision. A process owner must create and approve one.</EmptyState>
      ) : (
        <>
          {rev.status !== "approved" && (
            <Banner tone="warn" title="No approved revision">
              Showing the latest revision ({rev.status.replace(/_/g, " ")}). Batches can only use an approved revision.
            </Banner>
          )}
          <Card>
            <Dl
              items={[
                ["Revision", <span key="r" className="flex items-center gap-2">Rev {rev.revisionNo} <RevisionStatus status={rev.status} /></span>],
                ["Reference batch size", `${fmtQty(ref.div(1000), "kg", 2)} (${fmtQty(ref, "g", 1)})`],
                ["Theoretical yield", fmtQty(rev.theoreticalYieldPct, "%", 1)],
                ["Submitted by", f.revisions.find((r) => r.id === rev.id)?.submittedByName ?? "—"],
                ["Approved by", f.revisions.find((r) => r.id === rev.id)?.approvedByName ?? "—"],
                ["Created", fmtDateTime(rev.createdAt)],
              ]}
            />
            {rev.notes && <p className="mt-3 text-[13px] text-[var(--warn-fg)]">{rev.notes}</p>}
          </Card>

          <Card>
            <CardTitle>Ingredients</CardTitle>
            {f.lines.length === 0 ? (
              <EmptyState title="No ingredient lines" />
            ) : (
              <Table head={["#", "Material", "INCI name", "Quantity (g)", "% of batch", "Tolerance"]}>
                {f.lines.map(({ line, material }) => {
                  const q = D(line.quantityG);
                  const band = q.mul(line.tolerancePct).div(100);
                  return (
                    <tr key={line.id}>
                      <Td>{line.lineNo}</Td>
                      <Td>
                        <span className="font-medium">{material.name}</span> <span className="text-muted">({material.code})</span>
                      </Td>
                      <Td>{material.inciName ?? "—"}</Td>
                      <Td className="text-right">{fmtQty(q, "", 1)}</Td>
                      <Td className="text-right">{ref.gt(0) ? fmtQty(q.div(ref).mul(100), "%", 2) : "—"}</Td>
                      <Td className="whitespace-nowrap">
                        ±{fmtQty(line.tolerancePct, "%", 2)} ({fmtQty(q.minus(band), "", 1)}–{fmtQty(q.plus(band), "g", 1)})
                      </Td>
                    </tr>
                  );
                })}
                <tr className="bg-surface-2 font-semibold">
                  <Td />
                  <Td>Total</Td>
                  <Td />
                  <Td className="text-right">{fmtQty(total, "", 1)}</Td>
                  <Td className="text-right">{ref.gt(0) ? fmtQty(total.div(ref).mul(100), "%", 2) : "—"}</Td>
                  <Td />
                </tr>
              </Table>
            )}
            <p className="mt-2 text-[12px] text-[var(--warn-fg)]">Tolerances are placeholders pending process-owner approval (A-PRD-18).</p>
          </Card>

          <Card>
            <CardTitle>Checklist steps</CardTitle>
            {f.steps.length === 0 ? (
              <EmptyState title="No routing steps" />
            ) : (
              <ol className="flex flex-col divide-y divide-line">
                {f.steps.map((s) => (
                  <li key={s.id} className="py-2.5">
                    <p className="font-medium">
                      {s.stepNo}. {s.name} <span className="text-[12px] font-normal text-muted">· {s.stepKind}{s.requiresChecker ? " · checker required" : ""}</span>
                    </p>
                    {s.instruction && <p className="text-[13px] text-fg-2">{s.instruction}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {f.revisions.length > 1 && (
            <Card>
              <CardTitle>Revision history</CardTitle>
              <Table head={["Revision", "Status", "Reference size", "Created"]}>
                {f.revisions.map((r) => (
                  <tr key={r.id}>
                    <Td>Rev {r.revisionNo}</Td>
                    <Td>
                      <RevisionStatus status={r.status} />
                    </Td>
                    <Td>{fmtQty(D(r.referenceBatchSizeG).div(1000), "kg", 2)}</Td>
                    <Td>{fmtDateTime(r.createdAt)}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
