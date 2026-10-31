import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtQty } from "@/lib/qty";
import { listFormulas } from "@/modules/masterdata";
import { EmptyState, PageHeader } from "@/ui/core";
import { Explain, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { CommandForm } from "../_eng/forms";
import { soapExampleAction } from "../_eng/actions";
import { Forbidden } from "../../forbidden";
import { PlainVersionChip, NEXT_WRAP } from "../_eng/plain";

export const metadata: Metadata = { title: "Recipes (advanced)" };

export default async function FormulasPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view")) return <Forbidden what="recipes" />;
  const rows = await listFormulas(ctx);
  const pending = rows.filter((r) => r.open?.status === "pending_approval").length;
  // ADR-089: the step-by-step recipe wizard needs both the formula and the routing rights.
  const canWizard = ctx.can("masterdata.formula.create") && ctx.can("masterdata.routing.create");
  const canCreate = ctx.can("masterdata.formula.create");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Recipes (advanced)"
        actions={
          canCreate ? (
            <MoreMenu>
              <div className="flex flex-col gap-3">
                <Link href="/masterdata/formulas/new" className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text underline">
                  New recipe (advanced)
                </Link>
                <CommandForm action={soapExampleAction} hidden={{}} label="Add the Acapulco soap example" variant="secondary" pendingText="Adding…" />
              </div>
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>
        This screen is for advanced changes to the ingredients of a recipe. Most people use New recipe (step by step). These screens are for advanced changes.
        {pending ? ` ${pending} version${pending === 1 ? " is" : "s are"} waiting for an OK.` : ""} <Explain term="version" label="What is a version?" />
      </PageIntro>
      {canWizard ? (
        <NextStep className={NEXT_WRAP} text="Making or changing a recipe? Do it one screen at a time." action={{ label: "New recipe (step by step)", href: "/masterdata/recipes/new" }} />
      ) : (
        <NextStep className={NEXT_WRAP} text="To see a recipe the simple way, open the recipe list." action={{ label: "Open the recipes", href: "/masterdata/recipes" }} />
      )}
      {rows.length === 0 ? (
        <EmptyState title="No recipes yet">
          {canWizard ? "Make the first one with New recipe (step by step). QA and a manager approve it before batches can use it." : "The planner makes recipes; QA and a manager approve them before batches can use them."}
        </EmptyState>
      ) : (
        <PlainList label="Recipes">
          {rows.map((f) => (
            <PlainRow
              key={f.formulaId}
              href={`/masterdata/formulas/${f.formulaId}`}
              title={f.productName}
              code={f.code}
              status={f.effective ? <PlainVersionChip status="approved" label="effective" /> : <PlainVersionChip status={f.open?.status ?? "draft"} />}
              facts={[
                f.effective ? `Version ${f.effective.revisionNo} in use · ${fmtQty(D(f.effective.referenceBatchSizeG).div(1000), "kg", 1)} a batch · ${f.effective.lineCount} ingredient lines` : "No approved version yet",
                f.open ? `version ${f.open.revisionNo} ${f.open.status === "pending_approval" ? "waiting for an OK" : "being written"}` : f.scheduled ? `version ${f.scheduled.revisionNo} starts later` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </PlainList>
      )}
    </div>
  );
}
