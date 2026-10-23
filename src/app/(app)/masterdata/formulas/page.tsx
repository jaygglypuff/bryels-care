import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDate, fmtQty } from "@/lib/qty";
import { listFormulas } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { VersionChip } from "../_eng/ui";

export const metadata: Metadata = { title: "Formulas" };

export default async function FormulasPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view")) return <Forbidden what="formulas" />;
  const rows = await listFormulas(ctx);
  const pending = rows.filter((r) => r.open?.status === "pending_approval").length;
  return (
    <div>
      <PageHeader
        title="Formulas"
        subtitle={`Approved, effective revisions are frozen into each batch at creation.${pending ? ` ${pending} revision(s) awaiting approval.` : ""}`}
        actions={ctx.can("masterdata.formula.create") ? <LinkButton href="/masterdata/formulas/new" variant="cta">New formula</LinkButton> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState title="No formulas yet">Formulas are drafted by the planner and approved by QA and a site manager before batches can use them.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((f) => (
              <Link key={f.formulaId} href={`/masterdata/formulas/${f.formulaId}`}>
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[13px] font-semibold">
                        {f.code} {f.effective ? `rev ${f.effective.revisionNo}` : ""}
                      </p>
                      <p className="font-medium">{f.productName}</p>
                    </div>
                    {f.effective ? <VersionChip status="approved" label="effective" /> : <VersionChip status={f.open?.status ?? "draft"} />}
                  </div>
                  <p className="mt-1 text-[12px] text-muted tabular">
                    {f.effective ? `${fmtQty(D(f.effective.referenceBatchSizeG).div(1000), "kg", 1)} reference · ${f.effective.lineCount} ingredients` : "No effective revision"}
                  </p>
                  {f.open && <p className="mt-1 text-[12px] text-[var(--appr-fg)]">Revision {f.open.revisionNo}: {f.open.status.replace(/_/g, " ")}</p>}
                </Card>
              </Link>
            ))}
          </div>
          <div className="hidden md:block">
            <Table head={["Formula", "Product", "Effective revision", "Effective from", "Reference size", "Ingredients", "Open revision"]}>
              {rows.map((f) => (
                <tr key={f.formulaId} className="hover:bg-surface-2/60">
                  <Td>
                    <Link href={`/masterdata/formulas/${f.formulaId}`} className="font-mono font-semibold text-primary-text hover:underline">
                      {f.code}
                    </Link>
                    <span className="block text-[12px] text-muted">{f.name}</span>
                  </Td>
                  <Td>
                    {f.productName} <span className="text-muted">({f.productSku})</span>
                  </Td>
                  <Td>{f.effective ? <span className="flex items-center gap-2">Rev {f.effective.revisionNo} <VersionChip status="approved" label="effective" /></span> : <span className="text-muted">None</span>}</Td>
                  <Td className="whitespace-nowrap">{f.effective?.effectiveFrom ? fmtDate(f.effective.effectiveFrom) : "—"}</Td>
                  <Td className="whitespace-nowrap">{f.effective ? fmtQty(D(f.effective.referenceBatchSizeG).div(1000), "kg", 1) : "—"}</Td>
                  <Td>{f.effective?.lineCount ?? "—"}</Td>
                  <Td>
                    {f.open ? (
                      <Link href={`/masterdata/formulas/${f.formulaId}/revisions/${f.open.id}`} className="flex items-center gap-2 hover:underline">
                        Rev {f.open.revisionNo} <VersionChip status={f.open.status} />
                      </Link>
                    ) : f.scheduled ? (
                      <span className="flex items-center gap-2">Rev {f.scheduled.revisionNo} <VersionChip status="approved" label="scheduled" /></span>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
