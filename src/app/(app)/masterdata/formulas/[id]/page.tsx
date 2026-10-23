import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDateTime, fmtQty } from "@/lib/qty";
import { getFormula } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { newFormulaRevisionAction } from "../../_eng/actions";
import { CommandForm } from "../../_eng/forms";
import { EffectiveRange, VerifyBanner, VersionChip } from "../../_eng/ui";

export const metadata: Metadata = { title: "Formula" };

export default async function FormulaDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view")) return <Forbidden what="formulas" />;
  const f = /^[0-9a-f-]{36}$/i.test(id) ? await getFormula(ctx, id) : null;
  if (!f) {
    return <EmptyState title="Formula not found" action={<LinkButton href="/masterdata/formulas" variant="secondary">Back to formulas</LinkButton>} />;
  }
  const canNew = ctx.can("masterdata.formula.create") && !f.openRevisionId;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/masterdata/formulas" className="text-[13px] text-primary-text hover:underline">
          ← Formulas
        </Link>
        <PageHeader
          title={`${f.formula.code} · ${f.formula.name}`}
          subtitle={`${f.product.name} (${f.product.skuCode})`}
          actions={
            <>
              {f.effectiveRevisionId && (
                <LinkButton href={`/masterdata/formulas/${f.formula.id}/revisions/${f.effectiveRevisionId}`} variant="secondary">
                  Effective revision
                </LinkButton>
              )}
              {ctx.can("production.batch.create") && f.effectiveRevisionId && (
                <LinkButton href="/production/new" variant="cta">
                  New batch
                </LinkButton>
              )}
            </>
          }
        />
      </div>
      <VerifyBanner />
      <Card>
        <CardTitle
          action={
            canNew ? (
              <div className="w-auto">
                <CommandForm action={newFormulaRevisionAction} hidden={{ formulaId: f.formula.id }} label="Start new revision" pendingText="Starting…" variant="secondary" />
              </div>
            ) : undefined
          }
        >
          Revisions
        </CardTitle>
        {f.revisions.length === 0 ? (
          <EmptyState title="No revision yet" />
        ) : (
          <>
            <ul className="flex flex-col gap-2 md:hidden">
              {f.revisions.map((r) => (
                <li key={r.id}>
                  <Link href={`/masterdata/formulas/${f.formula.id}/revisions/${r.id}`} className="block rounded-[14px] border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">Rev {r.revisionNo}</span>
                      <VersionChip status={r.status} label={r.label} />
                    </div>
                    <p className="mt-1 text-[12px] text-muted">
                      <EffectiveRange from={r.effectiveFrom} to={r.effectiveTo} />
                    </p>
                    {r.changeSummary && <p className="mt-1 text-[12px]">{r.changeSummary}</p>}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table head={["Revision", "Status", "Effective", "Reference size", "Change", "Submitted by", "Final approver", "Created"]}>
                {f.revisions.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2/60">
                    <Td>
                      <Link href={`/masterdata/formulas/${f.formula.id}/revisions/${r.id}`} className="font-semibold text-primary-text hover:underline">
                        Rev {r.revisionNo}
                      </Link>
                    </Td>
                    <Td>
                      <VersionChip status={r.status} label={r.label} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <EffectiveRange from={r.effectiveFrom} to={r.effectiveTo} />
                    </Td>
                    <Td>{fmtQty(D(r.referenceBatchSizeG).div(1000), "kg", 2)}</Td>
                    <Td className="max-w-[260px]">{r.changeSummary ?? "—"}</Td>
                    <Td>{r.submittedByName ?? "—"}</Td>
                    <Td>{r.approvedByName ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
