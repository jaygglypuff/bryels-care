import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDate, fmtQty } from "@/lib/qty";
import { listFormulas } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { CommandForm } from "../_eng/forms";
import { soapExampleAction } from "../_eng/actions";
import { Forbidden } from "../../forbidden";
import { VersionChip } from "../_eng/ui";
import { RecipeRowAction } from "../recipes/recipe-links";

export const metadata: Metadata = { title: "Formulas" };

export default async function FormulasPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view")) return <Forbidden what="formulas" />;
  const rows = await listFormulas(ctx);
  const pending = rows.filter((r) => r.open?.status === "pending_approval").length;
  // ADR-086: the step-by-step recipe wizard needs both the formula and the routing rights.
  const canWizard = ctx.can("masterdata.formula.create") && ctx.can("masterdata.routing.create");
  const canChange = canWizard && ctx.can("masterdata.formula.edit") && ctx.can("masterdata.routing.edit") && ctx.can("masterdata.routing.view");
  return (
    <div>
      <PageHeader
        title="Recipes (formulas)"
        subtitle={`A recipe is the ingredients (formula) and the steps of a product. Only approved versions can be used, and each batch keeps the version it started with.${pending ? ` ${pending} version(s) waiting for approval.` : ""}`}
        actions={
          ctx.can("masterdata.formula.create") ? (
            <>
              <CommandForm action={soapExampleAction} hidden={{}} label="Use the Acapulco soap example" variant="secondary" pendingText="Adding…" />
              <LinkButton href="/masterdata/formulas/new" variant="secondary">New formula (advanced editing)</LinkButton>
              {canWizard && (
                <LinkButton href="/masterdata/recipes/new" variant="cta" size="lg">
                  New recipe (step by step)
                </LinkButton>
              )}
            </>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No formulas yet">Formulas are drafted by the planner and approved by QA and a site manager before batches can use them.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((f) => (
              <Card key={f.formulaId}>
                <Link href={`/masterdata/formulas/${f.formulaId}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[13px] font-semibold">
                        {f.code} {f.effective ? `version ${f.effective.revisionNo}` : ""}
                      </p>
                      <p className="font-medium">{f.productName}</p>
                    </div>
                    {f.effective ? <VersionChip status="approved" label="effective" /> : <VersionChip status={f.open?.status ?? "draft"} />}
                  </div>
                  <p className="mt-1 text-[12px] text-muted tabular">
                    {f.effective ? `${fmtQty(D(f.effective.referenceBatchSizeG).div(1000), "kg", 1)} batch · ${f.effective.lineCount} ingredients` : "No approved version yet"}
                  </p>
                  {f.open && <p className="mt-1 text-[12px] text-[var(--appr-fg)]">Version {f.open.revisionNo}: {f.open.status === "pending_approval" ? "waiting for approval" : f.open.status.replace(/_/g, " ")}</p>}
                </Link>
                <div className="mt-3 flex flex-wrap gap-2">
                  <RecipeRowAction formulaId={f.formulaId} openStatus={f.open?.status} canChange={canChange} />
                  <Link href={`/masterdata/formulas/${f.formulaId}`} className="inline-flex min-h-[44px] items-center px-2 text-[13px] text-primary-text hover:underline">
                    Advanced editing
                  </Link>
                </div>
              </Card>
            ))}
          </div>
          <div className="hidden md:block">
            <Table head={["Recipe", "Product", "Version in use", "Use from", "Batch size", "Ingredients", "Open version", ""]}>
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
                  <Td>{f.effective ? <span className="flex items-center gap-2">Version {f.effective.revisionNo} <VersionChip status="approved" label="effective" /></span> : <span className="text-muted">None</span>}</Td>
                  <Td className="whitespace-nowrap">{f.effective?.effectiveFrom ? fmtDate(f.effective.effectiveFrom) : "—"}</Td>
                  <Td className="whitespace-nowrap">{f.effective ? fmtQty(D(f.effective.referenceBatchSizeG).div(1000), "kg", 1) : "—"}</Td>
                  <Td>{f.effective?.lineCount ?? "—"}</Td>
                  <Td>
                    {f.open ? (
                      <Link href={`/masterdata/formulas/${f.formulaId}/revisions/${f.open.id}`} className="flex items-center gap-2 hover:underline">
                        Version {f.open.revisionNo} <VersionChip status={f.open.status} />
                      </Link>
                    ) : f.scheduled ? (
                      <span className="flex items-center gap-2">Version {f.scheduled.revisionNo} <VersionChip status="approved" label="scheduled" /></span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    <RecipeRowAction formulaId={f.formulaId} openStatus={f.open?.status} canChange={canChange} />
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
