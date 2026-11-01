import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { listFormulas } from "@/modules/masterdata";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, NextStep, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { PlainVersionChip } from "../_eng/plain";
import { recipeRowAction, recipeStatusWords } from "./recipe-list";

export const metadata: Metadata = { title: "Recipes" };

/**
 * Recipes, the plain way (round 4, UX re-audit C #5): one row per product with its version status and one button
 * ("Edit recipe" for a draft, "Make a new version" for a recipe in use). "New recipe" opens the five-screen wizard.
 * The engineers' lists (Recipes (advanced), Steps (advanced)) stay under Management › Production setup › Advanced.
 * Access: masterdata.formula.view (the list); the buttons need the edit/create permissions the recipe page checks again.
 */
export default async function RecipesPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view")) return <Forbidden what="recipes" permission="masterdata.formula.view" />;
  const rows = await listFormulas(ctx);
  const canWizard = ctx.can("masterdata.formula.create") && ctx.can("masterdata.routing.create");
  const can = { edit: ctx.can("masterdata.formula.edit") && ctx.can("masterdata.routing.edit"), newVersion: canWizard };
  const drafts = rows.filter((r) => r.open?.status === "draft");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title="Recipes" actions={canWizard ? <LinkButton href="/masterdata/recipes/new" variant="secondary">New recipe</LinkButton> : undefined} />
      <PageIntro>
        This screen is for the recipe of each product: what goes in, the steps, and which version is in use. <Explain term="version" label="What is a version?" />
      </PageIntro>
      {drafts.length > 0 && can.edit ? (
        <NextStep text={`Finish the draft recipe for ${drafts[0].productName} and send it for approval.`} action={{ label: "Edit recipe", href: `/masterdata/recipes/${drafts[0].formulaId}?edit=1` }} />
      ) : rows.length === 0 && canWizard ? (
        <NextStep text="Make the first recipe, one short screen at a time." action={{ label: "New recipe", href: "/masterdata/recipes/new" }} />
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="No recipes yet">
          {canWizard ? "Press New recipe. QA and a manager approve it before batches can use it." : "The planner makes recipes; QA and a manager approve them before batches can use them."}
        </EmptyState>
      ) : (
        <ul aria-label="Recipes" className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface" data-testid="recipe-list">
          {rows.map((f) => {
            const action = recipeRowAction(f, can, f.formulaId);
            return (
              <li key={f.formulaId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={`/masterdata/recipes/${f.formulaId}`} className="inline-flex min-h-[44px] items-center break-words text-[15px] font-semibold text-fg hover:text-primary-text hover:underline">
                      {f.productName}
                    </Link>
                    {f.effective ? <PlainVersionChip status="approved" label="effective" /> : <PlainVersionChip status={f.open?.status ?? "draft"} />}
                  </div>
                  <p className="text-[13px] text-fg-2">
                    {recipeStatusWords(f)}
                    <span className="ml-1 font-mono text-[12px] text-muted">· {f.code}</span>
                  </p>
                </div>
                <LinkButton href={action.href} variant="secondary" size="sm" className="w-full shrink-0 sm:w-auto">
                  {action.label}
                </LinkButton>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[13px] text-muted">
        Engineers change recipes line by line under Management › Production setup › Advanced.
      </p>
    </div>
  );
}
