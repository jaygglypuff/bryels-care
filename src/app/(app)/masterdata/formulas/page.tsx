import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtQty } from "@/lib/qty";
import { listFormulas } from "@/modules/production";
import { Card, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { RevisionStatus } from "./revision-status";

export const metadata: Metadata = { title: "Formulas" };

export default async function FormulasPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view")) return <Forbidden what="formulas" />;
  const rows = await listFormulas(ctx);
  return (
    <div>
      <PageHeader title="Formulas" subtitle="Approved formula revisions are frozen into each batch at creation." />
      {rows.length === 0 ? (
        <EmptyState title="No formulas yet">Formulas are maintained by the process owner and approved before batches can use them.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((f) => (
              <Link key={f.formulaId} href={`/masterdata/formulas/${f.formulaId}`}>
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-[13px] font-semibold">
                        {f.code} rev {f.revisionNo ?? "—"}
                      </p>
                      <p className="font-medium">{f.productName}</p>
                    </div>
                    <RevisionStatus status={f.status} />
                  </div>
                  <p className="mt-1 text-[12px] text-muted tabular">
                    {f.referenceBatchSizeG ? fmtQty(D(f.referenceBatchSizeG).div(1000), "kg", 1) : "—"} reference · {f.lineCount} ingredients
                  </p>
                </Card>
              </Link>
            ))}
          </div>
          <div className="hidden md:block">
            <Table head={["Formula", "Name", "Product", "Revision", "Status", "Reference size", "Theoretical yield", "Ingredients"]}>
              {rows.map((f) => (
                <tr key={f.formulaId} className="hover:bg-surface-2/60">
                  <Td>
                    <Link href={`/masterdata/formulas/${f.formulaId}`} className="font-mono font-semibold text-primary-text hover:underline">
                      {f.code}
                    </Link>
                  </Td>
                  <Td>{f.name}</Td>
                  <Td>
                    {f.productName} <span className="text-muted">({f.productSku})</span>
                  </Td>
                  <Td>{f.revisionNo ?? "—"}</Td>
                  <Td>
                    <RevisionStatus status={f.status} />
                  </Td>
                  <Td className="whitespace-nowrap">{f.referenceBatchSizeG ? fmtQty(D(f.referenceBatchSizeG).div(1000), "kg", 1) : "—"}</Td>
                  <Td>{f.theoreticalYieldPct ? fmtQty(f.theoreticalYieldPct, "%", 1) : "—"}</Td>
                  <Td>{f.lineCount}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
