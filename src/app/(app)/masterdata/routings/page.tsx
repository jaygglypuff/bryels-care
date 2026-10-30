import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listFormulas, listRoutings } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { CommandForm } from "../_eng/forms";
import { soapExampleAction } from "../_eng/actions";
import { Forbidden } from "../../forbidden";
import { VersionChip } from "../_eng/ui";
import { RecipeRowAction } from "../recipes/recipe-links";

export const metadata: Metadata = { title: "Routings" };

export default async function RoutingsPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.routing.view")) return <Forbidden what="routings" />;
  const rows = await listRoutings(ctx);
  // ADR-086: each product's steps open in the step-by-step recipe (the recipe is the product's formula).
  const recipeOf = new Map((ctx.can("masterdata.formula.view") ? await listFormulas(ctx) : []).map((f) => [f.productId, f]));
  const canWizard = ctx.can("masterdata.formula.create") && ctx.can("masterdata.routing.create");
  const canChange = canWizard && ctx.can("masterdata.formula.edit") && ctx.can("masterdata.routing.edit");
  const rowAction = (productId: string, openStatus: string | null | undefined) => {
    const f = recipeOf.get(productId);
    return f ? <RecipeRowAction formulaId={f.formulaId} openStatus={openStatus ?? f.open?.status} canChange={canChange} /> : null;
  };
  return (
    <div>
      <PageHeader
        title="Steps for each product (routings)"
        subtitle="The steps a worker follows to make a product: checks, weighing, making steps with readings, waiting times and wrapping. Only approved versions can be used."
        actions={
          <>
            {ctx.can("masterdata.work_instruction.view") && <LinkButton href="/masterdata/work-instructions" variant="secondary">Work instructions</LinkButton>}
            {ctx.can("masterdata.routing.create") && <CommandForm action={soapExampleAction} hidden={{}} label="Use the soap routing example" variant="secondary" pendingText="Adding…" />}
            {ctx.can("masterdata.routing.create") && <LinkButton href="/masterdata/routings/new" variant="secondary">New routing (advanced editing)</LinkButton>}
            {canWizard && (
              <LinkButton href="/masterdata/recipes/new" variant="cta" size="lg">
                New recipe (step by step)
              </LinkButton>
            )}
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No routings yet">A product needs an approved routing before a batch can be planned.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((r) => (
              <Card key={r.id}>
                <Link href={`/masterdata/routings/${r.id}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[13px] font-semibold">{r.code}</p>
                      <p className="font-medium">{r.productName}</p>
                    </div>
                    {r.effective ? <VersionChip status="approved" label="effective" /> : <VersionChip status={r.open?.status ?? "draft"} />}
                  </div>
                  <p className="mt-1 text-[12px] text-muted">{r.effective ? `Version ${r.effective.revisionNo} · ${r.effective.stepCount} steps` : "No approved version yet"}</p>
                </Link>
                <div className="mt-3 flex flex-wrap gap-2">
                  {rowAction(r.productId, r.open?.status)}
                  <Link href={`/masterdata/routings/${r.id}`} className="inline-flex min-h-[44px] items-center px-2 text-[13px] text-primary-text hover:underline">
                    Advanced editing
                  </Link>
                </div>
              </Card>
            ))}
          </div>
          <div className="hidden md:block">
            <Table head={["Steps", "Product", "Version in use", "Use from", "Steps", "Open version", ""]}>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/60">
                  <Td>
                    <Link href={`/masterdata/routings/${r.id}`} className="font-mono font-semibold text-primary-text hover:underline">
                      {r.code}
                    </Link>
                    <span className="block text-[12px] text-muted">{r.name}</span>
                  </Td>
                  <Td>
                    {r.productName} <span className="text-muted">({r.productSku})</span>
                  </Td>
                  <Td>{r.effective ? `Version ${r.effective.revisionNo}` : <span className="text-muted">None</span>}</Td>
                  <Td>{r.effective?.effectiveFrom ? fmtDate(r.effective.effectiveFrom) : "—"}</Td>
                  <Td>{r.effective?.stepCount ?? "—"}</Td>
                  <Td>
                    {r.open ? (
                      <Link href={`/masterdata/routings/${r.id}/revisions/${r.open.id}`} className="flex items-center gap-2 hover:underline">
                        Version {r.open.revisionNo} <VersionChip status={r.open.status} />
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>{rowAction(r.productId, r.open?.status)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
