import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { getRecipe, productReadiness, recipeWizardOptions, type RecipeView } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { NextStep, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { waitingFor } from "../../../waiting-for";
import { approvalSentence } from "../../_eng/ui";
import { approveRecipeAloneAction } from "../../_eng/actions";
import { CommandForm } from "../../_eng/forms";
import { RecipeSummary } from "../recipe-summary";
import { RecipeWizard } from "../wizard";

export const metadata: Metadata = { title: "Recipe" };

type V = { id: string; no: number; status: string } | null;
const word = (v: V) => (v ? `Version ${v.no} (${v.status === "pending_approval" ? "waiting for approval" : v.status.replace(/_/g, " ")})` : "none yet");

/** Version words for one part (ingredients or steps) when the wizard opens. */
function partLabel(p: { open: V; current: V; next: number } | null, newVersion: boolean) {
  if (!p) return { label: "Version 1 (new draft)", no: 1 };
  if (p.open) return { label: word(p.open), no: p.open.no };
  if (newVersion) return { label: `${word(p.current)} → Version ${p.next} (new draft) if you change them`, no: p.next };
  return { label: word(p.current), no: p.current?.no ?? 1 };
}

/**
 * One recipe in plain words (ADR-089): the summary of the open or current version, with "Edit
 * recipe" for a draft, "Make a new version" for an approved recipe, and the detailed pages as
 * "Advanced editing". Approvals stay on the detailed pages and in "To approve".
 */
export default async function RecipePage({ params, searchParams }: { params: Promise<{ formulaId: string }>; searchParams: Promise<{ edit?: string; new?: string; saved?: string }> }) {
  const { formulaId } = await params;
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.view") || !ctx.can("masterdata.routing.view")) return <Forbidden what="recipes" permission="masterdata.formula.view" />;
  const r = await getRecipe(ctx, formulaId);
  if (!r) return <EmptyState title="Recipe not found" action={<LinkButton href="/masterdata/recipes" variant="secondary">All recipes</LinkButton>} />;

  const wantsEdit = sp.edit === "1" && r.mode === "draft" && r.can.edit;
  const wantsNew = sp.new === "1" && r.mode === "approved" && r.can.newVersion && r.can.edit;
  if (wantsEdit || wantsNew) {
    const options = await recipeWizardOptions(ctx);
    const ing = partLabel(r.versions.formula, wantsNew || !r.versions.formula.open);
    const st = partLabel(r.versions.routing, wantsNew || !r.versions.routing?.open);
    return (
      <div className="flex flex-col gap-3">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap justify-between gap-2 text-[13px] xl:max-w-[1200px]">
          <Link href={`/masterdata/recipes/${r.formula.id}`} className="inline-flex min-h-[44px] items-center text-primary-text hover:underline">
            ← Back to the recipe without saving
          </Link>
        </div>
        <div className="mx-auto w-full max-w-3xl xl:max-w-[1200px]">
          <PageHeader title={r.product.name} subtitle={wantsNew ? "New version of the recipe" : "Change the recipe"} />
        </div>
        <RecipeWizard
          options={options}
          initial={r.draft}
          start={{
            kind: wantsNew ? "version" : "edit",
            ingredientsLabel: ing.label,
            stepsLabel: st.label,
            formulaNo: ing.no,
            routingNo: st.no,
            locks: r.locks,
            productName: r.product.name,
            materialNames: r.materialNames,
          }}
        />
      </div>
    );
  }
  // ADR-116/117: the same sentence as the New order screen — who approves next, "— or Ana (owner) alone" when the setting is on.
  const ready = r.mode === "waiting" ? await productReadiness(ctx, r.product.id).catch(() => null) : null;
  const waiting = r.mode === "waiting" ? (ready?.sentence ?? (await waitingFor(ctx, "masterdata.formula.approve", null, "to approve it", "the approvers", { exclude: r.pendingBy }))) : null;
  return <RecipeOverview r={r} saved={sp.saved} waiting={waiting} />;
}

/** ADR-117: the owner's one green Approve for the waiting recipe and steps, with the GMP warning in plain words. */
function OwnerAloneBox({ r }: { r: RecipeView }) {
  return (
    <section aria-label="What to do next" data-testid="owner-alone-box" className="mb-4 flex flex-col gap-3 rounded-[8px] border border-[var(--brand-200)] bg-[var(--brand-50)] px-4 py-3">
      <div>
        <p className="text-label font-semibold text-primary-text">What to do next</p>
        <p className="mt-0.5 text-[15px] font-medium leading-snug text-fg">{r.ownerAlone.note}</p>
        <p className="mt-1 text-[14px] text-fg-2">
          One press approves the {r.ownerAlone.waitingParts.length > 1 ? "recipe and its steps" : r.ownerAlone.waitingParts[0] === "steps" ? "steps" : "recipe"}, every step, from today.
        </p>
      </div>
      <CommandForm action={approveRecipeAloneAction} hidden={{ formulaId: r.formula.id }} label="Approve" pendingText="Approving…" variant="cta" />
      <p className="text-[13px] text-fg-2">GMP auditors usually expect a QA person who did not write the recipe to review it. The recipe will show “approved by you (owner) — no separate QA review”.</p>
    </section>
  );
}

function RecipeOverview({ r, saved, waiting }: { r: RecipeView; saved?: string; waiting: string | null }) {
  const f = r.versions.formula;
  const ro = r.versions.routing;
  const fShown = f.open ?? f.current;
  const rShown = ro ? (ro.open ?? ro.current) : null;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <RecordHeader
        back={{ href: "/masterdata/recipes", label: "Recipes" }}
        typeLabel="Recipe"
        title={r.product.name}
        meta={[<span key="code" className="font-mono">{r.formula.code}</span>, `ingredients ${word(fShown)}`, `steps ${ro ? word(rShown) : "none yet"}`]}
      />
      <PageIntro>This screen is for one product&apos;s recipe: what goes in, the steps, and which version is in use.</PageIntro>
      {r.mode === "draft" && r.can.edit ? (
        <NextStep text="Next: finish the recipe and send it for approval." action={{ label: "Edit recipe", href: `/masterdata/recipes/${r.formula.id}?edit=1` }} />
      ) : r.mode === "draft" ? (
        <NextStep text="This recipe is a draft." waitingFor="Waiting for the person who makes recipes to finish it and send it for approval." />
      ) : r.mode === "waiting" && r.ownerAlone.canApproveAlone ? (
        <OwnerAloneBox r={r} />
      ) : r.mode === "waiting" ? (
        <NextStep text="Sent for approval. It can't be changed while it waits." waitingFor={waiting ?? undefined} />
      ) : r.mode === "approved" && r.can.newVersion && r.can.edit ? (
        <NextStep text="In use. To change it, make a new version; batches keep this one until the new one is approved." action={{ label: "Make a new version", href: `/masterdata/recipes/${r.formula.id}?new=1` }} />
      ) : (
        <NextStep text="In use. Nothing to do here." />
      )}
      {saved && !(saved === "sent" && r.mode !== "waiting") && (
        <div role="status" className="rounded-[8px] border border-[var(--ok-bd)] bg-[var(--ok-bg)] px-3 py-2 text-[14px] text-[var(--ok-fg)]">
          {saved === "sent"
            ? r.ownerAlone.canApproveAlone
              ? "Sent for approval. As the owner you can approve it alone above, or leave it for QA and a manager under “To approve”."
              : "Sent for approval. The approvers see it under “To approve”."
            : saved === "same"
              ? "Nothing changed, so nothing new was saved."
              : "Saved as a draft. Nobody can use it until it is sent and approved."}
        </div>
      )}
      {r.mode === "waiting" && !r.ownerAlone.canApproveAlone && <p className="text-[14px] text-fg-2">{approvalSentence(r.approvalPolicy, "recipe")}</p>}
      {r.mode !== "waiting" && r.ownerAlone.approvedText && (
        <p className="rounded-[8px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[14px] text-[var(--warn-fg)]" data-testid="owner-alone-approved">
          {r.ownerAlone.approvedText}
        </p>
      )}
      <Card>
        <RecipeSummary
          productName={r.product.name}
          product={{ unitNetMassG: r.product.unitNetMassG, family: r.product.family, pieceG: r.product.pieceG }}
          draft={r.draft}
          materialName={(id) => r.materialNames[id] ?? "Unknown ingredient"}
          ingredientsLabel={word(fShown)}
          stepsLabel={ro ? word(rShown) : "none yet"}
        />
      </Card>
      <Card>
        <h2 className="text-[15px] font-semibold">Advanced editing and approval</h2>
        <p className="text-[13px] text-muted">The detailed pages show every field, the changes against the last version, and the Approve / Reject buttons for approvers.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {fShown && (
            <LinkButton href={`/masterdata/formulas/${r.formula.id}/revisions/${fShown.id}`} variant="secondary">
              Ingredients in detail
            </LinkButton>
          )}
          {r.routing && rShown && (
            <LinkButton href={`/masterdata/routings/${r.routing.id}/revisions/${rShown.id}`} variant="secondary">
              Steps in detail
            </LinkButton>
          )}
        </div>
      </Card>
    </div>
  );
}
